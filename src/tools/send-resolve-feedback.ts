import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { taskSessionIdSchema } from "../utils/agent-task-params.js";
import { sendResolveFeedback } from "../utils/agent-tasks.js";

export function registerSendResolveFeedbackTool(server: McpServer) {
  server.registerTool(
    "send-resolve-feedback",
    {
      description:
        "Send feedback to refine an existing Resolve pull request. Requires a personal account token with write scope, collab permission on every project in the run, and AI features enabled. Starts a continuation on the same run and can consume credits. Returns the same task_session_id and a feedback_id; use get-agent-task-status to follow progress. Makes one non-idempotent write; do not automatically retry an uncertain result.",
      inputSchema: {
        task_session_id: taskSessionIdSchema.describe(
          "The existing Resolve run's task_session_id, not an RCA session, item or occurrence ID.",
        ),
        content: z
          .string()
          .trim()
          .min(1, "Feedback content must not be blank")
          .describe(
            "Instructions for refining the Resolve pull request. Surrounding whitespace is trimmed; content must not be blank.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ task_session_id, content }) => {
      const result = await sendResolveFeedback(task_session_id, content);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
