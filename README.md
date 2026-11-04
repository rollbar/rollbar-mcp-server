# rollbar-mcp-server

A Model Context Protocol (MCP) server for [Rollbar](https://rollbar.com).

## Features

This MCP server implements the `stdio` server type, which means your AI tool (e.g. Claude, Cursor) will run it directly; you don't run a separate process or connect over http.

## Configuration

### User access token

To read item history and post comments as yourself, configure a Rollbar **user-scoped account access token** with `ROLLBAR_USER_ACCESS_TOKEN`, or use a config file:

```json
{ "userToken": "<user access token>" }
```

Use **read** scope for reads, or **read and write** to post comments. The MCP resolves your project through `GET /projects` (read scope), then posts with write scope. Your Rollbar user also needs **view** permission to read history and **comment** permission to post in that project. Project tokens and ordinary account tokens cannot post comments.

User mode sends every request with the configured user's token, including when per-project tokens are also present. Comment authorship comes from that token; you cannot supply a different author. The backend marks posted comments with `via_api: true` and handles normal subscriptions and notifications.

Configure exactly one of `userToken` / `ROLLBAR_USER_ACCESS_TOKEN` or `accountToken` / `ROLLBAR_ACCOUNT_ACCESS_TOKEN`. Configuring both fails at startup, including when one comes from a file and the other from the environment. A file value overrides the environment value for the same token type. `apiBase` in a file or `ROLLBAR_API_BASE` in environment-only configuration selects a custom API endpoint.

Use `list-projects` to find the project name or numeric ID for the tools' `project` argument. It is optional when your user token can see exactly one enabled project. A token supplied only through the legacy `ROLLBAR_ACCESS_TOKEN` setting is not inferred to be a user token; set `ROLLBAR_USER_ACCESS_TOKEN` explicitly for posting.

### Account access token

Configure a single Rollbar Account Access Token to read and update items across projects in that account. Posting comments requires user mode above:

- `ROLLBAR_ACCOUNT_ACCESS_TOKEN` (env var), or
- `accountToken` (a top-level key in `.rollbar-mcp.json`, alongside `projects`/`token`/`apiBase`)

To create one: in Rollbar, go to your **account settings → Account Access Tokens**, create a new named, enabled token, and choose **read** (or **read and write**, if you plan to use `update-item`) scope. Copy the full generated secret right away, Rollbar only shows it once, and store it securely (a secrets manager or your shell's env config, not committed to source control).

```json
{
  "accountToken": "acct_tok_abc123"
}
```

If you want tighter controls on some projects, give the account token read scope so you can read every project, then explicitly list the few projects that need `update-item` with their own read+write project tokens. Those override the account token for that project only, per the precedence rule below (explicit project token always wins).

```json
{
  "accountToken": "acct_tok_abc123",
  "projects": [
    { "name": "backend", "token": "tok_backend_readwrite" }
  ]
}
```

Project-token configs are completely unchanged by this feature: if you don't set an account token, nothing about existing single- or multi-project setups behaves any differently. The two modes can also coexist: if a `project` name matches an explicitly configured project that has its own token, that project's own token is always used for that project, even when an account token is also present.

### Per-project configuration for more secure access

**Single Project: Environment variable**

- `ROLLBAR_ACCESS_TOKEN`: access token for your Rollbar project.
- `ROLLBAR_API_BASE` (optional): override the API base URL (defaults to `https://api.rollbar.com/api/1`).

**Multiple Project: Config file**

Create `.rollbar-mcp.json` in your working directory or home directory, or set `ROLLBAR_CONFIG_FILE` to point to a custom path. A checked-in template is available at `rollbar-mcp-example.json`; copy it to `.rollbar-mcp.json` and fill in your real tokens.

Single project shorthand:

```json
{ "token": "tok_abc123" }
```

Multiple projects:

```json
{
  "projects": [
    { "name": "backend",  "token": "tok_abc123" },
    { "name": "frontend", "token": "tok_xyz789" }
  ]
}
```

Config file lookup order:

1. `ROLLBAR_CONFIG_FILE` env var
2. `.rollbar-mcp.json` in current working directory
3. `~/.rollbar-mcp.json` in home directory
4. `ROLLBAR_ACCESS_TOKEN`, `ROLLBAR_ACCOUNT_ACCESS_TOKEN`, or `ROLLBAR_USER_ACCESS_TOKEN` env var

If a config file exists but is invalid, the server exits with an error instead of falling back to a lower-priority config source.

Required scopes:

- Read-only tools (`get-item-details`, `get-deployments`, `get-version`, `get-top-items`, `list-items`, `get-replay`, `list-projects`, `list-occurrences`, `list-item-events`, `get-metrics`) work with a **read**-scope account or user token, subject to project permissions. `get-metrics` also requires the account's Advanced package.
- `update-item` requires an account token with **both read and write** scope: every account-token call resolves the target project via `GET /projects` first (read), then makes the `PATCH` request (write). A write-only token will fail at the project-resolution step before ever reaching the update.
- As with project tokens, prefer a read-scope token unless you specifically need `update-item`.
- `post-item-comment` requires a **user** token with **read and write** scope and project **comment** permission.

If the server detects only `ROLLBAR_ACCESS_TOKEN` is set (no explicit account token), it makes a one-time, cached check against `GET /projects` to see whether that token is actually an account token; if so, account mode activates automatically. A single project-scoped token continues to work exactly as before.

### Tools

`list-projects()`: See which Rollbar projects this server can talk to. If you're using a single project token, this just confirms the one project you've configured. If you're using an account token that can reach multiple projects, this is how you find the project name or id to pass into the other tools' `project` parameter.

`get-item-details(counter, max_tokens?, project?)`: Get the full picture on a single Rollbar item: its details plus its most recent occurrence, so you don't have to look up the item and then separately fetch the latest error. Give it the item's counter (the number you see in the Rollbar UI).

`max_tokens` (default 20000) caps how large the occurrence data in the response can get. Some occurrences carry a lot of detail (long stack traces, request data), so this keeps a single item lookup from ballooning the response. Optional `project` selects which project to use, by configured name or by real project name/id in account-token mode. Example prompt: `Diagnose the root cause of Rollbar item #123456`

`get-deployments(limit, project?)`: List recent deploys for a project, so you can line up when a deploy went out against when errors started or stopped happening. Optional `project` when multiple projects are configured or in account-token mode. Example prompt: `List the last 5 deployments` or `Are there any failed deployments?`

`get-version(version, environment, project?)`: Look up how a specific version (like a git SHA) has performed in an environment, including when it first and last showed up in occurrences. Useful for checking whether a particular release introduced or fixed an issue. Optional `project` when multiple projects are configured or in account-token mode.

`get-top-items(environment, project?)`: See what's actually breaking right now. Returns the items with the most occurrences in the last 24 hours for the given environment, so you can triage what to look at first instead of scanning the full item list. Optional `project` when multiple projects are configured or in account-token mode.

`list-items(status?, level?, environment?, page?, limit?, query?, project?)`: Search and filter Rollbar items instead of pulling the whole list. Filter by `status` (default `active`, so resolved and muted items stay out of your way), `level`, and `environment`, or search by `query` text. Use `page` and `limit` to control how much comes back at once. Optional `project` when multiple projects are configured or in account-token mode.

`get-metrics(table, start_time?, end_time?, granularity?, timezone?, filters?, group_by?, aggregates?, sort?, limit?, offset?, project?)`: Answer "how many, and broken down by what" questions in one or more projects with the Rollbar Metrics API, which requires the account's Advanced package. Other accounts get a 403. `table` chooses what to count:

- `occurrences` (`POST /api/1/metrics/occurrences`): errors and messages. For example, daily error counts per item, which browsers or code versions an error hits, how many distinct users it affected, or which projects log a given message.
- `traces` (`POST /api/1/metrics/traces`, which Rollbar's public API docs don't list yet): session replays and their telemetry, which are stored as OpenTelemetry spans. For example, how many replays were recorded each day, which sessions or users have replays, what triggered them, or how long they ran.

Both tables take the same parameters and return the same result shape.

`start_time` and `end_time` are Unix seconds. Leave out `start_time` to start at the account's data retention boundary, and leave out `end_time` for no upper bound. With `granularity` (`second` through `year`), rows are bucketed into one timepoint per period, in `timezone` (default UTC). Without it, everything comes back in a single timepoint. `filters` must all match. Each filter takes a `field`, an `operator` (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is_null`, `not_null`), `values`, and, for key/value columns like `request_headers`, `customs` or `attributes`, a `key`. `aggregates` take a `field`, a `function` (`count_all`, `count_distinct`, `max`, `min`, `sum`, `topk`, `quantiles`, `array`, `json_array_length`), an `alias`, an optional `key`, and optional string `parameters`. Each alias must be unique and can't reuse a field the row already has: a `group_by` column, the count, or `project_slug`. `sort` is a list of `{ field, order }` in priority order. The default order is timestamp ascending, so sort by `occurrence_count` descending for top-N questions.

`topk` returns the most frequent values first, each as `{ value, count, count_error }`. Its `parameters` are how many values to return (default 10) and an optional load factor (default 3), which trades memory for accuracy. Values come back as strings, and `count_error` is how far `count` may overstate the true count, 0 when it's exact.

A `key` names one entry and is taken literally, dots included, so pass attribute names as they are, such as `"key": "rollbar.replay.id"`. The tool escapes the dots, which the API would otherwise read as the start of a JSON path. To read a value inside an entry that holds JSON, add a `path`: `{ "key": "timings", "path": "execution_duration" }` reads `$.execution_duration` from the `timings` entry. A `path` that starts with `$.` works too.

The result is `{ timepoints: [{ timestamp, rows }], last_timestamp, row_count }`. Each row is a flat object holding its `group_by` columns, aggregate aliases, and its count, `occurrence_count` or `span_count`. Rows also include `project_slug` when grouped by `project_id`. `last_timestamp` is the newest timestamp among the returned rows (with `granularity`, the newest timepoint's), or `null` when nothing matched. The API returns every matching row when no limit is given, so this tool always sends `limit` (default 100, max 1000). When a page is full, the result includes `next_offset` to pass as `offset`. A result over 80,000 characters (about 20,000 tokens) returns an error instead. The error says about how many rows would fit, or, when a single row is over the limit (a large `array` aggregate can do that), that a lower `limit` won't help.

`project` chooses which projects to query; a `project_id` filter is rejected. With an account or user token, omit `project` to query every project the token can read, or pass a name or id, or a list of them, to query only those. Group by `project_id` to see which project each row came from. A broad search across every project, such as a `message_body` `like` filter, can be slow, so narrow the time range for those. A project token only reaches its own project, so with project tokens each call queries one project: name it, or omit `project` when only one is configured. A list of several projects returns an error in that mode, since each token would need its own request and percentiles from separate requests can't be combined. If you configure project tokens alongside an account token, a configured project name works on its own, with its project token. A list is one request on the account token, though, so name each project in a list by its Rollbar name or id.

Daily occurrences per item in production, with the number of people affected:

```json
{ "table": "occurrences", "project": "Backend", "start_time": 1761955200, "granularity": "day", "filters": [{ "field": "environment", "operator": "eq", "values": ["production"] }], "group_by": ["item_counter"], "aggregates": [{ "field": "person_id", "function": "count_distinct", "alias": "people" }], "sort": [{ "field": "occurrence_count", "order": "desc" }], "limit": 20 }
```

Which projects logged a message since `start_time`, across every project the token can read:

```json
{ "table": "occurrences", "start_time": 1761955200, "filters": [{ "field": "message_body", "operator": "like", "values": ["%Successfully deleted%"] }], "group_by": ["project_id", "item_counter"], "sort": [{ "field": "occurrence_count", "order": "desc" }] }
```

The `traces` columns are `project_id`, `environment`, `name`, `kind`, `session_id`, `trace_id`, `span_id`, `start_time`, `duration` (nanoseconds), the key/value columns `attributes` and `events_attributes`, and the event columns `events_name`, `events_time`, `events_attributes_name` and `events_attributes_value`. IDs are hex strings. The time range and `granularity` apply to `start_time`. `parent_id` isn't available: the backend rejects it.

Replay recordings are spans named `rrweb-replay-recording`, and their telemetry spans are named `rollbar-telemetry`. Both carry the replay's ID in the `rollbar.replay.id` attribute and share a `session_id`. Replay spans also carry attributes such as `rollbar.replay.trigger.type`, `rollbar.replay.url.full`, `rollbar.occurrence.uuids`, `user.id`, `user.email`, `user_agent.original` and `client.address`, so results can include personal data.

A few things work differently for `traces`:

- `span_count` can't be a sort field. Add a `count_all` aggregate with an alias and sort on that.
- Rows can't be grouped by an attribute. To count spans per attribute value, use `topk` on the attribute. To see an attribute's values per session, group by `session_id` (or `trace_id`, `span_id`) and use `count_distinct` or `array` on it. `array` repeats a value once per span.
- An aggregate on an event column, other than `array`, counts once per span event. That also inflates `span_count` and every other aggregate in the same query, so query event columns on their own.
- A replay's recording is stored in its span events and can run to several megabytes, well over the size limit. Use `get-replay` to read a replay.

The 10 most recent replays, with the session, environment and replay IDs that `get-replay` takes:

```json
{ "table": "traces", "project": "Frontend", "filters": [{ "field": "name", "operator": "eq", "values": ["rrweb-replay-recording"] }], "group_by": ["session_id", "environment"], "aggregates": [{ "field": "attributes", "key": "rollbar.replay.id", "function": "array", "alias": "replay_ids" }, { "field": "start_time", "function": "min", "alias": "first_start" }], "sort": [{ "field": "first_start", "order": "desc" }], "limit": 10 }
```

Replays and sessions per day:

```json
{ "table": "traces", "project": "Frontend", "start_time": 1761955200, "granularity": "day", "filters": [{ "field": "name", "operator": "eq", "values": ["rrweb-replay-recording"] }], "aggregates": [{ "field": "attributes", "key": "rollbar.replay.id", "function": "count_distinct", "alias": "replays" }, { "field": "session_id", "function": "count_distinct", "alias": "sessions" }] }
```

What triggered replays, with a count for each trigger type:

```json
{ "table": "traces", "project": "Frontend", "filters": [{ "field": "name", "operator": "eq", "values": ["rrweb-replay-recording"] }], "aggregates": [{ "field": "attributes", "key": "rollbar.replay.trigger.type", "function": "topk", "parameters": ["5"], "alias": "triggers" }] }
```

`list-occurrences(counter, limit?, page?, last_id?, max_tokens?, project?)`: Look up the actual occurrences behind a Rollbar item, not just the item summary. Give it the item's counter and it returns the individual instances, each with its own timestamp, environment, and error detail.

Use `limit` to control how many occurrences come back (default 3, max 100), and `page` or `last_id` to move through more of them. `last_id` is cursor-based pagination: pass the `id` of the last occurrence you got back, and you'll get the next batch after it. We added this because plain page numbers can skip or repeat results if occurrences shift around between calls, and `last_id` doesn't have that problem, so use it when you're paging through a lot of occurrences. If you pass both, `last_id` wins. Occurrences within a page are always ordered by timestamp (newest first), so the last one you see is reliably the right one to hand back as `last_id`.

Occurrence data can get big fast, especially for errors with large stack traces or request payloads. `max_tokens` (default 20000, minimum 100) caps roughly how large the whole response can get, in about `max_tokens * 4` characters. We built this because without a cap, a handful of occurrences could blow way past what fits in a conversation. Every occurrence you asked for still shows up in the response, though. Instead of dropping any of them to stay under budget, the tool shrinks the biggest ones down step by step, keeping the most useful fields (level, environment, exception message, and similar) for as long as it can before falling back to just an id and timestamp. A top-level `_truncation` field tells you when this happened. If your `limit` and `max_tokens` genuinely can't fit even a minimal version of every occurrence, you'll get a clear error telling you to lower `limit` or raise `max_tokens`, instead of a silently incomplete page.

Some Rollbar items are actually groups of several items bundled together. Rollbar's public API can't correctly list occurrences for these yet, so calling this tool on a group item returns an explicit `group_item_not_supported` message saying so, instead of quietly showing you an empty list that looks like the item has no occurrences at all.

Optional `project` when multiple projects are configured. Example prompt: `Show me the last 3 occurrences of item #24265`

`list-item-events(item_id?, counter?, type?, page?, limit?, project?)`: Read item history, including system events, oldest first. Provide exactly one of the global `item_id` or the project-local `counter` shown in Rollbar. `page` defaults to 1; `limit` defaults to 20 and accepts 1–5000. The result is `{ events, page, total_count }`, where the count reflects the filters. Empty pages are valid. Pages and event details are returned intact; lower `limit` for smaller responses.

Set `type` to an array of any of these values, or omit it for all available types:

| Type | Additional event fields |
| --- | --- |
| `item_comment` | `text`, `via_api` |
| `item_level_history` | `level` |
| `item_status_history` | `status`, `comment`, and available resolution/deploy details |
| `item_snooze_history` | `snooze_type`, `snooze_status`, expiration thresholds |
| `item_assigned_user_history` | `assigned_user_id` |
| `item_assigned_team_history` | `assigned_team_id` |
| `item_title_history` | `title`, `occurrence_id` |
| `item_group_history` | `action`, `item_counters`, `count` |
| `item_merge_history` | `action`, `group_item_counter` |

All events include `id`, `type`, `item_id`, `user_id`, `username`, and `timestamp`; author fields may be null. Ordering is by timestamp, then type, then ID, ascending. Different event types can have the same ID; identify an event by `(type, id)`. Resolve notes appear in `item_status_history.comment`, so include that type when looking for resolution context. The history endpoint has no cursor, date, text, or author filter. Snooze history is omitted when unavailable for the account; explicitly requesting it then returns a permission error.

Example `list-item-events` arguments:

```json
{ "project": "Backend", "counter": 42, "type": ["item_comment", "item_status_history"], "page": 1, "limit": 20 }
```

`post-item-comment(item_id?, counter?, comment, project?)`: Add a comment using the connected user's identity. Provide exactly one item identifier and nonblank `comment` text. It returns the created comment with `id`, `type: "comment"`, `source: "comment"`, `item_id`, `user_id`, `username`, `timestamp`, `text`, and `via_api: true`. Read it back with `list-item-events` filtered to `item_comment`.

```json
{ "project": "Backend", "counter": 42, "comment": "Investigated the regression; the fix is in PR #123." }
```

The backend caps the full serialized stored comment data at **65,535 bytes**, including author metadata and JSON escaping. This is not a character limit or a text-only byte limit. The MCP sends the text unchanged and reports a backend size error instead of truncating it. It does not retry failed posts: an uncertain result may already have created the comment. Inspect history before retrying.

Both tools preserve backend errors. Common failures are invalid arguments (400/422), authentication (401), scope/project permissions or unavailable snooze history (403), an item outside the selected project or not found (404), and comment size (413). Posting requires JSON (415); the tool supplies that content type. The server rejects posting without configured user credentials before making any HTTP call.

`get-replay(environment, sessionId, replayId, delivery?, project?)`: Fetch a session replay's metadata and payload for a specific session, so you can see what a user actually did leading up to an error.

By default (`delivery="file"`), the replay JSON is written to a temp file on disk and the tool returns the file path. This works everywhere, but the file sticks around until you clean it up yourself. Set `delivery="resource"` instead to get back a `rollbar://` link that MCP-aware clients can read directly, with no file left behind, but this only works when the server only ever talks to a single project (either single-project-token mode, or account-token mode with exactly one project). If you're set up for multiple projects, stick with `delivery="file"` and pass `project` explicitly.

Optional `project` when multiple projects are configured or in account-token mode. Example prompt: `Fetch the replay 789 from session abc in staging`.

`update-item(itemId, status?, level?, title?, assignedUserId?, resolvedInVersion?, snoozed?, teamId?, project?)`: Change an item's status, level, title, assignee, resolved version, snooze state, or owning team, so you can act on an item directly instead of switching to the Rollbar UI.

This needs write access: a project token with `write` scope, or an account/user token with both `read` and `write` scope, subject to the user's permissions. A read-only token will fail here. Optional `project` when multiple projects are configured or in account-token mode. Example prompt: `Mark Rollbar item #123456 as resolved` or `Assign item #123456 to user ID 789`.

## How to Use

### Claude Code

Configure your `.mcp.json` as follows.

Using an environment variable (single project):

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

Optionally include `ROLLBAR_API_BASE` in the `env` block to target a non-production API endpoint.

Using an account access token (every project on the account, no per-project tokens needed):

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_ACCOUNT_ACCESS_TOKEN": "<account access token>"
      }
    }
  }
}
```

Using a config file (single or multiple projects):

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_CONFIG_FILE": "/path/to/.rollbar-mcp.json"
      }
    }
  }
}
```


