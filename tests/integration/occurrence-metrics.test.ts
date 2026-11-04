import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Exercise the real MCP schemas, handler, auth, and HTTP client. Only the
// configuration files and external Rollbar responses are replaced.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("node:fs", () => ({ existsSync: () => false, readFileSync: vi.fn() }));

const apiBase = "https://rollbar.example/api/1";
const metricsUrl = `${apiBase}/metrics/occurrences`;
const project = { id: 456, name: "Backend", status: "enabled" };
const otherProject = { id: 789, name: "Frontend", status: "enabled" };
const metrics = {
  timepoints: [
    {
      timestamp: 1632528000,
      metrics_rows: [
        [
          { field: "item_counter", value: 150 },
          { field: "environment", value: "production" },
          { field: "person_count", value: 2 },
          { field: "occurrence_count", value: 5 },
        ],
      ],
    },
    {
      timestamp: 1632614400,
      metrics_rows: [
        [
          { field: "item_counter", value: 150 },
          { field: "environment", value: "production" },
          { field: "person_count", value: 1 },
          { field: "occurrence_count", value: 3 },
        ],
      ],
    },
  ],
  last_occurrence_timestamp: 1632599870,
  query_execution: 0.084,
};

function ok(result: unknown) {
  return new Response(JSON.stringify({ err: 0, result }), { status: 200 });
}

