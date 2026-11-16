import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(
  new URL("../../build/index.js", import.meta.url),
);
const networkGuard = fileURLToPath(
  new URL("./fixtures/local-network.mjs", import.meta.url),
);
const tokenNames = [
  "ROLLBAR_USER_ACCESS_TOKEN",
  "ROLLBAR_ACCOUNT_ACCESS_TOKEN",
  "ROLLBAR_ACCESS_TOKEN",
];
let root, cwd, home, api, alternate, sessions;

async function fixtureServer() {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({
      method: req.method,
      path: req.url,
      token: req.headers["x-rollbar-access-token"],
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        err: 0,
        result: [{ id: 123, name: "Local fixture", status: "enabled" }],
      }),
    );
  });
  server.on("connect", (req, socket) => {
    requests.push({ method: "CONNECT", path: req.url });
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return { server, requests, port, url: `http://127.0.0.1:${port}/api/1` };
}

beforeEach(async () => {
  sessions = [];
  api = alternate = undefined;
  root = await mkdtemp(join(tmpdir(), "mcp-config-e2e-"));
  cwd = join(root, "project");
  home = join(root, "home");
  await Promise.all([mkdir(cwd), mkdir(home)]);
  api = await fixtureServer();
  alternate = await fixtureServer();
});

afterEach(async () => {
  for (const { client, transport } of sessions) {
    await client.close();
    await transport.close();
  }
  for (const fixture of [api, alternate].filter(Boolean)) {
    fixture.server.closeAllConnections();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
  await rm(root, { recursive: true, force: true });
  if (alternate)
    assert.equal(
      alternate.requests.length,
      0,
      "The unselected endpoint received a request",
    );
  for (const session of sessions) {
    assert(!session.stderr.includes("LOCAL_NETWORK_ONLY"), session.stderr);
    assert(
      !session.stderr.includes("-fixture-token"),
      "A credential was logged",
    );
  }
});

function session(env = {}) {
  const client = new Client({ name: "local-config-check", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", networkGuard, serverPath],
    cwd,
    stderr: "pipe",
    env: {
      HOME: home,
      USERPROFILE: home,
      PATH: process.env.PATH ?? "",
      MCP_TEST_API_PORT: String(api.port),
      ...env,
    },
  });
  const result = { client, transport, stderr: "" };
  transport.stderr.on("data", (data) => {
    result.stderr += data.toString();
  });
  sessions.push(result);
  return result;
}

async function listProjects(env) {
  const { client, transport } = session(env);
  await client.connect(transport, { timeout: 5000 });
  const tools = await client.listTools();
  assert(tools.tools.some((tool) => tool.name === "list-projects"));
  const result = await client.callTool(
    { name: "list-projects", arguments: {} },
    undefined,
    { timeout: 5000 },
  );
  assert(!result.isError, JSON.stringify(result));
  return result;
}

function assertApiToken(token) {
  assert(api.requests.length > 0, "Expected a real local HTTP request");
  for (const request of api.requests) {
    assert.equal(request.method, "GET");
    assert.equal(request.path, "/api/1/projects");
    assert.equal(request.token, token);
  }
}

async function rejectsStartup(env, message) {
  const run = session(env);
  await assert.rejects(run.client.connect(run.transport, { timeout: 5000 }));
  assert.match(run.stderr, message);
  assert.equal(api.requests.length, 0);
}

for (const tokenName of tokenNames) {
  test(
    `ignores a cwd .env endpoint with ${tokenName}`,
    { timeout: 10000 },
    async () => {
      await writeFile(join(cwd, ".env"), `ROLLBAR_API_BASE=${alternate.url}\n`);
      const result = await listProjects({ [tokenName]: "env-fixture-token" });
      assert.match(JSON.stringify(result), /Local fixture/);
      assertApiToken("env-fixture-token");
    },
  );

  test(
    `ignores a cwd JSON endpoint with ${tokenName}`,
    { timeout: 10000 },
    async () => {
      await writeFile(
        join(cwd, ".rollbar-mcp.json"),
        JSON.stringify({ token: "file-fixture-token", apiBase: alternate.url }),
      );
      await listProjects({ [tokenName]: "env-fixture-token" });
      assertApiToken("env-fixture-token");
    },
  );
}

for (const proxy of [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "https_proxy",
  "http_proxy",
]) {
  test(`ignores ${proxy} in cwd .env`, { timeout: 10000 }, async () => {
    await writeFile(
      join(cwd, ".env"),
      `${proxy}=http://127.0.0.1:${alternate.port}\n`,
    );
    await listProjects({ ROLLBAR_USER_ACCESS_TOKEN: "env-fixture-token" });
    assertApiToken("env-fixture-token");
  });
}

test(
  "does not load tokens or a config selector from cwd .env",
  { timeout: 10000 },
  async () => {
    const selected = join(root, "selected.json");
    await writeFile(
      selected,
      JSON.stringify({ userToken: "selected-fixture-token" }),
    );
    await writeFile(
      join(cwd, ".env"),
      `ROLLBAR_USER_ACCESS_TOKEN=dotenv-fixture-token\nROLLBAR_CONFIG_FILE=${selected}\n`,
    );
    await rejectsStartup({}, /No Rollbar configuration found/);
  },
);

for (const source of ["home", "explicit"]) {
  test(
    `uses only the ${source} file's credentials`,
    { timeout: 10000 },
    async () => {
      const selected =
        source === "home"
          ? join(home, ".rollbar-mcp.json")
          : join(cwd, ".rollbar-mcp.json");
      await writeFile(
        selected,
        JSON.stringify({ userToken: "selected-fixture-token" }),
      );
      await listProjects({
        ROLLBAR_ACCOUNT_ACCESS_TOKEN: "env-fixture-token",
        ROLLBAR_API_BASE: alternate.url,
        ...(source === "explicit" ? { ROLLBAR_CONFIG_FILE: selected } : {}),
      });
      assertApiToken("selected-fixture-token");
    },
  );

  test(
    `does not fill a ${source} project config with an environment user token`,
    { timeout: 10000 },
    async () => {
      const selected =
        source === "home"
          ? join(home, ".rollbar-mcp.json")
          : join(cwd, ".rollbar-mcp.json");
      await writeFile(
        selected,
        JSON.stringify({
          token: "selected-fixture-token",
          apiBase: "https://api.rollbar.com/api/1",
        }),
      );
      await listProjects({
        ROLLBAR_USER_ACCESS_TOKEN: "env-fixture-token",
        ...(source === "explicit" ? { ROLLBAR_CONFIG_FILE: selected } : {}),
      });
      assert.equal(
        api.requests.length,
        0,
        "Project config should not perform account discovery",
      );
    },
  );
}

test(
  "supports an explicit localhost API endpoint",
  { timeout: 10000 },
  async () => {
    await listProjects({
      ROLLBAR_USER_ACCESS_TOKEN: "env-fixture-token",
      ROLLBAR_API_BASE: api.url,
    });
    assertApiToken("env-fixture-token");
  },
);

test(
  "rejects non-local HTTP before any tool call",
  { timeout: 10000 },
  async () => {
    await rejectsStartup(
      {
        ROLLBAR_USER_ACCESS_TOKEN: "env-fixture-token",
        ROLLBAR_API_BASE: "http://api.example.invalid/api/1",
      },
      /ROLLBAR_API_BASE must be an HTTPS URL/,
    );
  },
);

for (const endpoint of [
  "https://api.example.invalid/api/1",
  "http://127.0.0.1:12345/api/1",
]) {
  test(
    `rejects a custom file endpoint: ${endpoint}`,
    { timeout: 10000 },
    async () => {
      const selected = join(home, ".rollbar-mcp.json");
      await writeFile(
        selected,
        JSON.stringify({
          userToken: "selected-fixture-token",
          apiBase: endpoint,
        }),
      );
      await rejectsStartup({}, /Invalid Rollbar config file/);
    },
  );
}
