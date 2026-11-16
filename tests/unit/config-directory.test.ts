import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const fixtures = vi.hoisted(() => ({
  home: "",
  dispatcher: vi.fn(),
  proxy: vi.fn(),
}));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => fixtures.home,
}));
vi.mock("undici", () => ({
  setGlobalDispatcher: fixtures.dispatcher,
  ProxyAgent: fixtures.proxy,
}));

const tokens = [
  "ROLLBAR_USER_ACCESS_TOKEN",
  "ROLLBAR_ACCOUNT_ACCESS_TOKEN",
  "ROLLBAR_ACCESS_TOKEN",
];
const proxies = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"];
const defaultApi = "https://api.rollbar.com/api/1";
let originalCwd: string;
let directory: string;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  originalCwd = process.cwd();
  directory = mkdtempSync(path.join(tmpdir(), "mcp-config-unit-"));
  fixtures.home = path.join(directory, "home");
  const project = path.join(directory, "project");
  mkdirSync(fixtures.home);
  mkdirSync(project);
  process.chdir(project);
  for (const name of [
    ...tokens,
    ...proxies,
    "ROLLBAR_API_BASE",
    "ROLLBAR_CONFIG_FILE",
  ]) {
    vi.stubEnv(name, undefined);
  }
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            err: 0,
            result: [{ id: 123, name: "Fixture", status: "enabled" }],
          }),
        ),
    ),
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("working-directory configuration", () => {
  for (const filename of [".env", ".rollbar-mcp.json"]) {
    it.each(tokens)(`ignores ${filename} when using %s`, async (tokenName) => {
      const otherApi = "https://other.example/api/1";
      writeFileSync(
        filename,
        filename === ".env"
          ? `ROLLBAR_API_BASE=${otherApi}\n`
          : JSON.stringify({ token: "file-fixture", apiBase: otherApi }),
      );
      vi.stubEnv(tokenName, "env-fixture");

      const { resolveAuthContext } = await import("../../src/config.js");
      expect(await resolveAuthContext(undefined)).toMatchObject({
        token: "env-fixture",
        apiBase: defaultApi,
        projectId: 123,
      });
      expect(process.exit).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalled();
      for (const [url, options] of vi.mocked(fetch).mock.calls) {
        expect(url).toBe(`${defaultApi}/projects`);
        expect(options?.headers).toHaveProperty(
          "X-Rollbar-Access-Token",
          "env-fixture",
        );
      }
    });
  }

  it.each(proxies)(
    "ignores %s in .env during configuration and proxy setup",
    async (proxy) => {
      writeFileSync(".env", `${proxy}=http://proxy.example:8080\n`);
      vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "env-fixture");
      await import("../../src/config.js");
      await import("../../src/utils/proxy.js");
      expect(process.env[proxy]).toBeUndefined();
      expect(fixtures.proxy).not.toHaveBeenCalled();
      expect(fixtures.dispatcher).not.toHaveBeenCalled();
    },
  );

  it.each([...tokens, "ROLLBAR_CONFIG_FILE"])(
    "does not take %s from .env",
    async (setting) => {
      const selected = path.join(directory, "selected.json");
      writeFileSync(selected, JSON.stringify({ userToken: "file-fixture" }));
      writeFileSync(
        ".env",
        `${setting}=${setting === "ROLLBAR_CONFIG_FILE" ? selected : "dotenv-fixture"}\n`,
      );

      await import("../../src/config.js");
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("No Rollbar configuration found"),
      );
      expect(process.env[setting]).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
