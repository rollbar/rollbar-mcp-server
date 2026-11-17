import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Keep MCP validation, configuration, handlers and HTTP handling real.
// Replace only configuration files and the external Rollbar HTTP boundary.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
const files = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: files.exists,
  readFileSync: files.read,
}));

const apiBase = "https://rollbar.example/api/1";
const starts = [
  { name: "start-rca", kind: "rca", args: { source_occurrence_id: "123456" } },
  {
    name: "start-rca",
    kind: "rca",
    args: { project_slug: "olympus", item_counter: 27024 },
  },
  {
    name: "start-resolve",
    kind: "resolve",
    args: { rca_task_session_id: "rca-session" },
  },
];

function ok(taskSessionId = "new-session", sourceOccurrenceId?: string) {
  return new Response(
    JSON.stringify({
      err: 0,
      result: {
        task_session_id: taskSessionId,
        ...(sourceOccurrenceId === undefined
          ? {}
          : { source_occurrence_id: sourceOccurrenceId }),
      },
    }),
  );
}

describe("agent task starts over MCP", () => {
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
    ]) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "user-write-token");
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
    client = new Client({ name: "agent-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  async function call(name: string, args: Record<string, unknown>) {
    const result = CallToolResultSchema.parse(
      await client.callTool({ name, arguments: args }),
    );
    const text = result.content.find((entry) => entry.type === "text")?.text;
    expect(typeof text).toBe("string");
    return { isError: result.isError, text: text as string };
  }

  it("advertises both tools as non-idempotent writes without a project selector", async () => {
    await connect();
    const { tools } = await client.listTools();
    for (const { name } of starts) {
      const tool = tools.find((entry) => entry.name === name);
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: false,
      });
      expect(tool?.inputSchema.properties).not.toHaveProperty("project");
    }
    const rca = tools.find((entry) => entry.name === "start-rca");
    expect(rca?.inputSchema.properties).toMatchObject({
      source_occurrence_id: { type: "string" },
      project_slug: { type: "string" },
      item_counter: { type: "integer", minimum: 1 },
      continue_with_resolve: { type: "boolean", default: false },
    });
    expect(rca?.inputSchema.required ?? []).not.toContain(
      "source_occurrence_id",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(starts)(
    "starts $kind with one authenticated JSON POST and returns its session",
    async ({ name, kind, args }) => {
      fetchMock.mockResolvedValueOnce(
        ok("new-session", kind === "rca" ? "123456" : undefined),
      );
      await connect();
      const result = await call(name, args);
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.text)).toEqual({
        task_session_id: "new-session",
        ...(kind === "rca" ? { source_occurrence_id: "123456" } : {}),
      });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${apiBase}/agent_tasks/${kind}`,
        {
          method: "POST",
          headers: {
            "X-Rollbar-Access-Token": "user-write-token",
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": expect.stringContaining(`(tool: ${name})`),
          },
          body: JSON.stringify(
            kind === "rca" ? { ...args, continue_with_resolve: false } : args,
          ),
        },
      );
    },
  );

  describe.each([
    { source_occurrence_id: "123456" },
    { project_slug: "olympus", item_counter: 27024 },
  ])("RCA source %j", (source) => {
    it.each([false, true])(
      "forwards explicit continue_with_resolve=%s",
      async (continueWithResolve) => {
        fetchMock.mockResolvedValueOnce(ok("new-session", "123456"));
        await connect();
        const result = await call("start-rca", {
          ...source,
          continue_with_resolve: continueWithResolve,
        });
        expect(result.isError).toBeFalsy();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
          ...source,
          continue_with_resolve: continueWithResolve,
        });
      },
    );
  });

  it.each(["18446744073709551615", "0123456789abcdef0123456789abcdef"])(
    "preserves opaque occurrence ID %s without numeric conversion",
    async (id) => {
      fetchMock.mockResolvedValueOnce(ok("new-session", id));
      await connect();
      const result = await call("start-rca", { source_occurrence_id: id });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.text).source_occurrence_id).toBe(id);
      expect(
        JSON.parse(fetchMock.mock.calls[0][1].body).source_occurrence_id,
      ).toBe(id);
    },
  );

  it.each([
    ["empty", ""],
    ["arbitrary text", '  Use approach B.\n"Add a regression test" 🔎\t'],
    ["4000 ASCII characters", "x".repeat(4000)],
    ["4000 Unicode code points", "🔎".repeat(4000)],
  ])("preserves instructions: %s", async (_label, instructions) => {
    fetchMock.mockResolvedValueOnce(ok("resolve-session"));
    await connect();
    const result = await call("start-resolve", {
      rca_task_session_id: "rca-session",
      initial_instructions: instructions,
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual({
      task_session_id: "resolve-session",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      rca_task_session_id: "rca-session",
      initial_instructions: instructions,
    });
  });

  it.each(starts.filter(({ args }) => !("project_slug" in args)))(
    "rejects invalid $kind IDs before HTTP",
    async ({ name, args }) => {
      await connect();
      const field = Object.keys(args)[0];
      for (const value of [undefined, null, "", " \n\t", 123456]) {
        const result = await call(name, { [field]: value });
        expect(result.isError).toBe(true);
        expect(result.text).toContain(field);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects item IDs as an alternative RCA argument", async () => {
    await connect();
    const result = await call("start-rca", { item_id: "123456" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("source_occurrence_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { project_slug: "olympus" },
    { item_counter: 27024 },
    { source_occurrence_id: "123456", project_slug: "olympus" },
    { source_occurrence_id: "123456", item_counter: 27024 },
    {
      source_occurrence_id: "123456",
      project_slug: "olympus",
      item_counter: 27024,
    },
  ])("rejects missing, incomplete or mixed RCA sources: %j", async (args) => {
    fetchMock.mockResolvedValueOnce(ok("new-session", "123456"));
    await connect();
    const result = await call("start-rca", args);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("source_occurrence_id");
    expect(result.text).toContain("project_slug");
    expect(result.text).toContain("item_counter");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { project_slug: "" },
    { project_slug: " \n\t" },
    { project_slug: null },
    { project_slug: 123 },
    { item_counter: null },
    { item_counter: "27024" },
    { item_counter: true },
    { item_counter: 0 },
    { item_counter: -1 },
    { item_counter: 1.5 },
    { item_counter: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid RCA item identifiers: %j", async (invalid) => {
    await connect();
    const result = await call("start-rca", {
      project_slug: "olympus",
      item_counter: 27024,
      ...invalid,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(Object.keys(invalid)[0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", " \n\t", 123456])(
    "rejects an invalid selected occurrence in an RCA success without retrying: %j",
    async (sourceOccurrenceId) => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            err: 0,
            result: {
              task_session_id: "new-session",
              source_occurrence_id: sourceOccurrenceId,
            },
          }),
        ),
      );
      await connect();
      const result = await call("start-rca", {
        project_slug: "olympus",
        item_counter: 27024,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("Invalid Rollbar API response");
      expect(result.text).toContain("source occurrence ID");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["true", 1, null])(
    "rejects non-boolean continuation: %j",
    async (value) => {
      await connect();
      const result = await call("start-rca", {
        source_occurrence_id: "123456",
        continue_with_resolve: value,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("continue_with_resolve");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects non-string or over-limit instructions before HTTP", async () => {
    await connect();
    for (const value of [123, null, "x".repeat(4001), "🔎".repeat(4001)]) {
      const result = await call("start-resolve", {
        rca_task_session_id: "rca-session",
        initial_instructions: value,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("initial_instructions");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(starts)(
    "uses file user credentials and API base for $kind without project discovery",
    async ({ name, kind, args }) => {
      vi.stubEnv("ROLLBAR_CONFIG_FILE", "/test/rollbar.json");
      files.exists.mockImplementation(
        (path: string) => path === "/test/rollbar.json",
      );
      files.read.mockReturnValue(
        JSON.stringify({
          userToken: "file-user-token",
          apiBase: "https://staging.example/api/1/",
          projects: [
            { name: "Backend", token: "project-token-1" },
            { name: "Frontend", token: "project-token-2" },
          ],
        }),
      );
      fetchMock.mockResolvedValueOnce(
        ok("new-session", kind === "rca" ? "123456" : undefined),
      );
      await connect();
      expect((await call(name, args)).isError).toBeFalsy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toMatch(
        /^https:\/\/staging.example\/api\/1\/agent_tasks\//,
      );
      expect(fetchMock.mock.calls[0][1].headers["X-Rollbar-Access-Token"]).toBe(
        "file-user-token",
      );
    },
  );

  describe.each(starts)("$name failures", ({ name, args }) => {
    it.each(["ROLLBAR_ACCESS_TOKEN", "ROLLBAR_ACCOUNT_ACCESS_TOKEN"])(
      "refuses %s without discovery or task creation",
      async (credential) => {
        vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "");
        vi.stubEnv(credential, "non-user-token");
        await connect();
        const result = await call(name, args);
        expect(result.isError).toBe(true);
        expect(result.text).toContain("ROLLBAR_USER_ACCESS_TOKEN");
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it.each([
      [400, "Invalid input"],
      [401, "Invalid access token"],
      [403, "Requires user-scoped account token"],
      [404, "RCA task not found"],
      [409, "An active task already exists"],
      [422, "Insufficient credits"],
      [500, "Service unavailable"],
    ])("preserves HTTP %i errors without retrying", async (status, message) => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ err: 1, message }), { status }),
      );
      await connect();
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain(message);
      if (status === 403) {
        expect(result.text).toContain("write scope");
        expect(result.text).toContain("collab");
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("preserves an err response on HTTP 200", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ err: 1, message: "RCA is not completed" }),
        ),
      );
      await connect();
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain("RCA is not completed");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      null,
      { err: 0 },
      { err: 0, result: null },
      ...[
        {},
        { task_session_id: "" },
        { task_session_id: "  " },
        { task_session_id: 123 },
      ].map((result) => ({ err: 0, result })),
    ])("rejects malformed success envelopes: %j", async (body) => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
      await connect();
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain("Invalid Rollbar API response");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry an uncertain POST after a network failure", async () => {
      fetchMock.mockRejectedValueOnce(
        new Error("Connection lost after sending request"),
      );
      await connect();
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain("Connection lost");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
