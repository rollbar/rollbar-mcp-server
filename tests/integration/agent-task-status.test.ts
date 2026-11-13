import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Exercise real registration, MCP validation, auth and HTTP/error handling.
// Only configuration files and the external HTTP boundary are substituted.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const files = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: files.exists,
  readFileSync: files.read,
}));

const apiBase = "https://rollbar.example/api/1";
const toolName = "get-agent-task-status";
const run = { task_session_id: "run-id", agent_type: "rca", status: "queued" };

describe("agent task status over MCP", () => {
  let client: Client;
  let server: McpServer;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    for (const name of [
      "ROLLBAR_ACCESS_TOKEN",
      "ROLLBAR_ACCOUNT_ACCESS_TOKEN",
      "ROLLBAR_USER_ACCESS_TOKEN",
      "ROLLBAR_CONFIG_FILE",
    ])
      vi.stubEnv(name, "");
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "personal-read-token");
    vi.stubEnv("ROLLBAR_API_BASE", `${apiBase}/`);
    files.exists.mockReturnValue(false);
    files.read.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function connect() {
    const { registerAllTools } = await import("../../src/tools/index.js");
    server = new McpServer({ name: "rollbar-test", version: "1.0.0" });
    registerAllTools(server);
    client = new Client({ name: "status-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  async function call(
    args: Record<string, unknown> = { task_session_id: "run-id" },
  ) {
    const result = CallToolResultSchema.parse(
      await client.callTool({ name: toolName, arguments: args }),
    );
    const text = result.content.find((entry) => entry.type === "text")?.text;
    expect(typeof text).toBe("string");
    return { isError: result.isError, text: text as string };
  }

  function reply(result: unknown) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ err: 0, result })),
    );
  }

  it("advertises a read-only idempotent tool with only the required session ID", async () => {
    await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === toolName);
    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
    expect(tool?.inputSchema.required).toEqual(["task_session_id"]);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([
      "task_session_id",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses one personal-token GET without project discovery or a request body", async () => {
    reply(run);
    await connect();
    const result = await call();
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual(run);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${apiBase}/agent_tasks/run-id`,
      {
        method: "GET",
        headers: {
          "X-Rollbar-Access-Token": "personal-read-token",
          Accept: "application/json",
          "User-Agent": expect.stringContaining(`(tool: ${toolName})`),
        },
      },
    );
  });

  it.each([
    "queued",
    "running",
    "blocked",
    "canceling",
    "finished",
    "failed",
    "canceled",
  ])(
    "preserves status %s without synthesizing results or failure reasons",
    async (status) => {
      reply({ ...run, status });
      await connect();
      const result = await call();
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.text)).toEqual({ ...run, status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {
      ...run,
      status: "finished",
      rca_results: {
        results: {
          root_cause: "Missing validation\nfor null input",
          context: "request",
          probable_solution: "Validate input",
        },
        confidence_score: 0.8,
      },
      future_field: { value: true },
    },
    {
      ...run,
      agent_type: "resolve",
      status: "finished",
      resolve_results: {
        pull_request_url: "https://github.com/example/repo/pull/1",
        changed_files: ["example.py"],
      },
    },
    { ...run, status: "finished", rca_results: null },
    {
      ...run,
      agent_type: "resolve",
      status: "finished",
      resolve_results: null,
    },
    {
      ...run,
      status: "failed",
      failure_reason: {
        agent_failure_code: "AGENT_COMMAND_FAILED",
        message: "Execution failed",
      },
    },
  ])("preserves complete optional output: %j", async (payload) => {
    reply(payload);
    await connect();
    const result = await call();
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual(payload);
  });

  it("encodes an opaque session ID as one path segment", async () => {
    const id = "run/a?state=finished#fragment%20🔎";
    reply({ ...run, task_session_id: id });
    await connect();
    expect((await call({ task_session_id: id })).isError).toBeFalsy();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${apiBase}/agent_tasks/run%2Fa%3Fstate%3Dfinished%23fragment%2520%F0%9F%94%8E`,
    );
  });

  it.each([undefined, null, "", " \n\t", 123, ".", ".."])(
    "rejects an invalid session ID before HTTP: %j",
    async (id) => {
      await connect();
      const result = await call({ task_session_id: id });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("task_session_id");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("uses file user credentials and API base even with multiple project tokens", async () => {
    vi.stubEnv("ROLLBAR_CONFIG_FILE", "/test/status.json");
    files.exists.mockImplementation(
      (path: string) => path === "/test/status.json",
    );
    files.read.mockReturnValue(
      JSON.stringify({
        userToken: "file-personal-token",
        apiBase: "http://local-api.invalid/api/1/",
        projects: [
          { name: "one", token: "project-one" },
          { name: "two", token: "project-two" },
        ],
      }),
    );
    reply(run);
    await connect();
    expect((await call()).isError).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://local-api.invalid/api/1/agent_tasks/run-id",
    );
    expect(fetchMock.mock.calls[0][1].headers["X-Rollbar-Access-Token"]).toBe(
      "file-personal-token",
    );
  });

  it.each(["ROLLBAR_ACCESS_TOKEN", "ROLLBAR_ACCOUNT_ACCESS_TOKEN"])(
    "refuses %s without HTTP or suggesting write permission",
    async (credential) => {
      vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "");
      vi.stubEnv(credential, "non-user-token");
      await connect();
      const result = await call();
      expect(result.isError).toBe(true);
      expect(result.text).toContain("ROLLBAR_USER_ACCESS_TOKEN");
      expect(result.text).toContain("read scope");
      expect(result.text).not.toContain("write scope");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [403, "Requires view permission on every agent task project"],
    [403, "AI features are not enabled for this account"],
    [404, "Agent task not found"],
    [401, "Invalid access token"],
    [429, "Rate limit exceeded"],
    [500, "Service unavailable"],
  ])("preserves HTTP %i errors: %s", async (status, message) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ err: 1, message }), {
        status: status as number,
      }),
    );
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain(message);
    if (status === 403) {
      expect(result.text).toContain("read scope");
      expect(result.text).toContain("view");
      expect(result.text).not.toContain("write scope");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces err on HTTP 200 as a tool error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ err: 1, message: "Run unavailable" })),
    );
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Run unavailable");
  });

  it.each([
    null,
    { err: 0 },
    { err: 0, result: null },
    ...[
      false,
      "run-id",
      [],
      {},
      { ...run, task_session_id: " " },
      { ...run, task_session_id: 42 },
      { ...run, agent_type: "unknown" },
      { ...run, agent_type: null },
      { ...run, status: "completed" },
      { ...run, status: null },
    ].map((result) => ({ err: 0, result })),
  ])("rejects a malformed success response: %j", async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Invalid Rollbar API response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a network failure without retrying or polling", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Connection refused"));
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Connection refused");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
