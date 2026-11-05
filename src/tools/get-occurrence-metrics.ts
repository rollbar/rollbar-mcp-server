import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectScope } from "../config.js";
import type {
  RollbarApiResponse,
  RollbarMetricsColumn,
  RollbarOccurrenceMetricsResponse,
} from "../types/index.js";
import { makeRollbarRequest } from "../utils/api.js";
import { injectProjectIdsMetricsFilter } from "../utils/params.js";
import { buildProjectsParam } from "../utils/project-params.js";
import { getRollbarResult } from "../utils/response.js";

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

function flattenRow(row: RollbarMetricsColumn[]): Record<string, unknown> {
  return Object.fromEntries(row.map(({ field, value }) => [field, value]));
}

export function registerGetOccurrenceMetricsTool(server: McpServer) {
  server.registerTool(
    "get-occurrence-metrics",
    {
      description:
        "Count and aggregate occurrences over a time range using the Rollbar Metrics API. Filter, group, and aggregate occurrences, optionally bucketed into timepoints by granularity. Each row holds its group_by columns, aggregate aliases, and occurrence_count. Requires the account's Advanced package (otherwise 403). " +
        "With an account or user token, omit project to query every project the token can read, or pass a list of projects; group_by project_id to break rows down by project (rows then include project_slug). A broad search across every project, such as a message_body like filter, can be slow, so narrow the time range. " +
        "Common columns: item_counter, item_id, item_title, item_level, item_status, environment, code_version, framework, platform, language, browser_family, browser_version, os_family, os_version, device_model, person_id, person_email, ip_address, server_host, request_url, request_method, exception_class, exception_message, context, fingerprint, scm_branch. " +
        "Key/value columns (request_headers, request_params, request_gets, request_posts, customs, traceframe_locals, attributes) take a key naming the entry. " +
        "Results default to timestamp ascending; for top-N questions sort by occurrence_count desc. " +
        'Example, daily occurrences per item in production since start_time: {"start_time": <Unix seconds>, "granularity": "day", "filters": [{"field": "environment", "operator": "eq", "values": ["production"]}], "group_by": ["item_counter"], "sort": {"field": "occurrence_count", "order": "desc"}}',
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
                .describe(
                  "Values to match. item_status and item_level match by name, such as 'active' or 'error'.",
                ),
              key: z
                .string()
                .min(1)
                .optional()
                .describe(
                  "Entry name for a key/value column, such as 'User-Agent' for request_headers.",
                ),
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
              key: z
                .string()
                .min(1)
                .optional()
                .describe("Entry name for a key/value column."),
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
            "Aggregates computed per group, such as count_distinct of person_id.",
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

      const scope = await resolveProjectScope(project);
      const body = {
        start_time,
        end_time,
        granularity,
        timezone,
        // On an account token the API rejects any filter without a values
        // list, including is_null and not_null, which take no values.
        filters: injectProjectIdsMetricsFilter(
          filters.map((filter) => ({ ...filter, values: filter.values ?? [] })),
          scope.projectIds,
        ),
        group_by,
        aggregates,
        sort,
        limit,
        offset,
      };

      const response = await makeRollbarRequest<
        RollbarApiResponse<RollbarOccurrenceMetricsResponse>
      >(
        `${scope.apiBase}/metrics/occurrences`,
        "get-occurrence-metrics",
        scope.token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
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
      // stamped 0, which reads like an occurrence at the Unix epoch.
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

      return { content: [{ type: "text", text: JSON.stringify(output) }] };
    },
  );
}
