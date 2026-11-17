import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Use the public MCP boundary, substituting only configuration files and HTTP.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const files = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: files.exists,
  readFileSync: files.read,
}));

const apiBase = "https://rollbar.example/api/1";
const toolName = "list-agent-tasks";
const item = { project_slug: "olympus", item_counter: 27024 };
const run = {
  task_session_id: "resolve-session",
  agent_type: "resolve",
  status: "finished",
  date_created: 1794910000,
};

describe("agent task discovery over MCP", () => {
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
    client = new Client({ name: "discovery-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  async function call(args: Record<string, unknown> = item) {
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

  it("advertises required URL identifiers and optional pagination as a read-only tool", async () => {
    await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === toolName);
    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(tool?.inputSchema.required).toEqual([
      "project_slug",
      "item_counter",
    ]);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([
      "project_slug",
      "item_counter",
      "limit",
      "offset",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes one personal-token GET and preserves order, timestamps and additional fields", async () => {
    const payload = {
      tasks: [
        run,
        {
          ...run,
          task_session_id: "rca-session",
          agent_type: "rca",
          date_created: 1794909000,
          extra: true,
        },
      ],
      next_offset: null,
      extra: { value: true },
    };
    reply(payload);
    await connect();
    const result = await call();
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${apiBase}/agent_tasks?project_slug=olympus&item_counter=27024`,
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

  it("encodes the slug as one query value", async () => {
    reply({ tasks: [] });
    await connect();
    expect(
      (await call({ ...item, project_slug: "app &offset=99/#%🔎" })).isError,
    ).toBeFalsy();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${apiBase}/agent_tasks?project_slug=app+%26offset%3D99%2F%23%25%F0%9F%94%8E&item_counter=27024`,
    );
  });

  it.each([
    { tasks: [] },
    { tasks: [], next_offset: null },
    { tasks: [], next_offset: 12 },
    { tasks: [run], next_offset: 12 },
  ])(
    "returns one page unchanged without following next_offset: %j",
    async (payload) => {
      reply(payload);
      await connect();
      const result = await call({ ...item, limit: 2, offset: 10 });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.text)).toEqual(payload);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${apiBase}/agent_tasks?project_slug=olympus&item_counter=27024&limit=2&offset=10`,
      );
    },
  );

  it.each([
    { item_counter: 1, limit: 1, offset: 0 },
    { item_counter: 4294967295, limit: 100, offset: 4294967295 },
  ])("accepts documented pagination boundaries: %j", async (args) => {
    reply({ tasks: [], next_offset: null });
    await connect();
    expect((await call({ ...item, ...args })).isError).toBeFalsy();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${apiBase}/agent_tasks?project_slug=olympus&item_counter=${args.item_counter}&limit=${args.limit}&offset=${args.offset}`,
    );
  });

  it.each([
    ...[undefined, null, "", " \n", 123].map((project_slug) => ({
      ...item,
      project_slug,
    })),
    ...[
      undefined,
      null,
      0,
      -1,
      1.5,
      "27024",
      4294967296,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((item_counter) => ({ ...item, item_counter })),
    ...[null, 0, -1, 1.5, 101, "2"].map((limit) => ({ ...item, limit })),
    ...[null, -1, 0.5, 4294967296, "0"].map((offset) => ({ ...item, offset })),
  ])(
    "rejects invalid identifiers or pagination before HTTP: %j",
    async (args) => {
      await connect();
      expect((await call(args)).isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("uses file user credentials and custom API base with multiple configured projects", async () => {
    vi.stubEnv("ROLLBAR_CONFIG_FILE", "/test/discovery.json");
    files.exists.mockImplementation(
      (path: string) => path === "/test/discovery.json",
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
    reply({ tasks: [] });
    await connect();
    expect((await call()).isError).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://local-api.invalid/api/1/agent_tasks?project_slug=olympus&item_counter=27024",
    );
    expect(fetchMock.mock.calls[0][1].headers["X-Rollbar-Access-Token"]).toBe(
      "file-personal-token",
    );
  });

  it.each(["ROLLBAR_ACCESS_TOKEN", "ROLLBAR_ACCOUNT_ACCESS_TOKEN"])(
    "requires a personal read token instead of %s",
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
    [400, "Invalid item counter"],
    [401, "Invalid access token"],
    [403, "Requires view permission"],
    [403, "AI features are not enabled"],
    [404, "Item not found"],
    [429, "Rate limit exceeded"],
    [500, "Service unavailable"],
  ])("preserves HTTP %i and its error message: %s", async (status, message) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ err: 1, message }), {
        status: status as number,
      }),
    );
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain(message);
    expect(result.text).toContain(`HTTP ${status}`);
    if (status === 403) {
      expect(result.text).toContain("read scope");
      expect(result.text).toContain("view");
      expect(result.text).not.toContain("write scope");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces err on HTTP 200 as a tool error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ err: 1, message: "Item unavailable" })),
    );
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Item unavailable");
  });

  it.each([
    null,
    { err: 0 },
    { err: 0, result: null },
    ...[
      false,
      "tasks",
      [],
      {},
      { tasks: null },
      { tasks: {} },
      ...[
        null,
        false,
        [],
        {},
        { ...run, task_session_id: " " },
        { ...run, agent_type: "unknown" },
        { ...run, status: "completed" },
        { ...run, date_created: undefined },
        { ...run, date_created: "1794910000" },
        { ...run, date_created: 1.5 },
        { ...run, date_created: Number.MAX_SAFE_INTEGER + 1 },
      ].map((task) => ({ tasks: [task] })),
      ...[-1, 1.5, "2", false, Number.MAX_SAFE_INTEGER + 1].map(
        (next_offset) => ({ tasks: [], next_offset }),
      ),
    ].map((result) => ({ err: 0, result })),
  ])("rejects malformed success payloads: %j", async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Invalid Rollbar API response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates network failure without retrying", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Connection refused"));
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Connection refused");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
