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

- Read-only tools (`get-item-details`, `get-deployments`, `get-version`, `get-top-items`, `list-items`, `get-replay`, `list-projects`, `list-occurrences`, `list-item-events`) work with a **read**-scope account or user token, subject to project permissions.
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
