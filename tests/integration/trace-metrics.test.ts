import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// get-metrics takes the same request for both tables. The occurrences tests
// cover the request, paging, project selection and error handling in depth.
// These cover what differs for the traces table, and that the shared behavior
// reaches it.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("node:fs", () => ({ existsSync: () => false, readFileSync: vi.fn() }));

const apiBase = "https://rollbar.example/api/1";
const tracesUrl = `${apiBase}/metrics/traces`;
const project = { id: 456, name: "Frontend", status: "enabled" };
const otherProject = { id: 789, name: "Marketing", status: "enabled" };

// Shaped like a live response: span_count comes back as a numeric string.
const sessions = {
  timepoints: [
    {
      timestamp: 1793799662,
      metrics_rows: [
        [
          { field: "session_id", value: "73a0bb22746544b87ef15296fc69cde5" },
          { field: "environment", value: "production" },
          {
            field: "replay_ids",
            value: ["18a9cf527406df2f", "18a9cf527406df2f"],
          },
          { field: "first_start", value: "2026-11-04 13:37:44.332000+00:00" },
          { field: "span_count", value: "2" },
        ],
      ],
    },
  ],
  last_occurrence_timestamp: 1793799662,
  query_execution: 0.1,
};

function ok(result: unknown) {
  return new Response(JSON.stringify({ err: 0, result }), { status: 200 });
}

