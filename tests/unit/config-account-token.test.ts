import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("dotenv", () => ({
  default: {
    config: vi.fn(),
  },
}));

const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (path: string) => existsSyncMock(path),
  readFileSync: (path: string, ...args: unknown[]) =>
    readFileSyncMock(path, ...args),
}));

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

describe("config — account access token support", () => {
  const originalEnv = process.env;
  const originalExit = process.exit;
  const originalConsoleError = console.error;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    delete process.env.ROLLBAR_ACCOUNT_ACCESS_TOKEN;
    delete process.env.ROLLBAR_API_BASE;
    delete process.env.ROLLBAR_CONFIG_FILE;
    process.exit = vi.fn() as typeof process.exit;
    console.error = vi.fn();
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReset();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  describe("explicit account token via env var", () => {
    it("activates account mode via ROLLBAR_ACCOUNT_ACCESS_TOKEN and resolves project ids from GET /projects", async () => {
      process.env.ROLLBAR_ACCOUNT_ACCESS_TOKEN = "acct-env-token";
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [
            { id: 11, name: "Backend", status: "enabled" },
            { id: 12, name: "Frontend", status: "enabled" },
          ],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext("Backend");

      expect(ctx.tokenType).toBe("account");
      expect(ctx.token).toBe("acct-env-token");
      expect(ctx.projectId).toBe(11);
    });
  });

  describe("explicit account token via config file key", () => {
    it("activates account mode via accountToken in a multi-project config file", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          accountToken: "acct-file-token",
          projects: [{ name: "backend", token: "tok_backend" }],
        }),
      );
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [{ id: 99, name: "SomeProject", status: "enabled" }],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext("SomeProject");

      expect(ctx.tokenType).toBe("account");
      expect(ctx.token).toBe("acct-file-token");
      expect(ctx.projectId).toBe(99);
    });

    it("activates account mode via accountToken alone (account-token-only config file, no projects/token)", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          accountToken: "acct-file-token-2",
        }),
      );
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [{ id: 42, name: "OnlyProject", status: "enabled" }],
        }),
      );

      const { resolveAuthContext, PROJECTS } = await import(
        "../../src/config.js"
      );

      // This is the documented README example: { "accountToken": "..." }
      // with no "projects" and no "token". It must not crash the server.
      expect(process.exit).not.toHaveBeenCalled();
      expect(PROJECTS).toEqual([]);

      const ctx = await resolveAuthContext(undefined);
      expect(ctx.tokenType).toBe("account");
      expect(ctx.token).toBe("acct-file-token-2");
      expect(ctx.projectId).toBe(42);
    });
  });

  describe("probe fallback (legacy ROLLBAR_ACCESS_TOKEN only)", () => {
    it("200 response from GET /projects => treated as account token", async () => {
      process.env.ROLLBAR_ACCESS_TOKEN = "legacy-token";
      // First call is the probe itself; second is the projects-cache fetch
      // used to resolve the projectId once we know it's an account token.
      fetchMock.mockResolvedValue(
        jsonResponse({
          err: 0,
          result: [{ id: 5, name: "OnlyProject", status: "enabled" }],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext(undefined);

      expect(ctx.tokenType).toBe("account");
      expect(ctx.token).toBe("legacy-token");
      expect(ctx.projectId).toBe(5);
    });

    it("401/403 response from GET /projects => treated as project token, current behavior unchanged", async () => {
      process.env.ROLLBAR_ACCESS_TOKEN = "legacy-project-token";
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 403));

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext(undefined);

      expect(ctx.tokenType).toBe("project");
      expect(ctx.token).toBe("legacy-project-token");
      expect(ctx.projectId).toBeUndefined();
    });

    it("REGRESSION: rejects a project name that does not match the legacy token's synthesized project, instead of silently serving it", async () => {
      process.env.ROLLBAR_ACCESS_TOKEN = "legacy-project-token";
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 403));

      const { resolveAuthContext } = await import("../../src/config.js");

      // A caller requesting "frontend" against a legacy env-var token
      // (synthesized as project name "default") must be rejected the same
      // way an explicit multi-project config rejects an unknown name — not
      // silently served the one configured token regardless of what project
      // was actually asked for.
      await expect(resolveAuthContext("frontend")).rejects.toThrow(
        'Unknown project "frontend". Available: default',
      );
    });

    it("still resolves the sole project when the legacy token's own synthesized name ('default') is passed explicitly", async () => {
      process.env.ROLLBAR_ACCESS_TOKEN = "legacy-project-token";
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 403));

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext("default");

      expect(ctx.tokenType).toBe("project");
      expect(ctx.token).toBe("legacy-project-token");
    });

    it("network error during probe => logs a warning and falls back to project-token behavior", async () => {
      process.env.ROLLBAR_ACCESS_TOKEN = "legacy-project-token";
      fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext(undefined);

      expect(ctx.tokenType).toBe("project");
      expect(ctx.token).toBe("legacy-project-token");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Warning"),
      );
    });

    it("only probes once for the process lifetime — second resolveAuthContext call reuses cached probe + cached project list", async () => {
      process.env.ROLLBAR_ACCESS_TOKEN = "legacy-token";
      fetchMock.mockResolvedValue(
        jsonResponse({
          err: 0,
          result: [{ id: 5, name: "OnlyProject", status: "enabled" }],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      await resolveAuthContext(undefined);
      const callsAfterFirst = fetchMock.mock.calls.length;
      await resolveAuthContext(undefined);

      // The probe (GET /projects) and the projects-cache fetch (also GET
      // /projects) each happen exactly once on the first call; the second
      // call must not trigger any additional fetch — both the probe result
      // and the projects cache are reused.
      expect(callsAfterFirst).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("coexistence: explicit project token wins over a present account token", () => {
    it("an explicitly-listed project's own token wins over the account token for that project name", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          accountToken: "acct-token",
          projects: [{ name: "backend", token: "tok_backend_explicit" }],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext("backend");

      expect(ctx.tokenType).toBe("project");
      expect(ctx.token).toBe("tok_backend_explicit");
      // The account-token path (GET /projects) must never be consulted when
      // an explicit project token satisfies the request.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to account mode for a project not explicitly configured", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          accountToken: "acct-token",
          projects: [{ name: "backend", token: "tok_backend_explicit" }],
        }),
      );
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [
            { id: 1, name: "backend", status: "enabled" },
            { id: 2, name: "frontend", status: "enabled" },
          ],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext("frontend");

      expect(ctx.tokenType).toBe("account");
      expect(ctx.token).toBe("acct-token");
      expect(ctx.projectId).toBe(2);
    });
  });

  describe("REGRESSION: single-project config-file setup (not the legacy env var) must never probe", () => {
    it("does not call GET /projects (or fetch at all) for a single-project shorthand config file with no account token", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ token: "tok_from_file" }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext(undefined);

      expect(ctx.tokenType).toBe("project");
      expect(ctx.token).toBe("tok_from_file");
      // The whole point of this regression test: only the legacy
      // ROLLBAR_ACCESS_TOKEN-only path may lazily probe GET /projects. A
      // single project sourced from a config file is unambiguously
      // project-token-only and must never trigger any network call.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not call fetch for a single-project multi-project-shaped config file (one entry in `projects`) with no account token", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          projects: [{ name: "solo", token: "tok_solo" }],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext(undefined);

      expect(ctx.tokenType).toBe("project");
      expect(ctx.token).toBe("tok_solo");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("getAccountModeInfo() also does not probe for a single-project config-file setup", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ token: "tok_from_file" }),
      );

      const { getAccountModeInfo } = await import("../../src/config.js");
      const info = await getAccountModeInfo();

      expect(info.active).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("multiple project-token configs, no account token", () => {
    it("resolveAuthContext falls back to named-project resolution", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          projects: [
            { name: "backend", token: "tok_1" },
            { name: "frontend", token: "tok_2" },
          ],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      const ctx = await resolveAuthContext("frontend");

      expect(ctx.tokenType).toBe("project");
      expect(ctx.token).toBe("tok_2");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("resolveAuthContext(undefined) throws the same helpful error as resolveProject", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          projects: [
            { name: "backend", token: "tok_1" },
            { name: "frontend", token: "tok_2" },
          ],
        }),
      );

      const { resolveAuthContext } = await import("../../src/config.js");
      await expect(resolveAuthContext(undefined)).rejects.toThrow(
        /Multiple projects configured/,
      );
    });
  });

  describe("resolveProject() in pure account-mode (zero project-token projects)", () => {
    it("throws a clear account-mode error instead of the multi-project message", async () => {
      process.env.ROLLBAR_ACCOUNT_ACCESS_TOKEN = "acct-only-token";

      const { resolveProject } = await import("../../src/config.js");
      expect(() => resolveProject(undefined)).toThrow(/account-token mode/);
    });
  });

  describe("getAccountModeInfo", () => {
    it("reports active with token/apiBase when an explicit account token is configured", async () => {
      process.env.ROLLBAR_ACCOUNT_ACCESS_TOKEN = "acct-env-token";
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [
            { id: 1, name: "One", status: "enabled" },
            { id: 2, name: "Two", status: "enabled" },
          ],
        }),
      );

      const { getAccountModeInfo } = await import("../../src/config.js");
      const info = await getAccountModeInfo();

      expect(info.active).toBe(true);
      expect(info.token).toBe("acct-env-token");
      expect(info.apiBase).toBe("https://api.rollbar.com/api/1");
      expect(info.enabledProjectCount).toBe(2);
    });

    it("reports inactive for a plain project-token config", async () => {
      process.env.ROLLBAR_ACCESS_TOKEN = "plain-project-token";
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 401));

      const { getAccountModeInfo } = await import("../../src/config.js");
      const info = await getAccountModeInfo();

      expect(info.active).toBe(false);
    });

    it("reports active when the legacy single token probes as an account token", async () => {
      process.env.ROLLBAR_ACCESS_TOKEN = "legacy-token";
      // First call is the probe itself (GET /projects, 200 => account);
      // second is the getProjects() call getAccountModeInfo() makes to
      // report enabledProjectCount.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [{ id: 1, name: "Solo", status: "enabled" }],
        }),
      );
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          err: 0,
          result: [{ id: 1, name: "Solo", status: "enabled" }],
        }),
      );

      const { getAccountModeInfo } = await import("../../src/config.js");
      const info = await getAccountModeInfo();

      expect(info.active).toBe(true);
      expect(info.token).toBe("legacy-token");
      expect(info.enabledProjectCount).toBe(1);
    });

    it("reports inactive when multiple project-token configs are present with no account token", async () => {
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith(".rollbar-mcp.json"),
      );
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          projects: [
            { name: "backend", token: "tok_1" },
            { name: "frontend", token: "tok_2" },
          ],
        }),
      );

      const { getAccountModeInfo } = await import("../../src/config.js");
      const info = await getAccountModeInfo();

      expect(info.active).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
