import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectScope } from "../config.js";
import type {
  RollbarApiResponse,
  RollbarMetricsColumn,
  RollbarTableMetricsResponse,
} from "../types/index.js";
import { makeRollbarRequest } from "../utils/api.js";
import {
  escapeMetricsKey,
  groupTopkCounts,
  topkParameters,
} from "../utils/metrics.js";
import { injectProjectIdsMetricsFilter } from "../utils/params.js";
import { buildProjectsParam } from "../utils/project-params.js";
import { getRollbarResult } from "../utils/response.js";

// The Metrics API's tables, POST /metrics/<table>. Both run through the same
// metrics backend, so they take the same request and return the same
// response shape.
const METRICS_TABLES = ["occurrences", "traces"] as const;
type MetricsTable = (typeof METRICS_TABLES)[number];

interface TableConfig {
  // The column the API adds to every row with that row's count.
  countField: string;
  countFieldSortable: boolean;
  // Appended to the error for a response over MAX_RESPONSE_CHARS.
  oversizeHint?: string;
  // Result names the API formats as hex IDs. It picks the format by the
  // result's name, so it would also apply to an aggregate aliased this way.
  hexIdNames?: readonly string[];
}

const TABLES: Record<MetricsTable, TableConfig> = {
  occurrences: { countField: "occurrence_count", countFieldSortable: true },
  traces: {
    countField: "span_count",
    // The API registers no count column for the traces table, so it rejects
    // span_count as a sort field.
    countFieldSortable: false,
    oversizeHint: "To read a replay's recording, use get-replay.",
    hexIdNames: ["session_id", "trace_id", "span_id", "parent_span_id"],
  },
};

const FILTER_OPERATORS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is_null",
  "not_null",
] as const;

const AGGREGATE_FUNCTIONS = [
  "count_all",
  "count_distinct",
  "max",
  "min",
  "sum",
  "topk",
  "quantiles",
  "array",
  "json_array_length",
] as const;

const GRANULARITIES = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;

// The API returns every matching row when `limit` is omitted, which can be far
// more than fits in a conversation, so this tool always sends one.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

// Unix seconds stay below this until the year 2286; anything larger is almost
// certainly a millisecond timestamp.
const MAX_UNIX_SECONDS = 9_999_999_999;

// About 20k tokens, the same default budget as list-occurrences. An array
// aggregate can return megabytes (one replay's recording events are several),
// which would flood the conversation or be cut off by the client.
const MAX_RESPONSE_CHARS = 80_000;

// Every client loads this description and the input schema below, so they
// stay short. The README has the longer explanations.
const DESCRIPTION =
  "Count and aggregate Rollbar occurrences or trace spans over a time range with the Metrics API: filter, group, aggregate, and optionally bucket into timepoints by granularity. Requires the account's Advanced package (otherwise 403). Each row holds its group_by columns, aggregate aliases, and its count (occurrence_count or span_count). With an account or user token, omit project to query every readable project, or pass a list; group_by project_id to break rows down by project. Default order is timestamp ascending. " +
  "Table occurrences (errors and messages). Common columns: item_counter, item_id, item_title, item_level, item_status, environment, code_version, framework, platform, language, browser_family, browser_version, os_family, os_version, device_model, person_id, person_email, ip_address, server_host, request_url, request_method, exception_class, exception_message, message_body, context, fingerprint, scm_branch. Key/value columns: request_headers, request_params, request_gets, request_posts, customs, traceframe_locals, attributes. For top-N, sort by occurrence_count desc. A like filter across every project can be slow, so narrow the time range. " +
  "Table traces (session replays and their telemetry, as OpenTelemetry spans named 'rrweb-replay-recording' and 'rollbar-telemetry', linked by session_id and the rollbar.replay.id attribute). Columns: project_id, environment, name, kind, session_id, trace_id, span_id (hex strings when grouped by or filtered on; an aggregate over one returns decimal strings, which filters can't use), start_time (the time range applies to it), duration (ns); parent_id is unavailable. Key/value columns: attributes, events_attributes. Replay attributes include rollbar.replay.trigger.type, rollbar.replay.url.full, rollbar.occurrence.uuids (a JSON array), user.id, user.email and client.address, so results can hold personal data. span_count can't be sorted on: sort on a count_all alias. Rows can't be grouped by an attribute: use topk on it. An aggregate other than array on an event column (events_name, events_time, events_attributes_name, events_attributes_value) counts once per event and inflates every count in the row, so query event columns separately. To read a recording, use get-replay. " +
  'Example, the 10 most recent replays with the inputs get-replay needs: {"table": "traces", "filters": [{"field": "name", "operator": "eq", "values": ["rrweb-replay-recording"]}], "group_by": ["session_id", "environment"], "aggregates": [{"field": "attributes", "key": "rollbar.replay.id", "function": "array", "alias": "replay_ids"}, {"field": "start_time", "function": "min", "alias": "first_start"}], "sort": [{"field": "first_start", "order": "desc"}], "limit": 10}';

