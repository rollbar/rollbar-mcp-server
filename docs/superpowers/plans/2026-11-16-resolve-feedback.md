# Resolve Feedback Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the MCP implementation. Backend E2E preparation is an independent delegated task under superpowers:dispatching-parallel-agents.

**Goal:** Submit feedback to an existing Resolve run through MCP and verify the continuation locally.

**Architecture:** A focused MCP tool calls the existing agent-task adapter with personal write authentication. Backend services retain ownership of permissions, eligibility, credits and continuation; clients use the status tool separately.

**Tech Stack:** TypeScript, Zod, MCP SDK, Vitest; actual mox/moxapi branches with MySQL/Redis/Beanstalk and local boundary substitutes.

**Spec:** `docs/superpowers/specs/2026-11-16-resolve-feedback-design.md`

## Global Constraints

- Branch: `andresborek/pro-1515-story-send-feedback-on-a-resolve-run`, from updated main.
- Same session ID, trimmed nonblank content, personal account write token.
- One POST per call; no project discovery, fallback credentials, automatic retry or polling.
- No production/staging runtime traffic and no push.

## Review Focus

- Opaque IDs containing slashes/query/fragment characters remain one encoded path segment; dot segments are rejected.
- Whitespace-only or non-string feedback is rejected before HTTP; inner whitespace/Unicode and content longer than 4,000 characters survive.
- Missing user credentials never fall back to project/account-wide tokens.
- Malformed success payloads, empty feedback IDs or a changed run ID cannot be reported as success.
- Delivery/network errors do not duplicate writes; backend permission and eligibility reasons remain actionable.

### Task 1: Feedback tool and contract tests

**Files:** new `src/tools/send-resolve-feedback.ts`, `src/utils/agent-task-params.ts`, `tests/integration/resolve-feedback.test.ts`; update `src/utils/agent-tasks.ts`, `src/types/index.ts`, `src/tools/index.ts`, `src/tools/get-agent-task-status.ts`, `src/utils/api.ts`, `README.md`.

**Interfaces:** `sendResolveFeedback(taskSessionId: string, content: string): Promise<RollbarResolveFeedbackResponse>`; response contains `task_session_id` and `feedback_id`. `taskSessionIdSchema` is shared by status and feedback tools.

- [x] Update main, create requested branch, inspect ticket/PR contracts and existing code.
- [x] Run clean baseline (`npm test`).
- [x] Write MCP-level tests covering discovery/write annotations, exact authenticated request, normalized content, encoded path, validation, credentials, backend errors and malformed success payloads.
- [x] Run `npx vitest run tests/integration/resolve-feedback.test.ts`; verify missing-tool RED failure.
- [x] Implement the focused tool/adapter/types/registration/auth hint and share the path-ID schema; document usage and continuation.
- [x] Run focused tests, full `npm test`, build, lint and format checks; all must pass.

### Task 2: Local backend E2E and review

**Files:** isolated runtime/harness/evidence under `/tmp/rollbar-pro1515-e2e`; sanitized durable evidence under the authorized visualization directory. No changes to original backend checkouts.

**Interfaces:** compiled `/Users/andres/Development/rollbar-mcp-server/build/index.js`, tool `send-resolve-feedback({ task_session_id, content })` and existing start/status tools.

- [x] Fetch/pin mox PR14563 and moxapi PR1281, prepare exact branch images and isolated local services.
- [x] Submit feedback via actual MCP, verify same session ID/feedback persistence, worker continuation and finished output; separately exercise permission/input/eligibility failures where feasible.
- [x] Independently verify recorded evidence and source/isolation claims; document any mocked boundary or limitation honestly.
- [x] Obtain a fresh whole-change review, address substantive findings, save an English E2E summary and verification results.
- [x] Commit the reviewed change locally; no push. Report directory, branch, commit and verification.

## Execution ledger

- User explicitly authorized implementing the supplied contract and local E2E. Keep the existing checkout on the requested new branch; no additional worktree is needed for MCP.
- Backend runtime preparation is delegated separately; the parent owns all MCP source edits. Do not submit feedback until the parent confirms the compiled tool is ready.

