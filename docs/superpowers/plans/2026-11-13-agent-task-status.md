# Agent Task Status Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement and locally verify the PRO-1514 MCP status tool.

**Architecture:** A thin MCP tool calls the existing agent-task API utility using
personal-token configuration. It preserves the backend result and errors. Local
backend setup is independent of MCP implementation and runs in parallel.

**Tech Stack:** TypeScript, Zod, MCP SDK, Vitest; isolated Docker backend E2E.

**Spec:** `docs/superpowers/specs/2026-11-13-agent-task-status-design.md`

## Global Constraints

- Base on updated main; branch `andresb/pro-1514-agent-task-status`.
- Personal account read token; no project discovery, fallback, polling or retries.
- No production/staging runtime calls; external doubles and local DB setup allowed.
- Preserve the original local E2E evidence and user's unrelated repositories.
- No push. Leave the change reviewable locally.

## Review Focus

- Opaque IDs containing URL delimiters must stay inside the path segment.
- Read-only credentials must not require write scope or project discovery.
- Results, nulls and failure details must survive without reconstruction.
- Malformed API success responses must not masquerade as valid task states.
- Forbidden, expired and other-account runs must surface as MCP errors.

## Task 1: Implement the public tool contract

Files: add `src/tools/get-agent-task-status.ts` and
`tests/integration/agent-task-status.test.ts`; update `src/tools/index.ts`,
`src/utils/agent-tasks.ts`, `src/types/index.ts`, `src/config.ts`,
`src/utils/api.ts`, and `README.md`.

Interfaces: `registerGetAgentTaskStatusTool(server: McpServer)`;
`getAgentTaskStatus(taskSessionId: string): Promise<RollbarAgentTaskStatusResponse>`;
`resolveUserAuthContext(scope: "read" | "write" = "write")` uses scope for guidance.

- [x] Write MCP transport tests for registration, GET/auth, all seven statuses,
  finished RCA/Resolve payloads, optional failure reasons, null results, opaque
  IDs, invalid IDs, configured API base, non-user credentials, 403/404 and malformed
  responses. Assert one external request and no discovery.
- [x] Run `npx vitest run tests/integration/agent-task-status.test.ts`; expect RED
  because the tool is not registered.
- [x] Implement the tool, API read/types, scope-appropriate auth guidance and docs.
- [x] Run focused tests, then `npm test`, `npm run build`, `npm run lint`,
  `npm run format`; expect all passing.

## Task 2: Verify against the actual backend branches

Files: harness and evidence under `/tmp/rollbar-pro1514-e2e`, outside product code.
Consumes the compiled tool from Task 1, exact PR branch source and local fixtures.

- [x] Fetch/pin both branches and prepare isolated runtime images/configuration.
- [x] Exercise real MCP -> moxapi -> mox -> DB reads, real queued and finished
  RCA/Resolve runs, all status mappings, auth/access, expiry and feature-flag errors.
- [x] Independently inspect persisted results and ensure reads do not mutate runs.
- [x] Review the whole MCP change and resolve substantive findings with regression
  tests. Preserve exact commands, branch SHAs, substitutions and E2E limitations.

## Verification outcome

- Main was updated to `d4d073a`; MCP unit/integration suite: 543 passing,
  including 46 new tests first observed failing before implementation.
- Build, lint, formatting and independent MCP code review passed.
- Pinned mox `62c41a8268efbe618f1557f13e584d59052aad6a` and moxapi
  `d3531001ffe6b52df347ca8c4a338d1cda6827e1`: 49 local status checks passed.
- Real MCP reads observed queued/running/finished on fresh RCA and Resolve runs.
  DB/history/model-call fingerprints, reservations and queues remained unchanged
  across the read suite. The worker, database and queue operations were real;
  external inference, sandbox/SCM transports and notifications used local doubles.
- Upstream blocker: the mox dynamic status route precedes static start routes,
  making both POST starts return 404. Fresh runs were therefore created through
  unchanged internal services for status verification. The complete public
  start-to-status flow is not passing; backend code was not changed to hide it.
- Raw evidence and harness: `/tmp/rollbar-pro1514-e2e`. No production or staging
  runtime endpoint was contacted. No remote push was performed.
