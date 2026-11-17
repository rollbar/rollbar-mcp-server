import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startRcaParamsSchema } from "../utils/agent-task-params.js";
import { startAgentTask } from "../utils/agent-tasks.js";

export function registerStartRcaTool(server: McpServer) {
  server.registerTool(
    "start-rca",
    {
      description:
        "Start an asynchronous root cause analysis (RCA) using either source_occurrence_id or project_slug plus item_counter from the item URL, never both. For an item, Rollbar selects its latest occurrence at kickoff. Requires a configured user-scoped account token with write scope, collab permission on the source and correlated projects, and AI features enabled. Consumes credits and returns task_session_id plus the selected source_occurrence_id for item starts; older occurrence-ID responses may omit source_occurrence_id. Use get-agent-task-status to check the run. Do not automatically retry an uncertain result: this operation is not idempotent.",
      inputSchema: startRcaParamsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (params) => {
      const result = await startAgentTask({
        kind: "rca",
        body: params,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