### Codex CLI

Add to your `~/.codex/config.toml`:

```toml
[mcp_servers.rollbar]
command = "npx"
args = ["-y", "@rollbar/mcp-server@latest"]
env = { "ROLLBAR_ACCESS_TOKEN" = "<project read/write access token>" }
```

Or with a config file:

```toml
[mcp_servers.rollbar]
command = "npx"
args = ["-y", "@rollbar/mcp-server@latest"]
env = { "ROLLBAR_CONFIG_FILE" = "/path/to/.rollbar-mcp.json" }
```


### Junie

Configure your `.junie/mcp/mcp.json` as follows (env var or `ROLLBAR_CONFIG_FILE` for config file):

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```


### Cursor

Configure Cursor’s MCP servers (Cursor Settings → Features → MCP, or search for “MCP” in settings). Use either an environment variable or a config file.

With an environment variable (single project):

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

With a config file (single or multiple projects):

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_CONFIG_FILE": "/path/to/.rollbar-mcp.json"
      }
    }
  }
}
```

Restart Cursor (or reload the window) after changing MCP settings. To use a local build instead of npx, see CONTRIBUTING.md.

### VS Code (including GitHub Copilot)

Configure your `.vscode/mcp.json` as follows (env var or `ROLLBAR_CONFIG_FILE` for config file):