- Baseline: 543/543 passed. RED: 49 feedback cases failed with missing tool; GREEN: 151/151 agent start/status/feedback cases passed. Raw logs: `/tmp/rollbar-pro1515-mcp`. One malformed-envelope assertion follows the existing response helper's error contract rather than changing unrelated behavior.

- Fresh reviewer independently passed 95 feedback/status tests and identified two P2 issues: destructive annotation and discarded HTTP status. Both reproduced together (10 failed, 39 passed). Fixes mark the feedback write destructive and retain numeric HTTP status alongside backend JSON error messages in the shared transport helper; existing message prefixes are preserved.
- Review set aside real backend behavior/evidence for parent verification, as assigned. That verification remains required in Task 2 and is not treated as passed by the code review.

- Review fixes verified RED→GREEN: 10 failures reproduced, then 49/49 feedback and 592/592 full tests passed; build/lint/format passed. Shared HTTP error messages now append numeric status while retaining their existing prefix and backend reason.
- Independently verified 5,692 mox source files (sanitized development.ini excepted), 292 moxapi files, changed locked dependencies, and isolated internal network with no external route. Source pins: mox `34e0c2c556ee5e507e7fc35297a8793341dc29ea`, moxapi `66fc35010a89c4eb0feaa412e540e579fcf517ee`.

## Local E2E result — 2026-11-16

49/49 final-build HTTP/MCP checks passed against the exact backend PR branches. The test copied a genuinely completed Resolve 33 from the earlier PRO-1514 public E2E into a separate local database; this run did not create a new RCA or Resolve. Hard-to-reach negative cases used ten labeled database fixtures.

- 28 HTTP and 8 MCP checks covered input, token scopes/types, account/project/collab permissions, missing/expired/foreign/RCA IDs, ineligible states and missing successful history.
- 8 HTTP/MCP checks covered disabled AI features, insufficient credits, closed PR and unverifiable PR state. Rejected requests left all task/history/model-call/relationship/item-link fingerprints unchanged. Temporary flag, credit and PR-state settings were restored.
- A real queue outage produced a durable-feedback HTTP 503 through MCP. After restoring the queues, one explicit retry returned HTTP 200, reusing the same run ID and feedback ID. Exactly one feedback entry, one continuation marker and one queued job existed; no new task was created.
- MCP observed the same Resolve session as queued, running and finished. Intermediate states omitted stale results; final output identified the applied feedback.
- The continuation service recorded FEEDBACK_REQUESTED, and the normal worker completed FEEDBACK_BRANCH_SYNCED, RESOLVE_FEEDBACK_CHANGES_CREATED, PULL_REQUEST_UPDATED and RESOLVE_DETERMINED in loop 1. The previous loop was preserved. The normalized feedback was independently linked from HTTP to DB, inference prompt, applied-feedback metadata and a new child Git commit on the same branch.
- Independent reads verified job deletion, reservation release, one simulated 100-credit model call, one mock PR update and three executed local regression assertions. New fixture Git commit: `4d27ff55019662eb42e13046ffe19ad49643091b`.

Real components: MCP stdio client/server, both HTTP apps, authorization, continuation services, MySQL/Redis/Beanstalk, normal worker stages and local Git operations. Local substitutes: model inference/artifacts, Modal transport, GitHub PR state/update, notification/analytics boundaries, and LaunchDarkly file source. No real model inference or external PR update occurred. Runtime stayed on Docker internal network `pro1515_e2e`; no production or staging calls. This verifies integration and lifecycle, not external-provider behavior or model quality.

Raw runtime/evidence: `/tmp/rollbar-pro1515-e2e`. Parent verification and MCP RED/GREEN/check logs: `/tmp/rollbar-pro1515-mcp`. Sanitized durable archive: `pro1515-local-e2e` under the session's authorized visualization directory.

- Final readiness confirmed AI features enabled, both queues and all seven services running, no pending worker, and original PRO-1514 Resolve 33 still completed at loop 0. Sanitized 49-check evidence exported; the branch is retained locally for the user to push.
