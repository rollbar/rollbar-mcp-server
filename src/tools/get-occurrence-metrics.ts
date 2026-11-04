import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTableMetricsTool } from "../utils/table-metrics.js";

export function registerGetOccurrenceMetricsTool(server: McpServer) {
  registerTableMetricsTool(server, {
    name: "get-occurrence-metrics",
    table: "occurrences",
    countField: "occurrence_count",
    countFieldSortable: true,
    description:
      "Count and aggregate occurrences over a time range using the Rollbar Metrics API. Filter, group, and aggregate occurrences, optionally bucketed into timepoints by granularity. Each row holds its group_by columns, aggregate aliases, and occurrence_count. Requires the account's Advanced package (otherwise 403). " +
      "With an account or user token, omit project to query every project the token can read, or pass a list of projects; group_by project_id to break rows down by project (rows then include project_slug). A broad search across every project, such as a message_body like filter, can be slow, so narrow the time range. " +
      "Common columns: item_counter, item_id, item_title, item_level, item_status, environment, code_version, framework, platform, language, browser_family, browser_version, os_family, os_version, device_model, person_id, person_email, ip_address, server_host, request_url, request_method, exception_class, exception_message, context, fingerprint, scm_branch. " +
      "Key/value columns (request_headers, request_params, request_gets, request_posts, customs, traceframe_locals, attributes) take a key naming the entry, and an optional path to read inside a JSON value. " +
      "Results default to timestamp ascending; for top-N questions sort by occurrence_count desc. " +
      'Example, daily occurrences per item in production since start_time: {"start_time": <Unix seconds>, "granularity": "day", "filters": [{"field": "environment", "operator": "eq", "values": ["production"]}], "group_by": ["item_counter"], "sort": {"field": "occurrence_count", "order": "desc"}}',
    filterValuesDescription:
      "Values to match. item_status and item_level match by name, such as 'active' or 'error'.",
    keyDescription:
      "Entry name for a key/value column, such as 'User-Agent' for request_headers or 'execution_duration' for customs. Taken literally, dots included.",
  });
}
