import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("projects-cache", () => {
  let fetchMock: any;
  let getProjects: any;
  let resolveProjectId: any;
  let __resetProjectsCacheForTests: any;

  const token = "acct-token";
  const apiBase = "https://api.rollbar.com/api/1";

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: vi.fn().mockResolvedValue(body),
    };
  }

  beforeEach(async () => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    vi.resetModules();

    const mod = await import("../../../src/utils/projects-cache.js");
    getProjects = mod.getProjects;
    resolveProjectId = mod.resolveProjectId;
    __resetProjectsCacheForTests = mod.__resetProjectsCacheForTests;
    __resetProjectsCacheForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const allProjects = [
    { id: 1, name: "Backend", status: "enabled" },
    { id: 2, name: "Frontend", status: "enabled" },
    { id: 3, name: "Old-Disabled", status: "disabled" },
  ];

  it("fetches GET /projects once and filters out disabled projects", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ err: 0, result: allProjects }),
    );

    const projects = await getProjects(token, apiBase);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBase}/projects`,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Rollbar-Access-Token": token }),
      }),
    );
    expect(projects).toHaveLength(2);
    expect(projects.map((p: any) => p.name)).toEqual(["Backend", "Frontend"]);
  });

  it("reuses the cache on subsequent calls instead of refetching", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ err: 0, result: allProjects }),
    );

    await getProjects(token, apiBase);
    await getProjects(token, apiBase);
    await getProjects(token, apiBase);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves a project name to an id, case-insensitively", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ err: 0, result: allProjects }),
    );

    const id = await resolveProjectId(token, apiBase, "backend");
    expect(id).toBe(1);
  });

  it("passes through a numeric id string without needing a name match", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ err: 0, result: allProjects }),
    );

    const id = await resolveProjectId(token, apiBase, "2");
    expect(id).toBe(2);
  });

  it("refreshes the cache once on a lookup miss, then retries the match", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ err: 0, result: allProjects }))
      .mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [
            ...allProjects,
            { id: 4, name: "NewProject", status: "enabled" },
          ],
        }),
      );

    // Prime the cache with the original list first.
    await getProjects(token, apiBase);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const id = await resolveProjectId(token, apiBase, "NewProject");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(id).toBe(4);
  });

  it("throws an error listing available project names after refresh-once still misses", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ err: 0, result: allProjects }));

    let thrown: Error | undefined;
    try {
      await resolveProjectId(token, apiBase, "DoesNotExist");
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toMatch(/Unknown project "DoesNotExist"/);
    expect(thrown?.message).toMatch(/Backend.*Frontend/);
    // Confirms the refresh-once behavior actually happened (initial fetch +
    // one refresh-on-miss).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("auto-selects the single enabled project as default when no project param is given", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        err: 0,
        result: [{ id: 7, name: "Solo", status: "enabled" }],
      }),
    );

    const id = await resolveProjectId(token, apiBase, undefined);
    expect(id).toBe(7);
  });

  it("throws when no project param is given and multiple projects are enabled", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ err: 0, result: allProjects }),
    );

    await expect(resolveProjectId(token, apiBase, undefined)).rejects.toThrow(
      /Multiple projects available/,
    );
  });

  it("filters out disabled projects entirely from resolution", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ err: 0, result: allProjects }),
    );

    await expect(
      resolveProjectId(token, apiBase, "Old-Disabled"),
    ).rejects.toThrow();
  });

  it("throws when the API responds with a non-ok status", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({}, false, 403),
    );

    await expect(getProjects(token, apiBase)).rejects.toThrow(
      /Failed to fetch Rollbar projects/,
    );
  });

  it("throws when the API responds with err !== 0", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ err: 1, message: "boom" }),
    );

    await expect(getProjects(token, apiBase)).rejects.toThrow(/boom/);
  });

  it("retries once when the initial cache is empty and finds a single project after refresh", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ err: 0, result: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [{ id: 3, name: "JustAdded", status: "enabled" }],
        }),
      );

    const id = await resolveProjectId(token, apiBase, undefined);

    expect(id).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws 'no enabled projects' when still empty after the refresh", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ err: 0, result: [] }));

    await expect(resolveProjectId(token, apiBase, undefined)).rejects.toThrow(
      /No enabled Rollbar projects found/,
    );
  });
});
