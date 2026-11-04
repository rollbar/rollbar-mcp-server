import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectScope } from "../config.js";
import type {
  RollbarApiResponse,
  RollbarMetricsColumn,
  RollbarTableMetricsResponse,
} from "../types/index.js";
import { makeRollbarRequest } from "./api.js";
import { injectProjectIdsMetricsFilter } from "./params.js";
import { buildProjectsParam } from "./project-params.js";
import { getRollbarResult } from "./response.js";

// Shared by the tools over the Metrics API's tables (POST /metrics/occurrences
// and POST /metrics/traces). Both run through the same metrics backend,
// so they take the same request and return the same response shape.

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
// more than fits in a conversation, so these tools always send one.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

// Unix seconds stay below this until the year 2286; anything larger is almost
// certainly a millisecond timestamp.
const MAX_UNIX_SECONDS = 9_999_999_999;

// About 20k tokens, the same default budget as list-occurrences. An array
// aggregate can return megabytes (one replay's recording events are several),
// which would flood the conversation or be cut off by the client.
export const MAX_RESPONSE_CHARS = 80_000;

export interface TableMetricsToolConfig {
  name: string;
  // The Metrics API table: POST /metrics/<table>.
  table: "occurrences" | "traces";
  description: string;
  // The column the API adds to every row with that row's count.
  countField: string;
  // The API can't sort the traces table on its count column.
  countFieldSortable: boolean;
  filterValuesDescription: string;
  keyDescription: string;
  // Appended to the error for a response over MAX_RESPONSE_CHARS.
  oversizeHint?: string;
}

/**
 * Builds the `key` the Metrics API expects for a key/value column. The
 * backend splits a key on its first unescaped dot and reads the rest as a
 * JSONPath into the value, so an attribute name such as `rollbar.replay.id`
 * would silently match nothing unless its dots are escaped as `\.`. Dots that
 * are already escaped are left alone, so an escaped key passes through
 * unchanged. `path`, when given, is appended as the JSONPath.
 */
export function escapeMetricsKey(key: string, path?: string): string {
  const escaped = key.replace(/(?<!\\)\./g, "\\.");
  return path === undefined ? escaped : `${escaped}.${path}`;
}

// These build a fresh schema per use: a zod instance used twice becomes a
// JSON Schema $ref in the tool listing, which some MCP clients can't resolve.
const unixSeconds = () =>
  z
    .number()
    .int()
    .nonnegative()
    .max(MAX_UNIX_SECONDS, "Use Unix seconds, not milliseconds");

const sortSchema = () =>
  z.object({
    field: z
      .string()
      .min(1)
      .describe("Column, group_by column, or aggregate alias to sort on"),
    order: z.enum(["asc", "desc"]),
  });

const pathSchema = () =>
  z
    .string()
    .min(1)
    .optional()
    .describe(
      "JSONPath inside the entry's value, without the leading '$.', such as 'user.id'. Requires key.",
    );

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