```json
{
  "servers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

Or using a local development installation, see CONTRIBUTING.md.

This is the same file GitHub Copilot's agent mode reads in VS Code. Put it in `.vscode/mcp.json` to share the server with everyone on the repo, or in your user-profile `mcp.json` (**Command Palette → MCP: Open User Configuration**) to keep your token out of the repository. After saving, start the server with **MCP: List Servers → rollbar → Start**, then pick the tools via the 🛠️ icon in the Copilot Chat agent-mode toolbar.

### GitHub Copilot CLI

Add to `~/.copilot/mcp-config.json`. Note that Copilot CLI uses `mcpServers` (not VS Code's `servers`) and spells the stdio transport as `"type": "local"`:

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      },
      "tools": ["*"]
    }
  }
}
```

Or with a config file, swap the `env` block for `ROLLBAR_CONFIG_FILE`:

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@rollbar/mcp-server@latest"],
      "env": {
        "ROLLBAR_CONFIG_FILE": "/path/to/.rollbar-mcp.json"
      },
      "tools": ["*"]
    }
  }
}
```

`tools: ["*"]` enables every Rollbar tool; narrow it to specific tool names if you'd rather opt in explicitly. To scope the server to one repository instead of your whole account, put the same JSON in `.mcp.json` or `.github/mcp.json` at the repo root — Copilot CLI loads project-level config only after you confirm folder trust on first launch, and project definitions take precedence over `~/.copilot/mcp-config.json`.

Run `/mcp` inside an interactive session (or `copilot mcp list` from your shell) to confirm the server is connected.