// These build a fresh schema per use: a zod instance used twice becomes a
// JSON Schema $ref in the tool listing, which some MCP clients can't resolve.
const unixSeconds = () =>
  z
    .number()
    .int()
    .nonnegative()
    .max(MAX_UNIX_SECONDS, "Use Unix seconds, not milliseconds");

const optionalText = (description: string) =>
  z.string().min(1).optional().describe(description);

interface KeyedEntry {
  key?: string;
  path?: string;
}

// Replaces the tool's key and path with the single key the API expects.
function toApiKey<T extends KeyedEntry>({
  key,
  path,
  ...rest
}: T): Omit<T, "key" | "path"> & { key?: string } {
  if (path !== undefined && key === undefined) {
    throw new Error("path requires key: name the entry whose value it reads.");
  }
  return key === undefined
    ? rest
    : { ...rest, key: escapeMetricsKey(key, path) };
}

// Why an aggregate alias can't be used, if it can't: it would overwrite a
// field the row already has, or the API would format its values as hex IDs.
function aliasConflict(
  alias: string,
  { countField, hexIdNames = [] }: TableConfig,
  groupBy: string[] | undefined,
): string | undefined {
  if (alias === countField) {
    return `every row already has ${countField}`;
  }
  if (alias === "project_slug" && groupBy?.includes("project_id")) {
    return "rows grouped by project_id already have project_slug";
  }
  if (groupBy?.includes(alias)) {
    return `${alias} is also a group_by column`;
  }
  if (hexIdNames.includes(alias)) {
    return `the API formats any value named ${alias} as a hex ID, which would garble this aggregate's values`;
  }
  return undefined;
}

// Each row is flattened into one object keyed by field name, so an aggregate
// alias that repeats, or names a field the row already has, would overwrite a
// value. The API rejects or fails most such queries itself, but it appends
// project_slug after the aggregates, which would silently replace one. On
// traces, it also formats any result named after an ID column as hex, which
// would garble an aggregate's values, counts included.
function checkAliases(
  aliases: string[],
  table: TableConfig,
  groupBy: string[] | undefined,
): void {
  const seen = new Set<string>();
  for (const alias of aliases) {
    if (seen.has(alias)) {
      throw new Error(
        `The alias "${alias}" is used by more than one aggregate. Give each aggregate its own alias.`,
      );
    }
    seen.add(alias);

    const conflict = aliasConflict(alias, table, groupBy);
    if (conflict) {
      throw new Error(
        `The alias "${alias}" can't be used: ${conflict}. Choose another alias.`,
      );
    }
  }
}

function flattenRow(
  row: RollbarMetricsColumn[],
  countField: string,
  topkAliases: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    row.map(({ field, value }) => {
      // The traces table returns its count as a numeric string; the
      // occurrences table already returns a number.
      if (field === countField && typeof value === "string" && value !== "") {
        return [field, Number(value)];
      }
      return [field, topkAliases.has(field) ? groupTopkCounts(value) : value];
    }),
  );
}

