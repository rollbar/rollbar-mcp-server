# Resolve feedback through MCP (PRO-1515)

Expose `send-resolve-feedback({ task_session_id, content })` so an assistant can refine an existing Resolve pull request and follow the same run with `get-agent-task-status`.

The user supplied the API contract and requested implementation, tests, and a local E2E. Linear recommends `andresborek/pro-1515-story-send-feedback-on-a-resolve-run`; use that exact branch from updated main (`5bb4fc5`).

## Responsibilities and use

- The tool owns input validation, public description and MCP annotations. Session IDs are nonblank opaque path segments; reject dot-only traversal segments. Feedback is a nonblank string with surrounding whitespace trimmed, without the unrelated initial-instructions 4,000-character limit.
- The agent-task API adapter owns one authenticated JSON POST to `/agent_tasks/{encoded task_session_id}/feedback`, response validation and preservation. Require the configured personal account write token, with no project discovery or fallback to project/account-wide tokens.
- The backend owns authorization, feature gating, run eligibility, feedback persistence, credits and continuation. Return the same session ID and a nonblank feedback ID. Surface backend errors; do not automatically retry, create a replacement run or poll.
- Share the existing path session-ID schema with status so path-validation rules have one home.

```text
send-resolve-feedback({task_session_id: "resolve-run", content: "  Cover retries.  "})
=> {task_session_id: "resolve-run", feedback_id: "feedback-entry"}
get-agent-task-status({task_session_id: "resolve-run"})
```

## Approach

Extend the existing tool + agent-task adapter pattern. A generic endpoint-dispatch tool would hide the operation's authorization and write semantics; embedding a polling/continuation workflow in this tool would exceed the contract. Keep one focused operation and reuse existing status polling explicitly.

The tool is a non-idempotent write with `destructiveHint: true`, since refinement can replace existing PR code. HTTP errors retain both the numeric status and backend reason. A 503 may permit an explicit retry of identical feedback under the backend contract, but the MCP does not retry uncertain writes itself. Preserve 400/401/403/404/409/422/503 errors; 403 guidance names personal write scope, collab on every project, and `ai-features-enabled`.

## Verification and boundaries

Exercise the real MCP registration/validation/auth/request/error path with only file configuration and HTTP boundary doubles. Then use the actual mox PR14563 and moxapi PR1281 branches in an isolated Docker network. Submit feedback through compiled MCP and observe the same run's real continuation/worker/status lifecycle, persistence, queues and local Git output. External inference/sandbox/SCM/notification integrations may use declared local substitutes. Manual DB preparation is permitted for otherwise unreachable cases. Never call production or staging; preserve prior E2E evidence. No push.
