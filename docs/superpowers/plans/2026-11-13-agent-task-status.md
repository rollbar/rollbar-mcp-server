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

The local harness consumes the compiled tool from Task 1, exact PR branch source
and local fixtures. The verification outcome below records the tested revisions,
results and limitations; the raw harness and logs are local artifacts, not
repository dependencies or shared evidence links.

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

The final local E2E on 2026-11-13 passed the complete public start-to-status flow
using MCP [`b6ec27b`](https://github.com/rollbar/rollbar-mcp-server/commit/b6ec27b0f7ca9a16d349e9a8e002816da1bfc36b),
mox [`87b2dd36`](https://github.com/rollbar/mox/commit/87b2dd36f3f5e60ac0bc7e36e15ac317e4b68d72)
and moxapi [`d3531001`](https://github.com/rollbar/moxapi/commit/d3531001ffe6b52df347ca8c4a338d1cda6827e1).
These are recorded results from the existing E2E artifacts, not a new E2E run
performed for this documentation correction.

| Check group                                                        | Passed |
| ------------------------------------------------------------------ | ------ |
| HTTP status, results and authorization                             | 26/26  |
| MCP discovery, status, results and errors                          | 15/15  |
| Disabled AI feature flag through HTTP and MCP                      | 2/2    |
| Pyramid routing for both starts and the status endpoint            | 4/4    |
| Public RCA and Resolve starts, running states and finished results | 6/6    |
| Total                                                              | 53/53  |

The actual MCP process started RCA through `POST /api/1/agent_tasks/rca`, waited
for completion, then started Resolve through `POST /api/1/agent_tasks/resolve`
using that RCA session. Both POSTs and all six status GETs returned HTTP 200.
Each run progressed through `queued → running → finished`; the normal workers
produced the RCA analysis and Resolve result. Task creation and completion used
neither direct service calls nor manually assigned database states.

Independent checks confirmed the linked tasks, successful worker stages, released
credit reservations and removed worker jobs. Across the separate HTTP/MCP status
read suite, fingerprints of 33 tasks, 70 history rows, 12 model calls, 11 task
relationships and 20 item links, plus reservations and queue counts, were unchanged.

The earlier test against mox `62c41a8` found a route-order defect that made the
public starts return 404. That result is superseded by the final E2E above:
the [corrected route registration](https://github.com/rollbar/mox/blob/87b2dd36f3f5e60ac0bc7e36e15ac317e4b68d72/mox/pyramid/routes.py#L1325-L1343)
places the status route after both static start routes and restricts it to GET.

The MCP process, HTTP applications, authorization, databases, queues and workers
were real local components. External inference, sandbox, GitHub and notification
integrations used local substitutes; no external PR was created and no production
or staging runtime endpoint was contacted. Exceptional status and authorization
cases used seeded fixtures; the fresh public RCA-to-Resolve chain did not.
These results verify local integration, not external provider behavior or model
quality. Deployment still requires [mox #14555](https://github.com/rollbar/mox/pull/14555)
and [moxapi #1277](https://github.com/rollbar/moxapi/pull/1277).
