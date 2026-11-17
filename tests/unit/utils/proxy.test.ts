import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mockSetGlobalDispatcher = vi.fn();
const mockProxyAgentConstructor = vi.fn();

vi.mock("undici", () => ({
  setGlobalDispatcher: mockSetGlobalDispatcher,
  ProxyAgent: mockProxyAgentConstructor,
}));

describe("proxy setup", () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();
  let tempDir: string | undefined;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const name of [
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "https_proxy",
      "http_proxy",
    ]) {
      delete process.env[name];
    }
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.chdir(originalCwd);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("sets global dispatcher when HTTPS_PROXY is set", async () => {
    process.env.HTTPS_PROXY = "http://proxy.example.com:8080";
    await import("../../../src/utils/proxy.js");
    expect(mockProxyAgentConstructor).toHaveBeenCalledWith(
      "http://proxy.example.com:8080",
    );
    expect(mockSetGlobalDispatcher).toHaveBeenCalledTimes(1);
  });

  it("sets global dispatcher when HTTP_PROXY is set", async () => {
    process.env.HTTP_PROXY = "http://proxy.example.com:8080";
    await import("../../../src/utils/proxy.js");
    expect(mockProxyAgentConstructor).toHaveBeenCalledWith(
      "http://proxy.example.com:8080",
    );
    expect(mockSetGlobalDispatcher).toHaveBeenCalledTimes(1);
  });

  it("sets global dispatcher when lowercase https_proxy is set", async () => {
    process.env.https_proxy = "http://proxy.example.com:8080";
    await import("../../../src/utils/proxy.js");
    expect(mockProxyAgentConstructor).toHaveBeenCalledWith(
      "http://proxy.example.com:8080",
    );
    expect(mockSetGlobalDispatcher).toHaveBeenCalledTimes(1);
  });

  it("sets global dispatcher when lowercase http_proxy is set", async () => {
    process.env.http_proxy = "http://proxy.example.com:8080";
    await import("../../../src/utils/proxy.js");
    expect(mockProxyAgentConstructor).toHaveBeenCalledWith(
      "http://proxy.example.com:8080",
    );
    expect(mockSetGlobalDispatcher).toHaveBeenCalledTimes(1);
  });

  it("prefers HTTPS_PROXY over HTTP_PROXY", async () => {
    process.env.HTTPS_PROXY = "http://https-proxy.example.com:8080";
    process.env.HTTP_PROXY = "http://http-proxy.example.com:8080";
    await import("../../../src/utils/proxy.js");
    expect(mockProxyAgentConstructor).toHaveBeenCalledWith(
      "http://https-proxy.example.com:8080",
    );
  });

  it("does not set global dispatcher when no proxy env vars are set", async () => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.http_proxy;
    await import("../../../src/utils/proxy.js");
    expect(mockSetGlobalDispatcher).not.toHaveBeenCalled();
  });

  it("does not load proxy values from a working-directory .env", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rollbar-mcp-proxy-"));

    writeFileSync(
      path.join(tempDir, ".env"),
      "ROLLBAR_ACCESS_TOKEN=test-token\nHTTPS_PROXY=http://proxy.example.com:8080\n",
    );

    process.chdir(tempDir);
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    delete process.env.ROLLBAR_CONFIG_FILE;
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.http_proxy;

    await import("../../../src/utils/proxy.js");

    expect(mockProxyAgentConstructor).not.toHaveBeenCalled();
    expect(mockSetGlobalDispatcher).not.toHaveBeenCalled();
  });
});
