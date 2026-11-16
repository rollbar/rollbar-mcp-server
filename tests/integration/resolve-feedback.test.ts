import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Exercise real registration, MCP validation, auth and HTTP/error handling.
// Only configuration files and the external HTTP boundary are substituted.
const files = vi.hoisted(() => ({ exists: vi.fn(), read: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: files.exists,
  readFileSync: files.read,
}));

const apiBase = "https://rollbar.example/api/1";
const toolName = "send-resolve-feedback";
const feedback = {
  task_session_id: "resolve-run",
  feedback_id: "feedback-entry",
};

describe("Resolve feedback over MCP", () => {
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
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "personal-write-token");
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
    client = new Client({ name: "feedback-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  async function call(
    args: Record<string, unknown> = {
      task_session_id: "resolve-run",
      content: "Cover retries.",
    },
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

  it("advertises a non-idempotent write with session and content inputs", async () => {
    await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === toolName);
    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(tool?.inputSchema.required).toEqual(["task_session_id", "content"]);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([
      "task_session_id",
      "content",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits trimmed feedback once with the personal token and returns the same run", async () => {
    reply(feedback);
    await connect();
    const result = await call({
      task_session_id: "resolve-run",
      content: " \n Use approach B and cover the retry path.\t ",
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual({
      task_session_id: "resolve-run",
      feedback_id: "feedback-entry",
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${apiBase}/agent_tasks/resolve-run/feedback`,
      {
        method: "POST",
        headers: {
          "X-Rollbar-Access-Token": "personal-write-token",
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": expect.stringContaining(`(tool: ${toolName})`),
        },
        body: JSON.stringify({
          content: "Use approach B and cover the retry path.",
        }),
      },
    );
  });

  it("preserves internal whitespace and Unicode without an unrelated 4,000-character limit", async () => {
    reply(feedback);
    await connect();
    const content = "Fix 🔎\n\n  retry\tpaths.\n" + "x".repeat(4001);
    expect(
      (
        await call({
          task_session_id: "resolve-run",
          content: `  ${content}  `,
        })
      ).isError,
    ).toBeFalsy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ content });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encodes the opaque session ID as one path segment", async () => {
    const id = "run/a?state=finished#fragment%20🔎";
    reply({ ...feedback, task_session_id: id });
    await connect();
    expect(
      (await call({ task_session_id: id, content: "Cover retries." })).isError,
    ).toBeFalsy();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${apiBase}/agent_tasks/run%2Fa%3Fstate%3Dfinished%23fragment%2520%F0%9F%94%8E/feedback`,
    );
  });

  it.each([undefined, null, "", " \n\t", 123, ".", ".."])(
    "rejects an invalid session ID before HTTP: %j",
    async (id) => {
      await connect();
      const result = await call({
        task_session_id: id,
        content: "Cover retries.",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("task_session_id");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, "", " \n\t", "\u00a0\u2003", 123, {}, []])(
    "rejects invalid feedback before HTTP: %j",
    async (content) => {
      await connect();
      const result = await call({ task_session_id: "resolve-run", content });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("content");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("uses file user credentials and API base with multiple configured projects", async () => {
    vi.stubEnv("ROLLBAR_CONFIG_FILE", "/test/feedback.json");
    files.exists.mockImplementation(
      (path: string) => path === "/test/feedback.json",
    );
    files.read.mockReturnValue(
      JSON.stringify({
        userToken: "file-personal-token",
        apiBase: "https://api-staging.rollbardev.com/api/1/",
        projects: [
          { name: "one", token: "project-one" },
          { name: "two", token: "project-two" },
        ],
      }),
    );
    reply(feedback);
    await connect();
    expect((await call()).isError).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api-staging.rollbardev.com/api/1/agent_tasks/resolve-run/feedback",
    );
    expect(fetchMock.mock.calls[0][1].headers["X-Rollbar-Access-Token"]).toBe(
      "file-personal-token",
    );
  });

  it.each(["ROLLBAR_ACCESS_TOKEN", "ROLLBAR_ACCOUNT_ACCESS_TOKEN"])(
    "refuses fallback to %s without making an HTTP request",
    async (credential) => {
      vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "");
      vi.stubEnv(credential, "non-user-token");
      await connect();
      const result = await call();
      expect(result.isError).toBe(true);
      expect(result.text).toContain("ROLLBAR_USER_ACCESS_TOKEN");
      expect(result.text).toContain("write scope");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [400, "content must be a non-blank string"],
    [401, "Invalid token"],
    [403, "Requires collab permission on every Resolve task project"],
    [403, "AI features are not enabled for this account"],
    [404, "Resolve task not found"],
    [409, "Feedback has already requested a continuation"],
    [422, "Resolve task cannot continue from status RUNNING"],
    [422, "Insufficient credits"],
    [503, "Could not deliver continuation"],
  ])(
    "preserves backend %s errors without retrying",
    async (status, message) => {
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
        expect(result.text).toContain("write scope");
        expect(result.text).toContain("collab");
        expect(result.text).toContain("every project");
        expect(result.text).toContain("AI features");
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves a Rollbar error inside HTTP 200 without retrying", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ err: 1, message: "Continuation refused" })),
    );
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Continuation refused");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    "text",
    {},
    { err: 0 },
    ...[
      null,
      [],
      1,
      "text",
      {},
      { task_session_id: "resolve-run" },
      { feedback_id: "feedback-entry" },
      { ...feedback, task_session_id: "another-run" },
      { ...feedback, task_session_id: "" },
      { ...feedback, feedback_id: " \n" },
      { ...feedback, feedback_id: 123 },
    ].map((result) => ({ err: 0, result })),
  ])("rejects a malformed success response: %j", async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(
      /Invalid Rollbar API response|Rollbar API returned error/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves future result fields", async () => {
    reply({ ...feedback, continuation: { queued: true } });
    await connect();
    const result = await call();
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual({
      ...feedback,
      continuation: { queued: true },
    });
  });

  it("does not retry an uncertain network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Connection reset after write"));
    await connect();
    const result = await call();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Connection reset after write");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
