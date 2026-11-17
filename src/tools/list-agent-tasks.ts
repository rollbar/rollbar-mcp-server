import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAgentTasksParamsSchema } from "../utils/agent-task-params.js";
import { listAgentTasks } from "../utils/agent-tasks.js";

export function registerListAgentTasksTool(server: McpServer) {
  server.registerTool(
    "list-agent-tasks",
    {
      description:
        "List RCA and Resolve runs for an item using project_slug and item_counter from its URL. Requires a personal account token with read scope, view access to the item's project, and AI features enabled. Returns one page of tasks newest first with task_session_id, agent_type, status and date_created (Unix seconds). Expired runs and runs whose associated projects are not all visible to the user are omitted. Follow next_offset when non-null, even if tasks is empty; no automatic pagination. Use a run's task_session_id with get-agent-task-status, or a Resolve run's ID with send-resolve-feedback.",
      inputSchema: listAgentTasksParamsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (params) => {
      const result = await listAgentTasks(params);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
