import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startAgentTask } from "../utils/agent-tasks.js";

export function registerStartResolveTool(server: McpServer) {
  server.registerTool(
    "start-resolve",
    {
      description:
        "Start asynchronous Resolve work from a suitable completed RCA run in the same Rollbar account. Requires a configured user-scoped account token with write scope and collab permission on the RCA projects. Consumes credits and returns a new task_session_id. Do not automatically retry an uncertain result: this operation is not idempotent.",
      inputSchema: {
        rca_task_session_id: z
          .string()
          .refine(
            (id) => id.trim().length > 0,
            "RCA task session ID must not be blank",
          )
          .describe("The task_session_id returned by the completed RCA run."),
        initial_instructions: z
          .string()
          // Match the backend's Python len(): Unicode code points, not UTF-16 units.
          .refine(
            (text) => [...text].length <= 4000,
            "Instructions must be at most 4,000 characters",
          )
          .optional()
          .describe(
            "Optional instruction text, up to 4,000 characters. Extends the normal Resolve work and is sent unchanged.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ rca_task_session_id, initial_instructions }) => {
      const result = await startAgentTask({
        kind: "resolve",
        body: { rca_task_session_id, initial_instructions },
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