describe("get-metrics on the traces table over MCP", () => {
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
    vi.stubEnv("ROLLBAR_API_BASE", apiBase);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // An account token lists its projects through GET /projects first.
  function useAccountToken(projects = [project]) {
    vi.stubEnv("ROLLBAR_ACCOUNT_ACCESS_TOKEN", "account-token");
    fetchMock.mockResolvedValueOnce(ok(projects));
  }

  async function connect() {
    const { registerAllTools } = await import("../../src/tools/index.js");
    server = new McpServer({ name: "rollbar-test", version: "1.0.0" });
    registerAllTools(server);
    client = new Client({ name: "trace-metrics-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  async function call(args: Record<string, unknown>) {
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "get-metrics",
        arguments: { table: "traces", ...args },
      }),
    );
    const text = result.content.find((entry) => entry.type === "text")?.text;
    expect(typeof text).toBe("string");
    return { isError: result.isError, text: text as string };
  }

  function lastRequest() {
    const [url, options] = fetchMock.mock.calls.at(-1)!;
    return { url, options, body: JSON.parse(options.body) };
  }

  it("posts to the traces table with escaped attribute keys and returns span_count as a number", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(ok(sessions));
    await connect();

    const result = await call({
      project: "Frontend",
      start_time: 1793713262,
      filters: [
        { field: "name", operator: "eq", values: ["rrweb-replay-recording"] },
        {
          field: "attributes",
          key: "rollbar.replay.trigger.type",
          operator: "eq",
          values: ["occurrence"],
        },
        // An already-escaped key passes through unchanged.
        {
          field: "attributes",
          key: "rollbar\\.occurrence\\.uuids",
          operator: "not_null",
        },
      ],
      group_by: ["session_id", "environment"],
      aggregates: [
        {
          field: "attributes",
          key: "rollbar.replay.id",
          function: "array",
          alias: "replay_ids",
        },
        { field: "start_time", function: "min", alias: "first_start" },
      ],
      sort: [{ field: "first_start", order: "desc" }],
      limit: 10,
    });

    expect(result.isError).toBeFalsy();
    const { url, options, body } = lastRequest();
    expect(url).toBe(tracesUrl);
    expect(options.headers["X-Rollbar-Access-Token"]).toBe("account-token");
    expect(body).toEqual({
      start_time: 1793713262,
      filters: [
        { field: "name", operator: "eq", values: ["rrweb-replay-recording"] },
        {
          field: "attributes",
          key: "rollbar\\.replay\\.trigger\\.type",
          operator: "eq",
          values: ["occurrence"],
        },
        {
          field: "attributes",
          key: "rollbar\\.occurrence\\.uuids",
          operator: "not_null",
          values: [],
        },
        { field: "project_id", operator: "eq", values: [456] },
      ],
      group_by: ["session_id", "environment"],
      aggregates: [
        {
          field: "attributes",
          key: "rollbar\\.replay\\.id",
          function: "array",
          alias: "replay_ids",
        },
        { field: "start_time", function: "min", alias: "first_start" },
      ],
      sort: [{ field: "first_start", order: "desc" }],
      limit: 10,
      offset: 0,
    });

    expect(JSON.parse(result.text)).toEqual({
      timepoints: [
        {
          timestamp: 1793799662,
          rows: [
            {
              session_id: "73a0bb22746544b87ef15296fc69cde5",
              environment: "production",
              replay_ids: ["18a9cf527406df2f", "18a9cf527406df2f"],
              first_start: "2026-11-04 13:37:44.332000+00:00",
              span_count: 2,
            },
          ],
        },
      ],
      last_timestamp: 1793799662,
      row_count: 1,
    });
  });

  it("appends a path to the escaped key", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(ok(sessions));
    await connect();

    const result = await call({
      filters: [
        {
          field: "attributes",
          key: "rollbar.replay.trigger.context",
          path: "rule.type",
          operator: "eq",
          values: ["error"],
        },
      ],
      aggregates: [
        {
          field: "events_attributes",
          key: "json",
          path: "type",
          function: "topk",
          alias: "event_types",
          parameters: ["5"],
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const { body } = lastRequest();
    expect(body.filters[0].key).toBe(
      "rollbar\\.replay\\.trigger\\.context.rule.type",
    );
    expect(body.filters[0]).not.toHaveProperty("path");
    expect(body.aggregates).toEqual([
      {
        field: "events_attributes",
        key: "json.type",
        function: "topk",
        alias: "event_types",
        parameters: ["5", "3", "counts"],
      },
    ]);
  });

  it("asks topk for counts and returns each value with its count", async () => {
    useAccountToken();
    // Shaped like a live response: the API flattens topK's (value, count,
    // error) tuples into one list of strings.
    fetchMock.mockResolvedValueOnce(
      ok({
        timepoints: [
          {
            timestamp: 1793802988,
            metrics_rows: [
              [
                {
                  field: "event_names",
                  value: [
                    "rollbar-network-event",
                    "831406",
                    "0",
                    "rollbar-focus-event",
                    "127323",
                    "2",
                  ],
                },
                // An array aggregate whose length is a multiple of three
                // stays as it is.
                { field: "replay_ids", value: ["a1", "b2", "c3"] },
                { field: "span_count", value: "1104979" },
              ],
            ],
          },
        ],
      }),
    );
    await connect();

    const result = await call({
      aggregates: [
        { field: "events_name", function: "topk", alias: "event_names" },
        {
          field: "attributes",
          key: "rollbar.replay.id",
          function: "array",
          alias: "replay_ids",
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(lastRequest().body.aggregates[0]).toEqual({
      field: "events_name",
      function: "topk",
      alias: "event_names",
      parameters: ["10", "3", "counts"],
    });
    expect(JSON.parse(result.text).timepoints[0].rows).toEqual([
      {
        event_names: [
          { value: "rollbar-network-event", count: 831406, count_error: 0 },
          { value: "rollbar-focus-event", count: 127323, count_error: 2 },
        ],
        replay_ids: ["a1", "b2", "c3"],
        span_count: 1104979,
      },
    ]);
  });

  it.each([
    ["more than two numbers", ["5", "3", "1"]],
    ["a non-integer", ["5.5"]],
    ["zero", ["0"]],
    ["SQL", ["5) as x, version() as y, topK(5"]],
  ])(
    "rejects topk parameters with %s before any request",
    async (_label, parameters) => {
      useAccountToken();
      await connect();

      const result = await call({
        aggregates: [
          { field: "name", function: "topk", alias: "names", parameters },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/topk takes how many values to return/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("sends one project filter for a list of projects", async () => {
    useAccountToken([project, otherProject]);
    fetchMock.mockResolvedValueOnce(ok(sessions));
    await connect();

    const result = await call({ project: ["Frontend", "789"] });

    expect(result.isError).toBeFalsy();
    expect(lastRequest().body.filters).toEqual([
      { field: "project_id", operator: "eq", values: [456, 789] },
    ]);
  });

  it.each([
    ["the only sort", [{ field: "span_count", order: "desc" }]],
    [
      "a later sort",
      [
        { field: "first_start", order: "desc" },
        { field: "span_count", order: "desc" },
      ],
    ],
  ])(
    "rejects a sort on span_count in %s before any request",
    async (_label, sort) => {
      useAccountToken();
      await connect();

      const result = await call({ sort });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/span_count can't be used as a sort field/);
      expect(result.text).toMatch(/count_all aggregate with an alias/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "a filter",
      { filters: [{ field: "attributes", path: "a", operator: "not_null" }] },
    ],
    [
      "an aggregate",
      {
        aggregates: [
          { field: "attributes", path: "a", function: "array", alias: "a" },
        ],
      },
    ],
  ])(
    "rejects a path without a key in %s before any request",
    async (_label, args) => {
      useAccountToken();
      await connect();

      const result = await call(args);

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/path requires key/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a row over the size limit and points to get-replay", async () => {
    useAccountToken();
    const events = "x".repeat(90_000);
    fetchMock.mockResolvedValueOnce(
      ok({
        timepoints: [
          {
            timestamp: 1793799662,
            metrics_rows: [
              [
                { field: "events", value: [events] },
                { field: "span_count", value: "1" },
              ],
            ],
          },
        ],
      }),
    );
    await connect();

    const result = await call({
      aggregates: [
        {
          field: "events_attributes_value",
          function: "array",
          alias: "events",
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/over this tool's 80000-character limit/);
    expect(result.text).toMatch(/Even one row is over the limit/);
    expect(result.text).toMatch(/use get-replay/);
  });

  it("surfaces the backend message and a Metrics API hint on 403", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          err: 1,
          message:
            "Please upgrade to our Advanced package to access this endpoint.",
        }),
        { status: 403 },
      ),
    );
    await connect();

    const result = await call({});

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Please upgrade to our Advanced package/);
    expect(result.text).toMatch(
      /Metrics API requires the account's Advanced package/,
    );
  });
});
