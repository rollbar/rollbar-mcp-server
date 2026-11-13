import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAgentTaskStatus } from "../utils/agent-tasks.js";

export function registerGetAgentTaskStatusTool(server: McpServer) {
  server.registerTool(
    "get-agent-task-status",
    {
      description:
        "Get the current status and available results of an RCA or Resolve run by task_session_id. Requires a personal account token with read scope, view access to the account and every project in the run, and AI features enabled. Status is queued, running, blocked, canceling, finished, failed, or canceled. Finished runs include RCA analysis or Resolve output with the pull request URL when available; failed runs may include failure_reason. Makes one read-only request; call again later to check progress.",
      inputSchema: {
        task_session_id: z
          .string()
          .refine(
            (id) => id.trim().length > 0 && id !== "." && id !== "..",
            "Task session ID must not be blank or a dot-only path segment",
          )
          .describe(
            "The task_session_id returned by start-rca or start-resolve; not an item or occurrence ID.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ task_session_id }) => {
      const result = await getAgentTaskStatus(task_session_id);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
