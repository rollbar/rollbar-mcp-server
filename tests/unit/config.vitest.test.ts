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

describe("config", () => {
  const originalEnv = process.env;
  const originalExit = process.exit;
  const originalConsoleError = console.error;

  beforeEach(() => {
    process.env = { ...originalEnv, ROLLBAR_ACCESS_TOKEN: "test-token" };
    delete process.env.ROLLBAR_API_BASE;
    delete process.env.ROLLBAR_CONFIG_FILE;
    process.exit = vi.fn() as typeof process.exit;
    console.error = vi.fn();
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  it("should have correct apiBase when using env token", async () => {
    const { PROJECTS, resolveProject } = await import("../../src/config.js");
    expect(PROJECTS).toHaveLength(1);
    expect(PROJECTS[0].apiBase).toBe("https://api.rollbar.com/api/1");
    expect(resolveProject(undefined).apiBase).toBe(
      "https://api.rollbar.com/api/1",
    );
  });

  it("should allow overriding API base URL via environment variable", async () => {
    process.env.ROLLBAR_API_BASE = "https://rollbar-dev.example.com/api/1/";
    vi.resetModules();
    const { PROJECTS } = await import("../../src/config.js");
    expect(PROJECTS[0].apiBase).toBe("https://rollbar-dev.example.com/api/1");
  });

  it("should have getUserAgent function that generates correct user agent string", async () => {
    const { getUserAgent } = await import("../../src/config.js");
    const packageJsonModule = await import("../../package.json", {
      with: { type: "json" },
    });
    const expectedVersion = packageJsonModule.default.version;
    expect(getUserAgent("test-tool")).toBe(
      `rollbar-mcp-server/${expectedVersion} (tool: test-tool)`,
    );
  });

  it("should load token from environment and resolveProject returns it", async () => {
    process.env.ROLLBAR_ACCESS_TOKEN = "custom-token";
    vi.resetModules();
    const { resolveProject } = await import("../../src/config.js");
    expect(resolveProject(undefined).token).toBe("custom-token");
  });

  it("should exit when neither config file nor env var is set", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockReturnValue(false);

    await import("../../src/config.js");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("No Rollbar configuration found"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should exit when ROLLBAR_API_BASE is invalid and using env token", async () => {
    process.env.ROLLBAR_API_BASE = "not-a-valid-url";
    vi.resetModules();

    await import("../../src/config.js");

    expect(console.error).toHaveBeenCalledWith(
      "Error: ROLLBAR_API_BASE must be a valid HTTP(S) URL when using ROLLBAR_ACCESS_TOKEN.",
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should call dotenv.config() on module load", async () => {
    const dotenv = await import("dotenv");
    vi.clearAllMocks();

    await import("../../src/config.js");

    expect(dotenv.default.config).toHaveBeenCalled();
  });

  it("loads JSON config from ROLLBAR_CONFIG_FILE path", async () => {
    process.env.ROLLBAR_CONFIG_FILE = "/custom/config.json";
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockImplementation((p: string) => p === "/custom/config.json");
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        projects: [
          {
            name: "backend",
            token: "tok_abc",
            apiBase: "https://api.example.com/api/1",
          },
        ],
      }),
    );
    vi.resetModules();

    const { PROJECTS } = await import("../../src/config.js");

    expect(PROJECTS).toHaveLength(1);
    expect(PROJECTS[0].name).toBe("backend");
    expect(PROJECTS[0].token).toBe("tok_abc");
    expect(PROJECTS[0].apiBase).toBe("https://api.example.com/api/1");
  });

  it("should exit when ROLLBAR_CONFIG_FILE points to invalid JSON", async () => {
    process.env.ROLLBAR_CONFIG_FILE = "/custom/config.json";
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockImplementation((p: string) => p === "/custom/config.json");
    readFileSyncMock.mockReturnValue("{ invalid json");
    vi.resetModules();

    await import("../../src/config.js");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid Rollbar config file "/custom/config.json"'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("accepts multi-project config and sets PROJECTS with correct name/token/apiBase", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockImplementation((p: string) =>
      p.endsWith(".rollbar-mcp.json"),
    );
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        projects: [
          { name: "backend", token: "tok_1" },
          {
            name: "staging",
            token: "tok_2",
            apiBase: "https://staging.rollbar.com/api/1",
          },
        ],
      }),
    );
    vi.resetModules();

    const { PROJECTS } = await import("../../src/config.js");

    expect(PROJECTS).toHaveLength(2);
    expect(PROJECTS[0]).toEqual({
      name: "backend",
      token: "tok_1",
      apiBase: "https://api.rollbar.com/api/1",
    });
    expect(PROJECTS[1]).toEqual({
      name: "staging",
      token: "tok_2",
      apiBase: "https://staging.rollbar.com/api/1",
    });
  });

  it("accepts shorthand config { token } and synthesizes name default", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockImplementation((p: string) =>
      p.endsWith(".rollbar-mcp.json"),
    );
    readFileSyncMock.mockReturnValue(JSON.stringify({ token: "tok_single" }));
    vi.resetModules();

    const { PROJECTS } = await import("../../src/config.js");

    expect(PROJECTS).toHaveLength(1);
    expect(PROJECTS[0].name).toBe("default");
    expect(PROJECTS[0].token).toBe("tok_single");
    expect(PROJECTS[0].apiBase).toBe("https://api.rollbar.com/api/1");
  });

  it("accepts harmless extra metadata keys in config files", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockImplementation((p: string) =>
      p.endsWith(".rollbar-mcp.json"),
    );
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        description: "internal metadata",
        projects: [
          {
            name: "backend",
            token: "tok_backend",
            environment: "production",
            internalId: 123,
          },
        ],
      }),
    );
    vi.resetModules();

    const { PROJECTS } = await import("../../src/config.js");

    expect(PROJECTS).toHaveLength(1);
    expect(PROJECTS[0]).toEqual({
      name: "backend",
      token: "tok_backend",
      apiBase: "https://api.rollbar.com/api/1",
    });
  });

  it("should exit when config apiBase is not HTTP(S)", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockImplementation((p: string) =>
      p.endsWith(".rollbar-mcp.json"),
    );
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        projects: [
          {
            name: "backend",
            token: "tok_backend",
            apiBase: "ftp://example.com/api/1",
          },
        ],
      }),
    );
    vi.resetModules();

    await import("../../src/config.js");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid Rollbar config file"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should exit when cwd config exists but is invalid instead of falling back to env", async () => {
    existsSyncMock.mockImplementation((p: string) => p.endsWith(".rollbar-mcp.json"));
    readFileSyncMock.mockReturnValue(JSON.stringify({ projects: "not-an-array" }));
    vi.resetModules();

    await import("../../src/config.js");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid Rollbar config file"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should exit when home config exists but is invalid instead of falling back to env", async () => {
    existsSyncMock.mockImplementation(
      (p: string) =>
        p.endsWith(".rollbar-mcp.json") && !p.startsWith(process.cwd()),
    );
    readFileSyncMock.mockReturnValue("{ invalid json");
    vi.resetModules();

    await import("../../src/config.js");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid Rollbar config file"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should exit when shorthand and multi-project fields are both present", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockImplementation((p: string) => p.endsWith(".rollbar-mcp.json"));
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        token: "tok_single",
        projects: [{ name: "backend", token: "tok_backend" }],
      }),
    );
    vi.resetModules();

    await import("../../src/config.js");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("expected either a single-project config"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("falls back to ROLLBAR_ACCESS_TOKEN when no config file is present", async () => {
    existsSyncMock.mockReturnValue(false);

    const { PROJECTS, resolveProject } = await import("../../src/config.js");

    expect(PROJECTS).toHaveLength(1);
    expect(PROJECTS[0].name).toBe("default");
    expect(resolveProject(undefined).token).toBe("test-token");
  });

  it("resolveProject(undefined) returns the only project when PROJECTS.length === 1", async () => {
    const { resolveProject } = await import("../../src/config.js");
    const project = resolveProject(undefined);
    expect(project.name).toBe("default");
    expect(project.token).toBe("test-token");
  });

  it("resolveProject('backend') returns the correct project by name", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    existsSyncMock.mockImplementation((p: string) =>
      p.endsWith(".rollbar-mcp.json"),
    );
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        projects: [
          { name: "backend", token: "tok_backend" },
          { name: "frontend", token: "tok_frontend" },
        ],
      }),
    );
    vi.resetModules();

    const { resolveProject } = await import("../../src/config.js");

    expect(resolveProject("backend").token).toBe("tok_backend");
    expect(resolveProject("frontend").token).toBe("tok_frontend");
  });

  it("resolveProject(undefined) throws when PROJECTS.length > 1", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
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
    vi.resetModules();

    const { resolveProject } = await import("../../src/config.js");

    expect(() => resolveProject(undefined)).toThrow(
      /Multiple projects configured. Specify a project name/,
    );
    expect(() => resolveProject(undefined)).toThrow(/backend.*frontend/);
  });

  it("resolveProject('nonexistent') throws with list of valid names", async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
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
    vi.resetModules();

    const { resolveProject } = await import("../../src/config.js");

    expect(() => resolveProject("nonexistent")).toThrow(/Unknown project/);
    expect(() => resolveProject("nonexistent")).toThrow(/backend.*frontend/);
  });
});
