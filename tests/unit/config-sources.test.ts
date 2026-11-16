import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import path from "node:path";

const files = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: files.exists,
  readFileSync: files.read,
}));

const defaultApi = "https://api.rollbar.com/api/1";

beforeEach(() => {
  vi.resetModules();
  for (const name of [
    "ROLLBAR_ACCESS_TOKEN",
    "ROLLBAR_USER_ACCESS_TOKEN",
    "ROLLBAR_ACCOUNT_ACCESS_TOKEN",
    "ROLLBAR_API_BASE",
    "ROLLBAR_CONFIG_FILE",
  ]) {
    vi.stubEnv(name, "");
  }
  files.exists.mockReset().mockReturnValue(false);
  files.read.mockReset();
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function useFile(config: unknown, source: "home" | "explicit" = "explicit") {
  const location =
    source === "home"
      ? path.join(homedir(), ".rollbar-mcp.json")
      : "/test/config.json";
  if (source === "explicit") vi.stubEnv("ROLLBAR_CONFIG_FILE", location);
  files.exists.mockImplementation((name: string) => name === location);
  files.read.mockReturnValue(JSON.stringify(config));
}

describe("configuration source selection", () => {
  it("does not discover a config in the working directory", async () => {
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-user-fixture");
    files.exists.mockImplementation(
      (name: string) => name === path.join(process.cwd(), ".rollbar-mcp.json"),
    );
    files.read.mockReturnValue(
      JSON.stringify({
        token: "file-fixture",
        apiBase: "https://other.example/api/1",
      }),
    );
    const config = await import("../../src/config.js");
    expect(config.resolveUserAuthContext()).toEqual({
      token: "env-user-fixture",
      tokenType: "user",
      apiBase: defaultApi,
    });
    expect(files.read).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each(["home", "explicit"] as const)(
    "keeps %s file credentials separate from environment credentials",
    async (source) => {
      useFile(
        { token: "file-fixture", apiBase: "https://api.rollbar.com/api/1" },
        source,
      );
      vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-user-fixture");
      vi.stubEnv("ROLLBAR_ACCOUNT_ACCESS_TOKEN", "env-account-fixture");
      vi.stubEnv("ROLLBAR_ACCESS_TOKEN", "env-project-fixture");
      vi.stubEnv("ROLLBAR_API_BASE", "https://custom.example/api/1");
      const config = await import("../../src/config.js");
      expect(process.exit).not.toHaveBeenCalled();
      expect(await config.resolveAuthContext(undefined)).toEqual({
        token: "file-fixture",
        tokenType: "project",
        apiBase: defaultApi,
      });
      expect(config.HAS_ACCOUNT_TOKEN).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("allows explicit selection of a working-directory file", async () => {
    const location = path.join(process.cwd(), ".rollbar-mcp.json");
    vi.stubEnv("ROLLBAR_CONFIG_FILE", location);
    files.exists.mockImplementation((name: string) => name === location);
    files.read.mockReturnValue(
      JSON.stringify({ userToken: "selected-fixture" }),
    );
    const config = await import("../../src/config.js");
    expect(config.resolveUserAuthContext().token).toBe("selected-fixture");
  });

  it("does not fall back when an explicitly selected file is absent", async () => {
    vi.stubEnv("ROLLBAR_CONFIG_FILE", "/missing/config.json");
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-user-fixture");
    await import("../../src/config.js");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("API endpoint policy", () => {
  it.each([
    "https://custom.example/api/1",
    "http://localhost:12345/api/1",
    "http://127.0.0.1:12345/api/1",
    "http://[::1]:12345/api/1",
  ])("accepts an explicit environment endpoint: %s", async (apiBase) => {
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-user-fixture");
    vi.stubEnv("ROLLBAR_API_BASE", apiBase);
    const config = await import("../../src/config.js");
    expect(process.exit).not.toHaveBeenCalled();
    expect(config.resolveUserAuthContext().apiBase).toBe(apiBase);
  });

  it.each([
    "http://api.rollbar.com/api/1",
    "http://custom.example/api/1",
    "http://localhost.example/api/1",
    "http://192.168.1.1/api/1",
    "https://user:password@custom.example/api/1",
    "ftp://localhost/api/1",
  ])("rejects an invalid environment endpoint: %s", async (apiBase) => {
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-user-fixture");
    vi.stubEnv("ROLLBAR_API_BASE", apiBase);
    await import("../../src/config.js");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "password",
    );
  });

  it.each([
    { token: "file-fixture" },
    { projects: [{ name: "demo", token: "file-fixture" }] },
    { userToken: "file-fixture" },
    { accountToken: "file-fixture" },
  ])(
    "enforces file endpoint policy for every config shape: %j",
    async (config) => {
      useFile({ ...config, apiBase: "https://custom.example/api/1" });
      await import("../../src/config.js");
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://rollbar.com.example/api/1",
    "https://notrollbar.com/api/1",
    "https://api.rollbar.com@custom.example/api/1",
    "https://user:password@api.rollbar.com/api/1",
    "http://api.rollbar.com/api/1",
    "http://127.0.0.1:12345/api/1",
  ])("rejects file endpoint: %s", async (apiBase) => {
    useFile({ userToken: "file-fixture", apiBase });
    await import("../../src/config.js");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a Rollbar HTTPS endpoint from a file", async () => {
    useFile({
      userToken: "file-fixture",
      apiBase: "https://api.rollbar.com/api/1/",
    });
    const config = await import("../../src/config.js");
    expect(config.resolveUserAuthContext()).toEqual({
      token: "file-fixture",
      tokenType: "user",
      apiBase: defaultApi,
    });
    expect(process.exit).not.toHaveBeenCalled();
  });
});
