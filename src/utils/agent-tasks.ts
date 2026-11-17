import { resolveUserAuthContext } from "../config.js";
import type {
  RollbarAgentTaskListResponse,
  RollbarAgentTaskStartResponse,
  RollbarAgentTaskState,
  RollbarAgentTaskStatusResponse,
  RollbarApiResponse,
  RollbarResolveFeedbackResponse,
} from "../types/index.js";
import { AGENT_TASK_STATUSES } from "../types/index.js";
import type {
  ListAgentTasksParams,
  StartRcaParams,
} from "./agent-task-params.js";
import { makeRollbarRequest } from "./api.js";
import { getRollbarResult } from "./response.js";

type AgentTaskStart =
  | {
      kind: "rca";
      body: StartRcaParams;
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
  // Older APIs omit the selected occurrence on occurrence-ID starts.
  const occurrenceIdExpected =
    request.kind === "rca" &&
    (request.body.source_occurrence_id === undefined ||
      result.source_occurrence_id !== undefined);
  if (
    occurrenceIdExpected &&
    (typeof result.source_occurrence_id !== "string" ||
      result.source_occurrence_id.trim().length === 0)
  ) {
    throw new Error(
      "Invalid Rollbar API response: missing source occurrence ID",
    );
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
  if (!isAgentTaskState(result)) {
    throw new Error("Invalid Rollbar API response: invalid agent task status");
  }
  return result;
}

/** Read one candidate page; the backend owns ordering, visibility and expiry. */
export async function listAgentTasks(
  params: ListAgentTasksParams,
): Promise<RollbarAgentTaskListResponse> {
  const auth = resolveUserAuthContext("read");
  const query = new URLSearchParams({
    project_slug: params.project_slug,
    item_counter: String(params.item_counter),
  });
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const response = await makeRollbarRequest<
    RollbarApiResponse<RollbarAgentTaskListResponse>
  >(`${auth.apiBase}/agent_tasks?${query}`, "list-agent-tasks", auth.token, {
    method: "GET",
  });
  const result = getRollbarResult(response, "agent task list");
  if (
    typeof result !== "object" ||
    Array.isArray(result) ||
    !Array.isArray(result.tasks) ||
    !result.tasks.every(
      (task) =>
        isAgentTaskState(task) && Number.isSafeInteger(task.date_created),
    ) ||
    (result.next_offset !== undefined &&
      result.next_offset !== null &&
      (!Number.isSafeInteger(result.next_offset) || result.next_offset < 0))
  ) {
    throw new Error("Invalid Rollbar API response: invalid agent task list");
  }
  return result;
}

function isAgentTaskState(value: unknown): value is RollbarAgentTaskState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const task = value as Partial<RollbarAgentTaskState>;
  return (
    typeof task.task_session_id === "string" &&
    task.task_session_id.trim().length > 0 &&
    (task.agent_type === "rca" || task.agent_type === "resolve") &&
    AGENT_TASK_STATUSES.some((status) => status === task.status)
  );
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