// Says how to get a result under MAX_RESPONSE_CHARS. Paging can't split a
// row, so a lower limit only helps when each row fits on its own.
function oversizeMessage(
  size: number,
  rows: Record<string, unknown>[],
  hint: string | undefined,
): string {
  const largestRow = Math.max(
    0,
    ...rows.map((row) => JSON.stringify(row).length),
  );
  const rowsThatFit = Math.floor((rows.length * MAX_RESPONSE_CHARS) / size);
  const advice =
    largestRow > MAX_RESPONSE_CHARS || rowsThatFit < 1
      ? "Even one row is over the limit, so a lower limit won't help: drop or narrow the array aggregates, or filter to fewer spans or occurrences per group."
      : `About ${rowsThatFit} rows fit: set limit to ${rowsThatFit} and page with offset, or narrow the time range.`;
  return `The result is ${size} characters, over this tool's ${MAX_RESPONSE_CHARS}-character limit. ${advice}${hint ? ` ${hint}` : ""}`;
}

export function registerGetMetricsTool(server: McpServer) {
  server.registerTool(
    "get-metrics",
    {
      description: DESCRIPTION,
      inputSchema: {
        table: z
          .enum(METRICS_TABLES)
          .describe(
            "occurrences: errors and messages. traces: session replay and telemetry spans.",
          ),
        start_time: unixSeconds()
          .optional()
          .describe(
            "Unix seconds. Omitted: the account's data retention boundary.",
          ),
        end_time: unixSeconds()
          .optional()
          .describe("Unix seconds, inclusive. Omitted: no upper bound."),
        granularity: z
          .enum(GRANULARITIES)
          .optional()
          .describe("One timepoint per period. Omitted: a single timepoint."),
        timezone: z
          .string()
          .min(1)
          .optional()
          .describe("For timepoints, such as 'US/Pacific' (default UTC)."),
        filters: z
          .array(
            z.object({
              field: z
                .string()
                .min(1)
                .describe(
                  "Column, or an aggregate alias to filter its result.",
                ),
              operator: z
                .enum(FILTER_OPERATORS)
                .describe(
                  "eq/ne: any listed value. gt/gte/lt/lte: one value. like/ilike: one SQL LIKE pattern (% wildcard). is_null/not_null: no values.",
                ),
              values: z
                .array(z.union([z.string(), z.number()]))
                .optional()
                .describe(
                  "item_status and item_level match by name, such as 'error'. Trace ids match as hex strings.",
                ),
              key: optionalText(
                "Entry name in a key/value column, such as 'User-Agent' or 'rollbar.replay.id'. Dots are literal; matching ignores case, and _ matches any character.",
              ),
              path: optionalText(
                "JSONPath inside the entry's value, such as 'user.id'. Requires key.",
              ),
            }),
          )
          .default([])
          .describe(
            "All must match. Choose projects with project, not a project_id filter.",
          ),
        group_by: z
          .array(z.string().min(1))
          .optional()
          .describe("Columns to group by."),
        aggregates: z
          .array(
            z.object({
              field: z.string().min(1),
              function: z.enum(AGGREGATE_FUNCTIONS),
              alias: z
                .string()
                .regex(
                  /^[A-Za-z0-9_]+$/,
                  "Alias may contain only letters, digits, and underscores",
                )
                .describe("Name of the result in each row."),
              key: optionalText("As in filters."),
              path: optionalText("As in filters."),
              parameters: z
                .array(z.string())
                .optional()
                .describe(
                  "topk: how many values (default 10) and an optional load factor (default 3), such as ['5']. quantiles: accuracy then levels, such as ['1000', '0.5', '0.9'].",
                ),
            }),
          )
          .optional()
          .describe(
            "Computed per group. topk returns [{value, count, count_error}], most frequent first; count can overstate the true count by up to count_error.",
          ),
        sort: z
          .array(
            z.object({
              field: z
                .string()
                .min(1)
                .describe("Column, group_by column, or aggregate alias."),
              order: z.enum(["asc", "desc"]),
            }),
          )
          .min(1)
          .optional()
          .describe("In priority order (default: timestamp ascending)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .default(DEFAULT_LIMIT)
          .describe(
            `Maximum rows across all timepoints (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
          ),
        offset: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe(
            "Rows to skip (default 0). Pass next_offset from a full page.",
          ),
        project: buildProjectsParam(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      table,
      start_time,
      end_time,
      granularity,
      timezone,
      filters,
      group_by,
      aggregates,
      sort,
      limit,
      offset,
      project,
    }) => {
      const tableConfig = TABLES[table];
      const { countField, countFieldSortable, oversizeHint } = tableConfig;

      // The project parameter is the one way to choose projects. The API
      // ignores a project_id filter on a project token and intersects it with
      // the injected one on an account token, so either way it would only
      // mislead.
      if (filters.some((filter) => filter.field === "project_id")) {
        throw new Error(
          "Filtering on project_id is not supported. Use the project parameter to choose projects: a name or id, a list of them, or omit it for every project the token can read.",
        );
      }

      if (
        !countFieldSortable &&
        sort?.some((entry) => entry.field === countField)
      ) {
        throw new Error(
          `${countField} can't be used as a sort field. Add a count_all aggregate with an alias, such as {"field": "span_id", "function": "count_all", "alias": "spans"}, and sort on the alias.`,
        );
      }

      checkAliases(
        aggregates?.map((aggregate) => aggregate.alias) ?? [],
        tableConfig,
        group_by,
      );

      // Validate keys and paths before resolving projects, which can make a
      // request of its own.
      const apiFilters = filters.map((filter) => ({
        // On an account token the API rejects any filter without a values
        // list, including is_null and not_null, which take no values.
        ...toApiKey(filter),
        values: filter.values ?? [],
      }));
      const apiAggregates = aggregates?.map((aggregate) =>
        toApiKey(
          aggregate.function === "topk"
            ? { ...aggregate, parameters: topkParameters(aggregate.parameters) }
            : aggregate,
        ),
      );
      const topkAliases = new Set(
        aggregates
          ?.filter((aggregate) => aggregate.function === "topk")
          .map((aggregate) => aggregate.alias),
      );

      const scope = await resolveProjectScope(project);
      const body = {
        start_time,
        end_time,
        granularity,
        timezone,
        filters: injectProjectIdsMetricsFilter(apiFilters, scope.projectIds),
        group_by,
        aggregates: apiAggregates,
        sort,
        limit,
        offset,
      };

      const response = await makeRollbarRequest<
        RollbarApiResponse<RollbarTableMetricsResponse>
      >(`${scope.apiBase}/metrics/${table}`, "get-metrics", scope.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = getRollbarResult(response, "metrics");
      if (
        !Array.isArray(result.timepoints) ||
        !result.timepoints.every((timepoint) =>
          Array.isArray(timepoint?.metrics_rows),
        )
      ) {
        throw new Error(
          "Invalid Rollbar API response: missing metrics timepoints",
        );
      }

      // A query with no matching rows can come back as one empty timepoint
      // stamped 0, which reads like data at the Unix epoch.
      const timepoints = result.timepoints
        .filter((timepoint) => timepoint.metrics_rows.length > 0)
        .map((timepoint) => ({
          timestamp: timepoint.timestamp,
          rows: timepoint.metrics_rows.map((row) =>
            flattenRow(row, countField, topkAliases),
          ),
        }));
      const rows = timepoints.flatMap((timepoint) => timepoint.rows);

      const output = {
        timepoints,
        // The API calls this last_occurrence_timestamp for both tables. It's
        // the newest timestamp among the returned rows: with granularity, the
        // newest timepoint's.
        last_timestamp: result.last_occurrence_timestamp ?? null,
        row_count: rows.length,
        // The API reports no total, so a full page may have more behind it.
        ...(rows.length >= limit ? { next_offset: offset + limit } : {}),
      };

      const text = JSON.stringify(output);
      if (text.length > MAX_RESPONSE_CHARS) {
        throw new Error(oversizeMessage(text.length, rows, oversizeHint));
      }

      return { content: [{ type: "text", text }] };
    },
  );
}
