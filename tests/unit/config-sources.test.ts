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

  it.each([
    "config.json",
    "./config.json",
    "../config.json",
    "~other/config.json",
    "~",
  ])(
    "rejects a config path that could depend on the working directory: %s",
    async (location) => {
      vi.stubEnv("ROLLBAR_CONFIG_FILE", location);
      vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-user-fixture");
      files.exists.mockReturnValue(true);
      files.read.mockReturnValue(JSON.stringify({ userToken: "repo-user" }));

      await import("../../src/config.js");

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("absolute path"),
      );
      expect(files.exists).not.toHaveBeenCalled();
      expect(files.read).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
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
    "http://api-staging.rollbardev.com/api/1",
    "http://dev01-moxapi.rollbar.dev/api/1",
    "https://api-staging.rollbardev.com.example/api/1",
    "https://other.rollbardev.com/api/1",
    "https://dev01-moxapi.rollbar.dev.example/api/1",
    "https://other.rollbar.dev/api/1",
    "http://localhost.example/api/1",
    "http://192.168.1.1/api/1",
  ])("rejects file endpoint: %s", async (apiBase) => {
    useFile({ userToken: "file-fixture", apiBase });
    await import("../../src/config.js");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  describe.each(["home", "explicit"] as const)(
    "%s file endpoints",
    (source) => {
      it.each([
        "https://api-staging.rollbardev.com/api/1",
        "https://dev01-moxapi.rollbar.dev/api/1",
        "https://dev02-moxapi.rollbar.dev/api/1",
        "https://dev03-moxapi.rollbar.dev/api/1",
        "http://localhost:12345/api/1",
        "http://127.0.0.1:12345/api/1",
        "http://[::1]:12345/api/1",
      ])(
        "keeps the selected token and endpoint together: %s",
        async (apiBase) => {
          useFile({ userToken: "file-user", apiBase: `${apiBase}/` }, source);
          vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "ignored-env-user");
          vi.stubEnv("ROLLBAR_API_BASE", defaultApi);

          const config = await import("../../src/config.js");

          expect(process.exit).not.toHaveBeenCalled();
          expect(config.resolveUserAuthContext()).toEqual({
            token: "file-user",
            tokenType: "user",
            apiBase,
          });
        },
      );
    },
  );

  it("routes a hybrid staging config through its project and account tokens", async () => {
    const apiBase = "https://api-staging.rollbardev.com/api/1";
    useFile({
      apiBase,
      accountToken: "staging-account",
      projects: [
        { name: "Backend", token: "staging-backend" },
        { name: "Frontend", token: "staging-frontend" },
      ],
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          err: 0,
          result: [{ id: 42, name: "Other", status: "enabled" }],
        }),
      ),
    );
    const config = await import("../../src/config.js");

    expect(process.exit).not.toHaveBeenCalled();
    expect(await config.resolveAuthContext("Backend")).toEqual({
      token: "staging-backend",
      tokenType: "project",
      apiBase,
    });
    expect(await config.resolveAuthContext("Frontend")).toEqual({
      token: "staging-frontend",
      tokenType: "project",
      apiBase,
    });
    expect(await config.resolveAuthContext("Other")).toEqual({
      token: "staging-account",
      tokenType: "account",
      apiBase,
      projectId: 42,
    });
    expect(fetch).toHaveBeenCalledWith(`${apiBase}/projects`, {
      headers: {
        "X-Rollbar-Access-Token": "staging-account",
        Accept: "application/json",
      },
    });
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

describe("configuration diagnostics", () => {
  it.each([
    { token: "project-secret" },
    { projects: [{ name: "Backend", token: "project-secret" }] },
    { userToken: "user-secret" },
    { accountToken: "account-secret" },
    {
      accountToken: "account-secret",
      projects: [{ name: "Backend", token: "project-secret" }],
    },
  ])(
    "explains an invalid apiBase without exposing credentials: %j",
    async (credentials) => {
      useFile({
        ...credentials,
        apiBase: "https://username:password@custom.example/api/1",
      });

      await import("../../src/config.js");

      expect(process.exit).toHaveBeenCalledWith(1);
      const message = vi.mocked(console.error).mock.calls.flat().join(" ");
      expect(message).toContain("apiBase");
      expect(message).toContain("HTTPS");
      expect(message).toContain("credentials");
      expect(message).not.toMatch(
        /project-secret|account-secret|user-secret|username|password/,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("identifies an invalid project field rather than rejecting the whole config shape", async () => {
    useFile({ projects: [{ name: "Backend", token: 123 }] });

    await import("../../src/config.js");

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("projects.0.token"),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("string"),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
