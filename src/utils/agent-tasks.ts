import { resolveUserAuthContext } from "../config.js";
import type {
  RollbarAgentTaskStartResponse,
  RollbarAgentTaskStatusResponse,
  RollbarApiResponse,
  RollbarResolveFeedbackResponse,
} from "../types/index.js";
import { AGENT_TASK_STATUSES } from "../types/index.js";
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

/** Read one snapshot of a run; the caller decides when to check again. */
export async function getAgentTaskStatus(
  taskSessionId: string,
): Promise<RollbarAgentTaskStatusResponse> {
  const auth = resolveUserAuthContext("read");
  const response = await makeRollbarRequest<
    RollbarApiResponse<RollbarAgentTaskStatusResponse>
  >(
    `${auth.apiBase}/agent_tasks/${encodeURIComponent(taskSessionId)}`,
    "get-agent-task-status",
    auth.token,
    { method: "GET" },
  );
  const result = getRollbarResult(response, "agent task status");
  if (
    typeof result !== "object" ||
    Array.isArray(result) ||
    typeof result.task_session_id !== "string" ||
    result.task_session_id.trim().length === 0 ||
    (result.agent_type !== "rca" && result.agent_type !== "resolve") ||
    !AGENT_TASK_STATUSES.includes(result.status)
  ) {
    throw new Error("Invalid Rollbar API response: invalid agent task status");
  }
  return result;
}

/** Submit feedback once; callers decide whether to retry a failed delivery. */
export async function sendResolveFeedback(
  taskSessionId: string,
  content: string,
): Promise<RollbarResolveFeedbackResponse> {
  const auth = resolveUserAuthContext("write");
  const response = await makeRollbarRequest<
    RollbarApiResponse<RollbarResolveFeedbackResponse>
  >(
    `${auth.apiBase}/agent_tasks/${encodeURIComponent(taskSessionId)}/feedback`,
    "send-resolve-feedback",
    auth.token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  const result = getRollbarResult(response, "Resolve feedback");
  if (
    typeof result !== "object" ||
    Array.isArray(result) ||
    result.task_session_id !== taskSessionId ||
    typeof result.feedback_id !== "string" ||
    result.feedback_id.trim().length === 0
  ) {
    throw new Error(
      "Invalid Rollbar API response: invalid Resolve feedback result",
    );
  }
  return result;
}
