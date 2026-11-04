import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTableMetricsTool } from "../utils/table-metrics.js";

export function registerGetTraceMetricsTool(server: McpServer) {
  registerTableMetricsTool(server, {
    name: "get-trace-metrics",
    table: "traces",
    countField: "span_count",
    // The API registers no count column for the traces table, so it rejects
    // span_count as a sort field.
    countFieldSortable: false,
    description:
      "Count and aggregate trace spans over a time range using the Rollbar Metrics API, the same way get-occurrence-metrics does for occurrences. Session replays and their telemetry are stored as OpenTelemetry spans: name 'rrweb-replay-recording' for replay recordings and 'rollbar-telemetry' for telemetry, linked by the rollbar.replay.id attribute and the session_id column. Each row holds its group_by columns, aggregate aliases, and span_count. Requires the account's Advanced package (otherwise 403). " +
      "With an account or user token, omit project to query every project the token can read, or pass a list of projects; group_by project_id to break rows down by project (rows then include project_slug). " +
      "Columns: project_id, environment, name, kind, session_id, trace_id, span_id (ids are hex strings), start_time (the time range and granularity apply to it), duration (nanoseconds). parent_id isn't available. " +
      "Key/value columns: attributes (span attributes) and events_attributes (span event attributes) take a key naming the attribute, such as 'rollbar.replay.id', and an optional path to read inside a JSON value. Replay spans carry rollbar.replay.id, rollbar.replay.trigger.type, rollbar.replay.url.full, rollbar.occurrence.uuids (a JSON array), user.id, user.email, user_agent.original and client.address, so results can include personal data. " +
      "Event columns (events_name, events_time, events_attributes_name, events_attributes_value) hold one entry per span event. An aggregate on one of them other than array counts once per event, which also inflates span_count and every other aggregate in the same query, so query event columns separately. A replay's recording is in its events and can be megabytes; use get-replay to read one. " +
      "span_count can't be sorted on: add a count_all aggregate with an alias and sort on that. Grouping by an attribute isn't supported. To count spans per attribute value, use topk on the attribute, which returns each value with its count; to see an attribute's values per session, group by session_id and use count_distinct or array on it (array repeats a value once per span). " +
      'Example, the 10 most recent replays with the inputs get-replay needs: {"filters": [{"field": "name", "operator": "eq", "values": ["rrweb-replay-recording"]}], "group_by": ["session_id", "environment"], "aggregates": [{"field": "attributes", "key": "rollbar.replay.id", "function": "array", "alias": "replay_ids"}, {"field": "start_time", "function": "min", "alias": "first_start"}], "sort": {"field": "first_start", "order": "desc"}, "limit": 10}',
    filterValuesDescription:
      "Values to match. session_id, trace_id and span_id match as hex strings.",
    keyDescription:
      "Attribute name for a key/value column, such as 'rollbar.replay.id' for attributes. Taken literally, dots included.",
    oversizeHint: "To read a replay's recording, use get-replay.",
  });
}
