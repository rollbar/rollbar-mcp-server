import { resolveUserAuthContext } from "../config.js";
import type {
  RollbarAgentTaskStartResponse,
  RollbarApiResponse,
} from "../types/index.js";
import { makeRollbarRequest } from "./api.js";
import { getRollbarResult } from "./response.js";

type AgentTaskStart =
  | {
      kind: "rca";
      body: { source_occurrence_id: string; continue_with_resolve: boolean };
    }
  | {
      kind: "resolve";
      body: { rca_task_session_id: string; initial_instructions?: string };
    };

/** Start one task. An uncertain POST must never be automatically retried. */
export async function startAgentTask(
  request: AgentTaskStart,
): Promise<RollbarAgentTaskStartResponse> {
  const auth = resolveUserAuthContext();
  const response = await makeRollbarRequest<
    RollbarApiResponse<RollbarAgentTaskStartResponse>
  >(
    `${auth.apiBase}/agent_tasks/${request.kind}`,
    `start-${request.kind}`,
    auth.token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    },
  );
  const result = getRollbarResult(response, "agent task");
  if (
    typeof result.task_session_id !== "string" ||
    result.task_session_id.trim().length === 0
  ) {
    throw new Error("Invalid Rollbar API response: missing task session ID");
  }
  return result;
}
