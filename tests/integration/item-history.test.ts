import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { ITEM_EVENT_TYPES } from "../../src/types/index.js";

// Exercise the real MCP schemas, handlers, auth, and HTTP client. Only the
// configuration files and external Rollbar responses are replaced.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("node:fs", () => ({ existsSync: () => false, readFileSync: vi.fn() }));

const apiBase = "https://rollbar.example/api/1";
const project = { id: 456, name: "Backend", status: "enabled" };
const comment = {
  id: 8,
  type: "comment",
  source: "comment",
  item_id: 123,
  user_id: 42,
  username: "andres",
  timestamp: 100,
  text: "Investigated",
  via_api: true,
};
const events = ITEM_EVENT_TYPES.map((type, index) => ({
  id: 8,
  type,
  item_id: 123,
  user_id: index ? null : 42,
  username: index ? null : "andres",
  timestamp: 100 + index,
  ...(type === "item_comment"
    ? { text: comment.text, via_api: true }
    : { extra_detail: { preserved: true } }),
}));
const page = { events, page: 1, total_count: 9 };

function ok(result: unknown) {
  return new Response(JSON.stringify({ err: 0, result }), { status: 200 });
}

describe("item history tools over MCP", () => {
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
    vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "user-token");
    vi.stubEnv("ROLLBAR_API_BASE", apiBase);
    fetchMock = vi.fn().mockResolvedValueOnce(ok([project]));
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
    client = new Client({ name: "history-test", version: "1.0.0" });
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

  it("advertises both tools and marks posting as non-idempotent", async () => {
    await connect();
    const { tools } = await client.listTools();
    expect(
      tools.find((tool) => tool.name === "list-item-events")?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((tool) => tool.name === "post-item-comment")?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns all nine history types and nullable/details fields unchanged in backend order", async () => {
    fetchMock.mockResolvedValueOnce(ok(page));
    await connect();
    const result = await call("list-item-events", { item_id: 123 });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual(page);
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe(
      `${apiBase}/item/123/events?page=1&limit=20&project_id=456`,
    );
    expect(options.headers["X-Rollbar-Access-Token"]).toBe("user-token");
  });

  it.each([["item_comment"], ["item_comment", "item_status_history"]])(
    "filters with repeated type keys: %j",
    async (...types) => {
      fetchMock
        .mockResolvedValueOnce(ok({ id: 123 }))
        .mockResolvedValueOnce(ok({ events: [], page: 2, total_count: 7 }));
      await connect();
      const result = await call("list-item-events", {
        counter: 42,
        project: "Backend",
        type: types,
        page: 2,
        limit: 5000,
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.text)).toEqual({
        events: [],
        page: 2,
        total_count: 7,
      });
      expect(fetchMock.mock.calls[1][0]).toBe(
        `${apiBase}/item?counter=42&project_id=456`,
      );
      const url = new URL(fetchMock.mock.calls[2][0]);
      expect(url.searchParams.getAll("type")).toEqual(types);
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("limit")).toBe("5000");
      expect(url.searchParams.get("project_id")).toBe("456");
    },
  );

  it.each([
    {},
    { item_id: 1, counter: 2 },
    { item_id: 0 },
    { counter: -1 },
    { item_id: 1.5 },
    { item_id: Number.MAX_SAFE_INTEGER + 1 },
    { item_id: 1, page: 0 },
    { item_id: 1, limit: 0 },
    { item_id: 1, limit: 5001 },
    { item_id: 1, type: ["comment"] },
    { item_id: 1, type: [] },
  ])(
    "rejects invalid list arguments without any HTTP calls: %j",
    async (args) => {
      await connect();
      expect((await call("list-item-events", args)).isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, "", " \n\t", 42])(
    "rejects invalid comment text without I/O: %j",
    async (text) => {
      await connect();
      expect(
        (await call("post-item-comment", { item_id: 123, comment: text }))
          .isError,
      ).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { item_id: 123, counter: 42 }])(
    "rejects ambiguous or missing post targets: %j",
    async (args) => {
      await connect();
      expect(
        (await call("post-item-comment", { ...args, comment: "Note" })).isError,
      ).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["ROLLBAR_ACCESS_TOKEN", "ROLLBAR_ACCOUNT_ACCESS_TOKEN"])(
    "refuses posting with %s before discovery or counter lookup",
    async (name) => {
      vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "");
      vi.stubEnv(name, "non-user-token");
      await connect();
      const result = await call("post-item-comment", {
        counter: 42,
        comment: "Note",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("ROLLBAR_USER_ACCESS_TOKEN");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["item_id", "counter"])(
    "posts through %s and reads the API-authored event back",
    async (address) => {
      if (address === "counter")
        fetchMock.mockResolvedValueOnce(ok({ id: 123 }));
      fetchMock
        .mockResolvedValueOnce(ok(comment))
        .mockResolvedValueOnce(
          ok({ events: [events[0]], page: 1, total_count: 1 }),
        );
      await connect();
      const posted = await call("post-item-comment", {
        [address]: address === "counter" ? 42 : 123,
        comment: "Investigated",
        project: "456",
        user_id: 999,
      });
      expect(posted.isError).toBeFalsy();
      expect(JSON.parse(posted.text)).toEqual(comment);
      const postCall = fetchMock.mock.calls.find(
        ([, options]) => options?.method === "POST",
      )!;
      expect(postCall[0]).toBe(`${apiBase}/item/123/comments?project_id=456`);
      expect(postCall[1]).toMatchObject({
        headers: {
          "X-Rollbar-Access-Token": "user-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ comment: "Investigated" }),
      });
      const listed = await call("list-item-events", {
        item_id: 123,
        type: ["item_comment"],
      });
      expect(JSON.parse(listed.text).events[0]).toEqual(events[0]);
    },
  );

  it.each([400, 401, 403, 404, 413, 415, 422, 500])(
    "surfaces backend POST %i without retries or truncating the comment",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ err: 1, message: `Backend refused: ${status}` }),
          { status },
        ),
      );
      await connect();
      const text = ' 🔎 "\\\n'.repeat(20000);
      const result = await call("post-item-comment", {
        item_id: 123,
        comment: text,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(`Backend refused: ${status}`);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        comment: text,
      });
    },
  );

  it("surfaces an unavailable snooze filter instead of an empty history", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          err: 1,
          message: "Snooze items is only available for paid accounts.",
        }),
        { status: 403 },
      ),
    );
    await connect();
    const result = await call("list-item-events", {
      item_id: 123,
      type: ["item_snooze_history"],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      "Snooze items is only available for paid accounts.",
    );
  });

  it.each([
    null,
    { err: 0 },
    { err: 0, result: {} },
    { err: 1, message: "Item not found" },
  ])("fails on invalid/error list envelopes: %j", async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await connect();
    expect((await call("list-item-events", { item_id: 123 })).isError).toBe(
      true,
    );
  });

  it("does not post after a failed counter lookup", async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await connect();
    const result = await call("post-item-comment", {
      counter: 42,
      comment: "Note",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("missing item ID");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a POST whose outcome is unknown after a network failure", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error("Connection lost after sending request"),
    );
    await connect();
    const result = await call("post-item-comment", {
      item_id: 123,
      comment: "Note",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Connection lost");
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
  });

  it("treats a nonzero comment API err as failure even on HTTP 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ err: 1, message: "Comment rejected" })),
    );
    await connect();
    const result = await call("post-item-comment", {
      item_id: 123,
      comment: "Note",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Comment rejected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["project", "account"])(
    "retains event reads with %s credentials",
    async (mode) => {
      vi.stubEnv("ROLLBAR_USER_ACCESS_TOKEN", "");
      fetchMock.mockReset();
      if (mode === "account") {
        vi.stubEnv("ROLLBAR_ACCOUNT_ACCESS_TOKEN", "account-token");
        fetchMock.mockResolvedValueOnce(ok([project]));
      } else {
        vi.stubEnv("ROLLBAR_ACCESS_TOKEN", "project-token");
        fetchMock.mockResolvedValueOnce(
          new Response("Forbidden", { status: 403 }),
        );
      }
      fetchMock.mockResolvedValueOnce(ok(page));
      await connect();
      expect(
        (await call("list-item-events", { item_id: 123 })).isError,
      ).toBeFalsy();
      const [url, options] = fetchMock.mock.calls.at(-1)!;
      expect(new URL(url).searchParams.has("project_id")).toBe(
        mode === "account",
      );
      expect(options.headers["X-Rollbar-Access-Token"]).toBe(`${mode}-token`);
    },
  );
});
