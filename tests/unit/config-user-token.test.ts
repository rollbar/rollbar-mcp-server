import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const files = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: files.exists,
  readFileSync: files.read,
}));

describe("connected-user authentication", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    for (const name of [
      "ROLLBAR_ACCESS_TOKEN",
      "ROLLBAR_ACCOUNT_ACCESS_TOKEN",
      "ROLLBAR_USER_ACCESS_TOKEN",
      "ROLLBAR_API_BASE",
      "ROLLBAR_CONFIG_FILE",
    ]) {
      vi.stubEnv(name, "");
    }
    files.exists.mockReturnValue(false);
    files.read.mockReset();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          err: 0,
          result: [{ id: 12, name: "Backend", status: "enabled" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function configFile(value: unknown, location = "/test/rollbar.json") {
    vi.stubEnv("ROLLBAR_CONFIG_FILE", location);
    files.exists.mockImplementation((name: string) => name === location);
    files.read.mockReturnValue(JSON.stringify(value));
  }

  it("uses an explicit user environment token for project discovery and auth context", async () => {
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", " user-secret ");
    vi.stubEnv("ROLLBAR_API_BASE", "https://rollbar.example/api/1/");
    const { resolveAuthContext, getAccountModeInfo } =
      await import("../../src/config.js");
    expect(
      await resolveAuthContext("Backend", { requireUserToken: true }),
    ).toEqual({
      token: "user-secret",
      tokenType: "user",
      projectId: 12,
      apiBase: "https://rollbar.example/api/1",
    });
    expect(await getAccountModeInfo()).toMatchObject({
      active: true,
      token: "user-secret",
      enabledProjectCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers["X-Rollbar-Access-Token"]).toBe(
      "user-secret",
    );
  });

  it.each([
    { userToken: "file-user" },
    { userToken: "file-user", token: "project-secret" },
    {
      userToken: "file-user",
      projects: [{ name: "Backend", token: "project-secret" }],
    },
  ])(
    "loads user-token config and uses that identity even for explicitly configured projects: %j",
    async (config) => {
      configFile(config);
      const { resolveAuthContext, HAS_ACCOUNT_TOKEN } =
        await import("../../src/config.js");
      const { buildProjectParam } =
        await import("../../src/utils/project-params.js");
      expect(process.exit).not.toHaveBeenCalled();
      expect(HAS_ACCOUNT_TOKEN).toBe(true);
      expect(buildProjectParam().parse("12")).toBe("12");
      expect(await resolveAuthContext("Backend")).toMatchObject({
        token: "file-user",
        tokenType: "user",
        projectId: 12,
      });
    },
  );

  it.each(["cwd", "home"])(
    "loads the user token from the %s config fallback",
    async (location) => {
      const { homedir } = await import("node:os");
      const path =
        location === "cwd"
          ? `${process.cwd()}/.rollbar-mcp.json`
          : `${homedir()}/.rollbar-mcp.json`;
      files.exists.mockImplementation((name: string) => name === path);
      files.read.mockReturnValue(JSON.stringify({ userToken: "file-user" }));
      const { resolveAuthContext } = await import("../../src/config.js");
      expect(await resolveAuthContext(undefined)).toMatchObject({
        token: "file-user",
        tokenType: "user",
        projectId: 12,
      });
    },
  );

  it("applies a user environment token to a project-token config", async () => {
    configFile({ projects: [{ name: "Backend", token: "project-secret" }] });
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-user");
    const { resolveAuthContext } = await import("../../src/config.js");
    expect(await resolveAuthContext("Backend")).toMatchObject({
      token: "env-user",
      tokenType: "user",
    });
  });

  it("prefers the file's user token over the same-type environment token", async () => {
    configFile({ userToken: "file-user" });
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-user");
    const { resolveAuthContext } = await import("../../src/config.js");
    expect(await resolveAuthContext(undefined)).toMatchObject({
      token: "file-user",
    });
  });

  it.each(["env", "file", "mixed"])(
    "rejects simultaneous account and user tokens from %s",
    async (source) => {
      if (source === "env") {
        vi.stubEnv("ROLLBAR_ACCOUNT_ACCESS_TOKEN", "account-secret");
        vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "user-secret");
      } else if (source === "file") {
        configFile({
          accountToken: "account-secret",
          userToken: "user-secret",
        });
      } else {
        configFile({ accountToken: "account-secret" });
        vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "user-secret");
      }
      await import("../../src/config.js");
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Configure exactly one"),
      );
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
        /account-secret|user-secret/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("does not infer user identity from an account-like legacy token", async () => {
    vi.stubEnv("ROLLBAR_ACCESS_TOKEN", "legacy-secret");
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            err: 0,
            result: [{ id: 12, name: "Backend", status: "enabled" }],
          }),
        ),
      ),
    );
    const { resolveAuthContext } = await import("../../src/config.js");
    expect((await resolveAuthContext(undefined)).tokenType).toBe("account");
    fetchMock.mockClear();
    await expect(
      resolveAuthContext(undefined, { requireUserToken: true }),
    ).rejects.toThrow("ROLLBAR_USER_ACCESS_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses user project IDs in each existing request parameter convention", async () => {
    const {
      injectProjectIdQueryParam,
      injectProjectIdBodyParam,
      injectProjectIdsRepeatedQueryParam,
    } = await import("../../src/utils/params.js");
    const auth = {
      token: "user-token",
      tokenType: "user" as const,
      projectId: 12,
      apiBase: "https://example.com/api/1",
    };
    expect(
      injectProjectIdQueryParam(
        "https://example.com/item/123/events?type=item_comment&type=item_status_history",
        auth,
      ),
    ).toBe(
      "https://example.com/item/123/events?type=item_comment&type=item_status_history&project_id=12",
    );
    expect(injectProjectIdBodyParam({ status: "resolved" }, auth)).toEqual({
      status: "resolved",
      project_id: 12,
    });
    expect(
      injectProjectIdsRepeatedQueryParam(
        "https://example.com/items?page=1",
        auth,
      ),
    ).toBe("https://example.com/items?page=1&project_ids=12");
  });
});