export function registerTableMetricsTool(
  server: McpServer,
  config: TableMetricsToolConfig,
) {
  const { countField } = config;

  // The traces table returns its count as a numeric string; the occurrences
  // table already returns a number.
  function flattenRow(row: RollbarMetricsColumn[]): Record<string, unknown> {
    return Object.fromEntries(
      row.map(({ field, value }) => [
        field,
        field === countField && typeof value === "string" && value !== ""
          ? Number(value)
          : value,
      ]),
    );
  }

  server.registerTool(
    config.name,
    {
      description: config.description,
      inputSchema: {
        start_time: unixSeconds()
          .optional()
          .describe(
            "Start of the range, in Unix seconds. Omitted or older than the account's data retention, the query starts at the retention boundary.",
          ),
        end_time: unixSeconds()
          .optional()
          .describe(
            "End of the range, inclusive, in Unix seconds. Omitted, the range has no upper bound.",
          ),
        granularity: z
          .enum(GRANULARITIES)
          .optional()
          .describe(
            "Bucket results into one timepoint per period. Omitted, all rows come back in a single timepoint.",
          ),
        timezone: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Timezone for bucketing timepoints, such as 'US/Pacific' (default: UTC).",
          ),
        filters: z
          .array(
            z.object({
              field: z
                .string()
                .min(1)
                .describe(
                  "Column to filter on, or an aggregate alias to filter the aggregated result.",
                ),
              operator: z
                .enum(FILTER_OPERATORS)
                .describe(
                  "eq and ne match any listed value; gt, gte, lt, lte take one value; like and ilike take one SQL LIKE pattern (% is the wildcard); is_null and not_null take no values.",
                ),
              values: z
                .array(z.union([z.string(), z.number()]))
                .optional()
                .describe(config.filterValuesDescription),
              key: z.string().min(1).optional().describe(config.keyDescription),
              path: pathSchema(),
            }),
          )
          .default([])
          .describe(
            "Filters that must all match. To choose projects, use the project parameter, not a project_id filter.",
          ),
        group_by: z
          .array(z.string().min(1))
          .optional()
          .describe("Columns to group rows by."),
        aggregates: z
          .array(
            z.object({
              field: z.string().min(1).describe("Column to aggregate."),
              function: z.enum(AGGREGATE_FUNCTIONS),
              alias: z
                .string()
                .regex(
                  /^[A-Za-z0-9_]+$/,
                  "Alias may contain only letters, digits, and underscores",
                )
                .describe("Name for the aggregate's value in each row."),
              key: z.string().min(1).optional().describe(config.keyDescription),
              path: pathSchema(),
              parameters: z
                .array(z.string())
                .optional()
                .describe(
                  "Function arguments as strings: topk takes a count, such as ['5']; quantiles takes an accuracy then levels, such as ['1000', '0.5', '0.9'].",
                ),
            }),
          )
          .optional()
          .describe(
            "Aggregates computed per group, such as count_distinct of a column.",
          ),
        sort: z
          .union([sortSchema(), z.array(sortSchema()).min(1)])
          .optional()
          .describe(
            "One sort, or several in priority order (default: timestamp ascending).",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .default(DEFAULT_LIMIT)
          .describe(
            `Maximum rows to return across all timepoints (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
          ),
        offset: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe(
            "Rows to skip before the first one returned (default 0). Use next_offset from a full page.",
          ),
        project: buildProjectsParam(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
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
      // The project parameter is the one way to choose projects. The API
      // ignores a project_id filter on a project token and intersects it with
      // the injected one on an account token, so either way it would only
      // mislead.
      if (filters.some((filter) => filter.field === "project_id")) {
        throw new Error(
          "Filtering on project_id is not supported. Use the project parameter to choose projects: a name or id, a list of them, or omit it for every project the token can read.",
        );
      }

      const sorts = sort === undefined ? [] : [sort].flat();
      if (
        !config.countFieldSortable &&
        sorts.some((entry) => entry.field === countField)
      ) {
        throw new Error(
          `${countField} can't be used as a sort field. Add a count_all aggregate with an alias, such as {"field": "span_id", "function": "count_all", "alias": "spans"}, and sort on the alias.`,
        );
      }

      // Validate keys and paths before resolving projects, which can make a
      // request of its own.
      const apiFilters = filters.map((filter) => ({
        // On an account token the API rejects any filter without a values
        // list, including is_null and not_null, which take no values.
        ...toApiKey(filter),
        values: filter.values ?? [],
      }));
      const apiAggregates = aggregates?.map(toApiKey);

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
      >(`${scope.apiBase}/metrics/${config.table}`, config.name, scope.token, {
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
          rows: timepoint.metrics_rows.map(flattenRow),
        }));
      const rowCount = timepoints.reduce(
        (total, timepoint) => total + timepoint.rows.length,
        0,
      );

      const output = {
        timepoints,
        last_occurrence_timestamp: result.last_occurrence_timestamp ?? null,
        row_count: rowCount,
        // The API reports no total, so a full page may have more behind it.
        ...(rowCount >= limit ? { next_offset: offset + limit } : {}),
      };

      const text = JSON.stringify(output);
      if (text.length > MAX_RESPONSE_CHARS) {
        throw new Error(
          `The result is ${text.length} characters, over this tool's ${MAX_RESPONSE_CHARS}-character limit. Narrow it with a lower limit, a shorter time range, or fewer array aggregates.${config.oversizeHint ? ` ${config.oversizeHint}` : ""}`,
        );
      }

      return { content: [{ type: "text", text }] };
    },
  );
}
