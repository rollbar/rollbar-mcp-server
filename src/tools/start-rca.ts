import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startAgentTask } from "../utils/agent-tasks.js";

export function registerStartRcaTool(server: McpServer) {
  server.registerTool(
    "start-rca",
    {
      description:
        "Start an asynchronous root cause analysis (RCA) from a Rollbar occurrence ID, not an item ID or counter. Requires a configured user-scoped account token with write scope and project collab permission. Consumes credits and returns the new task_session_id, not the completed analysis. Do not automatically retry an uncertain result: this operation is not idempotent.",
      inputSchema: {
        source_occurrence_id: z
          .string()
          .refine(
            (id) => id.trim().length > 0,
            "Occurrence ID must not be blank",
          )
          .describe(
            "Required occurrence ID as a string, not an item ID or counter. Pass the ID unchanged, including decimal or hexadecimal forms; never convert it to a number.",
          ),
        continue_with_resolve: z
          .boolean()
          .default(false)
          .describe("Request Resolve after RCA completes. Defaults to false."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ source_occurrence_id, continue_with_resolve }) => {
      const result = await startAgentTask({
        kind: "rca",
        body: { source_occurrence_id, continue_with_resolve },
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