describe("get-metrics on the occurrences table over MCP", () => {
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

  // Account and user tokens list their projects through GET /projects first.
  function useAccountToken(
    env = "ROLLBAR_ACCOUNT_ACCESS_TOKEN",
    projects = [project],
  ) {
    vi.stubEnv(env, "account-token");
    fetchMock.mockResolvedValueOnce(ok(projects));
  }

  function metricsCalls() {
    return fetchMock.mock.calls.filter(([url]) => url === metricsUrl);
  }

  // A legacy token is probed with GET /projects; a 403 marks it a project
  // token. Naming its configured project ("default") skips the probe.
  function useProjectToken({ probed = true } = {}) {
    vi.stubEnv("ROLLBAR_ACCESS_TOKEN", "project-token");
    if (probed) {
      fetchMock.mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 }),
      );
    }
  }

  async function connect() {
    const { registerAllTools } = await import("../../src/tools/index.js");
    server = new McpServer({ name: "rollbar-test", version: "1.0.0" });
    registerAllTools(server);
    client = new Client({ name: "metrics-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  async function call(args: Record<string, unknown>) {
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "get-metrics",
        arguments: { table: "occurrences", ...args },
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

  it("advertises one read-only tool that requires a table, with no $ref", async () => {
    vi.stubEnv("ROLLBAR_ACCOUNT_ACCESS_TOKEN", "account-token");
    await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((entry) => entry.name === "get-metrics");

    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.inputSchema.required).toEqual(["table"]);
    expect(tool?.inputSchema.properties?.table).toMatchObject({
      enum: ["occurrences", "traces"],
    });
    // Some MCP clients can't resolve a $ref in a tool's input schema.
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("$ref");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the query scoped to the selected project and flattens the rows", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(ok(metrics));
    await connect();

    const result = await call({
      project: "Backend",
      start_time: 1632500000,
      end_time: 1632700000,
      granularity: "day",
      timezone: "US/Pacific",
      filters: [
        { field: "environment", operator: "eq", values: ["production"] },
        { field: "person_id", operator: "not_null" },
        {
          field: "request_headers",
          key: "User-Agent",
          operator: "ilike",
          values: ["%curl%"],
        },
      ],
      group_by: ["item_counter", "environment"],
      aggregates: [
        { field: "person_id", function: "count_distinct", alias: "person_count" },
        {
          field: "code_version",
          function: "topk",
          alias: "top_versions",
          parameters: ["3"],
        },
      ],
      sort: [{ field: "occurrence_count", order: "desc" }],
    });

    expect(result.isError).toBeFalsy();
    const { url, options, body } = lastRequest();
    expect(url).toBe(metricsUrl);
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["X-Rollbar-Access-Token"]).toBe("account-token");
    expect(body).toEqual({
      start_time: 1632500000,
      end_time: 1632700000,
      granularity: "day",
      timezone: "US/Pacific",
      filters: [
        { field: "environment", operator: "eq", values: ["production"] },
        // The API rejects an account-token filter without a values list.
        { field: "person_id", operator: "not_null", values: [] },
        {
          field: "request_headers",
          key: "User-Agent",
          operator: "ilike",
          values: ["%curl%"],
        },
        { field: "project_id", operator: "eq", values: [456] },
      ],
      group_by: ["item_counter", "environment"],
      aggregates: [
        { field: "person_id", function: "count_distinct", alias: "person_count" },
        {
          field: "code_version",
          function: "topk",
          alias: "top_versions",
          parameters: ["3", "3", "counts"],
        },
      ],
      sort: [{ field: "occurrence_count", order: "desc" }],
      limit: 100,
      offset: 0,
    });

    expect(JSON.parse(result.text)).toEqual({
      timepoints: [
        {
          timestamp: 1632528000,
          rows: [
            {
              item_counter: 150,
              environment: "production",
              person_count: 2,
              occurrence_count: 5,
            },
          ],
        },
        {
          timestamp: 1632614400,
          rows: [
            {
              item_counter: 150,
              environment: "production",
              person_count: 1,
              occurrence_count: 3,
            },
          ],
        },
      ],
      last_timestamp: 1632599870,
      row_count: 2,
    });
  });

  it("takes keys literally, escaping their dots, and reads a path inside the value", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(ok(metrics));
    await connect();

    const result = await call({
      filters: [
        {
          field: "customs",
          key: "job.name",
          operator: "eq",
          values: ["DeleteReplaysByPerson"],
        },
      ],
      aggregates: [
        {
          field: "customs",
          key: "timings",
          path: "execution_duration",
          function: "max",
          alias: "max_duration",
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const { body } = lastRequest();
    expect(body.filters[0]).toEqual({
      field: "customs",
      key: "job\\.name",
      operator: "eq",
      values: ["DeleteReplaysByPerson"],
    });
    expect(body.aggregates).toEqual([
      {
        field: "customs",
        key: "timings.execution_duration",
        function: "max",
        alias: "max_duration",
      },
    ]);
  });

  it("sends only the default limit and offset for an empty query", async () => {
    useAccountToken("ROLLBAR_USER_ACCESS_TOKEN");
    fetchMock.mockResolvedValueOnce(ok({ timepoints: [], query_execution: 0 }));
    await connect();

    const result = await call({});

    expect(result.isError).toBeFalsy();
    expect(lastRequest().body).toEqual({ filters: [], limit: 100, offset: 0 });
    expect(JSON.parse(result.text)).toEqual({
      timepoints: [],
      last_timestamp: null,
      row_count: 0,
    });
  });

  it("drops the empty epoch timepoint the API returns when nothing matches", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(
      ok({ timepoints: [{ timestamp: 0, metrics_rows: [] }] }),
    );
    await connect();

    const result = await call({
      filters: [{ field: "environment", operator: "is_null" }],
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text)).toEqual({
      timepoints: [],
      last_timestamp: null,
      row_count: 0,
    });
  });

  describe("project selection with an account token", () => {
    it("queries every readable project when project is omitted", async () => {
      useAccountToken("ROLLBAR_ACCOUNT_ACCESS_TOKEN", [project, otherProject]);
      fetchMock.mockResolvedValueOnce(ok(metrics));
      await connect();

      const result = await call({ group_by: ["project_id"] });

      expect(result.isError).toBeFalsy();
      const { url, options, body } = lastRequest();
      expect(url).toBe(metricsUrl);
      expect(options.headers["X-Rollbar-Access-Token"]).toBe("account-token");
      expect(body.filters).toEqual([]);
    });

    it("restricts the query to one named project", async () => {
      useAccountToken("ROLLBAR_ACCOUNT_ACCESS_TOKEN", [project, otherProject]);
      fetchMock.mockResolvedValueOnce(ok(metrics));
      await connect();

      expect((await call({ project: "Frontend" })).isError).toBeFalsy();
      expect(lastRequest().body.filters).toEqual([
        { field: "project_id", operator: "eq", values: [789] },
      ]);
    });

    it("sends one filter for a list of names and ids, without duplicates", async () => {
      useAccountToken("ROLLBAR_ACCOUNT_ACCESS_TOKEN", [project, otherProject]);
      fetchMock.mockResolvedValueOnce(ok(metrics));
      await connect();

      const result = await call({ project: ["Backend", "789", "backend"] });

      expect(result.isError).toBeFalsy();
      expect(lastRequest().body.filters).toEqual([
        { field: "project_id", operator: "eq", values: [456, 789] },
      ]);
    });

    it("rejects a list with an unknown project before querying metrics", async () => {
      useAccountToken("ROLLBAR_ACCOUNT_ACCESS_TOKEN", [project, otherProject]);
      // A lookup miss refreshes the project list once before giving up.
      fetchMock.mockResolvedValueOnce(ok([project, otherProject]));
      await connect();

      const result = await call({ project: ["Backend", "Mobile"] });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/Unknown project "Mobile"/);
      expect(metricsCalls()).toHaveLength(0);
    });

    it("rejects an empty list before any request", async () => {
      useAccountToken();
      await connect();

      expect((await call({ project: [] })).isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("project selection with a project token", () => {
    it("rejects a list of several projects before querying metrics", async () => {
      useProjectToken();
      await connect();

      const result = await call({ project: ["default", "other"] });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/requires an account or user token/);
      expect(metricsCalls()).toHaveLength(0);
    });

    it("treats a one-entry list like a single project", async () => {
      useProjectToken({ probed: false });
      fetchMock.mockResolvedValueOnce(ok(metrics));
      await connect();

      const result = await call({ project: ["default"] });

      expect(result.isError).toBeFalsy();
      const { options, body } = lastRequest();
      expect(options.headers["X-Rollbar-Access-Token"]).toBe("project-token");
      expect(body.filters).toEqual([]);
    });
  });

  describe("project selection with project tokens and an account token", () => {
    function useBothTokens() {
      vi.stubEnv("ROLLBAR_ACCESS_TOKEN", "project-token");
      vi.stubEnv("ROLLBAR_ACCOUNT_ACCESS_TOKEN", "account-token");
    }

    it("uses a configured project's own token when it's named alone", async () => {
      useBothTokens();
      fetchMock.mockResolvedValueOnce(ok(metrics));
      await connect();

      const result = await call({ project: "default" });

      expect(result.isError).toBeFalsy();
      const { options, body } = lastRequest();
      expect(options.headers["X-Rollbar-Access-Token"]).toBe("project-token");
      expect(body.filters).toEqual([]);
    });

    it("explains that a list needs Rollbar names, not configured names", async () => {
      useBothTokens();
      // The account token lists its projects, then refreshes the list once
      // after "default" misses.
      fetchMock.mockResolvedValueOnce(ok([project, otherProject]));
      fetchMock.mockResolvedValueOnce(ok([project, otherProject]));
      await connect();

      const result = await call({ project: ["default", "Backend"] });

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/Unknown project "default"/);
      expect(result.text).toMatch(
        /"default" is a configured project-token name/,
      );
      expect(result.text).toMatch(/use each project's Rollbar name or id/);
      expect(metricsCalls()).toHaveLength(0);
    });
  });

  it("leaves the project filter to the API on a project token", async () => {
    useProjectToken();
    fetchMock.mockResolvedValueOnce(ok(metrics));
    await connect();

    const result = await call({
      filters: [{ field: "item_level", operator: "eq", values: ["error"] }],
    });

    expect(result.isError).toBeFalsy();
    const { options, body } = lastRequest();
    expect(options.headers["X-Rollbar-Access-Token"]).toBe("project-token");
    expect(body.filters).toEqual([
      { field: "item_level", operator: "eq", values: ["error"] },
    ]);
  });

  it("returns next_offset when the page is full", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(ok(metrics));
    await connect();

    const result = await call({ limit: 2, offset: 4 });

    expect(result.isError).toBeFalsy();
    expect(lastRequest().body).toMatchObject({ limit: 2, offset: 4 });
    expect(JSON.parse(result.text)).toMatchObject({
      row_count: 2,
      next_offset: 6,
    });
  });

  it("rejects a project_id filter before any request", async () => {
    useAccountToken();
    await connect();

    const result = await call({
      filters: [{ field: "project_id", operator: "eq", values: [789] }],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Use the project parameter/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a millisecond start_time", { start_time: 1632500000000 }],
    ["an unknown granularity", { granularity: "fortnight" }],
    ["an unknown filter operator", { filters: [{ field: "environment", operator: "in", values: ["x"] }] }],
    ["an aggregate alias with a dash", { aggregates: [{ field: "person_id", function: "count_distinct", alias: "person-count" }] }],
    ["a limit over the maximum", { limit: 1001 }],
    ["a missing table", { table: undefined }],
    ["an unknown table", { table: "items" }],
    ["a sort that isn't a list", { sort: { field: "occurrence_count", order: "desc" } }],
  ])("rejects %s before any request", async (_label, args) => {
    useAccountToken();
    await connect();

    expect((await call(args)).isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a repeated alias",
      {
        aggregates: [
          { field: "person_id", function: "count_distinct", alias: "n" },
          { field: "ip_address", function: "count_distinct", alias: "n" },
        ],
      },
      /"n" is used by more than one aggregate/,
    ],
    [
      "the count column as an alias",
      {
        aggregates: [
          { field: "person_id", function: "count_all", alias: "occurrence_count" },
        ],
      },
      /every row already has occurrence_count/,
    ],
    [
      "project_slug as an alias",
      {
        group_by: ["project_id"],
        aggregates: [
          { field: "person_id", function: "count_distinct", alias: "project_slug" },
        ],
      },
      /rows grouped by project_id already have project_slug/,
    ],
    [
      "a group_by column as an alias",
      {
        group_by: ["environment"],
        aggregates: [
          { field: "environment", function: "max", alias: "environment" },
        ],
      },
      /environment is also a group_by column/,
    ],
  ])(
    "rejects %s, which would overwrite a row field, before any request",
    async (_label, args, message) => {
      useAccountToken();
      await connect();

      const result = await call(args);

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(message);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("suggests a limit that fits when the result is over the size limit", async () => {
    useAccountToken();
    const row = (counter: number) => [
      { field: "item_counter", value: counter },
      { field: "item_title", value: "x".repeat(1000) },
      { field: "occurrence_count", value: 1 },
    ];
    fetchMock.mockResolvedValueOnce(
      ok({
        timepoints: [
          {
            timestamp: 1632528000,
            metrics_rows: Array.from({ length: 100 }, (_, i) => row(i)),
          },
        ],
      }),
    );
    await connect();

    const result = await call({ group_by: ["item_counter", "item_title"] });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/over this tool's 80000-character limit/);
    const fit = Number(
      result.text.match(/About (\d+) rows fit: set limit to \1 /)?.[1],
    );
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThan(100);
    expect(result.text).not.toMatch(/get-replay/);
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
    expect(result.text).toMatch(/Metrics API requires the account's Advanced package/);
  });

  it("surfaces a 400 from the backend unchanged", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ err: 1, message: "Missing filter values" }),
        { status: 400 },
      ),
    );
    await connect();

    const result = await call({
      filters: [{ field: "environment", operator: "eq" }],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Rollbar API error: Missing filter values/);
  });

  it.each([
    ["missing timepoints", {}],
    ["a timepoint without metrics_rows", { timepoints: [{ timestamp: 1 }] }],
  ])("rejects a response with %s", async (_label, result) => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(ok(result));
    await connect();

    const response = await call({});

    expect(response.isError).toBe(true);
    expect(response.text).toMatch(/missing metrics timepoints/);
  });

  it("treats a nonzero API err as failure even on HTTP 200", async () => {
    useAccountToken();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ err: 1, message: "Query timed out" }), {
        status: 200,
      }),
    );
    await connect();

    const result = await call({});

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Query timed out/);
  });
});
