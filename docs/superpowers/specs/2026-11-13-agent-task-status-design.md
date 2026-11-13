# PRO-1514: read agent task status

Expose `get-agent-task-status({ task_session_id: "run-id" })` so a caller can
read an RCA or Resolve run after starting it. Return the API's result as JSON
text, preserving status, nested results, failure details, nulls and extra fields.

The tool owns input validation and MCP metadata. The existing agent-task API
utility owns the authenticated GET and response-envelope validation. Configuration
owns personal-token selection; the backend owns scopes, account/project access,
expiry and feature flags. Use the existing request/error utilities.

Use one GET per invocation, with the ID encoded as one path segment. Repeated
tool calls provide polling; no hidden polling loop or automatic retries. Require
a nonblank string ID, rejecting dot-only path segments. Advertise a read-only,
idempotent tool without a project selector. Use a personal account token with read
scope, never project discovery or token fallback.

The seven statuses are queued, running, blocked, canceling, finished, failed and
canceled. Finished results may be null in the backend implementation. A failed
run's recorded reason is optional. Preserve 403/404 and other backend errors.

Approach: extend the existing agent-task utility with a read operation. A separate
client abstraction or a background polling service adds no necessary responsibility
for this endpoint. No new dependencies or changes to the backend are needed.

Validate through MCP integration tests and a local E2E against mox PR 14555 and
moxapi PR 1277. External execution services may be mocked, and DB fixtures may
cover exceptional states. Never call production or staging runtime endpoints.
