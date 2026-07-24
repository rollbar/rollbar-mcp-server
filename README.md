# rollbar-mcp-server

A Model Context Protocol (MCP) server for [Rollbar](https://rollbar.com).

## Features

This MCP server implements the `stdio` server type, which means your AI tool (e.g. Claude, Cursor) will run it directly; you don't run a separate process or connect over http.

## Configuration

### Account access token

Configure a single Rollbar Account Access Token and let every tool work across all projects in that account:

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
4. `ROLLBAR_ACCESS_TOKEN` or `ROLLBAR_ACCOUNT_ACCESS_TOKEN` env var (single project or account-wide, backward compatible)

If a config file exists but is invalid, the server exits with an error instead of falling back to a lower-priority config source.

Required scopes:

- Read-only tools (`get-item-details`, `get-deployments`, `get-version`, `get-top-items`, `list-items`, `get-replay`, `list-projects`) work with a **read**-scope account token.
- `update-item` requires an account token with **both read and write** scope: every account-token call resolves the target project via `GET /projects` first (read), then makes the `PATCH` request (write). A write-only token will fail at the project-resolution step before ever reaching the update.
- As with project tokens, prefer a read-scope token unless you specifically need `update-item`.

If the server detects only `ROLLBAR_ACCESS_TOKEN` is set (no explicit account token), it makes a one-time, cached check against `GET /projects` to see whether that token is actually an account token; if so, account mode activates automatically. A single project-scoped token continues to work exactly as before.

### Tools

`list-projects()`: List available Rollbar projects. In project-token mode, lists the locally configured projects (names and apiBase only; tokens are never returned). In account-token mode, lists the real projects on the account (id, name, status) fetched live from Rollbar.

`get-item-details(counter, max_tokens?, project?)`: Given an item number, fetch the item details and last occurrence details. Supports an optional `max_tokens` parameter (default: 20000) to automatically truncate large occurrence responses. Optional `project` selects which project to use (by configured name, or by real project name/id in account-token mode). Example prompt: `Diagnose the root cause of Rollbar item #123456`

`get-deployments(limit, project?)`: List deploy data for the given project. Optional `project` when multiple projects are configured or in account-token mode. Example prompt: `List the last 5 deployments` or `Are there any failed deployments?`

`get-version(version, environment, project?)`: Fetch version details for the given version string and environment. Optional `project` when multiple projects are configured or in account-token mode.

`get-top-items(environment, project?)`: Fetch the top items in the last 24 hours for the given environment. Optional `project` when multiple projects are configured or in account-token mode.

`list-items(status?, level?, environment?, page?, limit?, query?, project?)`: List items filtered by status, environment, and search query. Optional `project` when multiple projects are configured or in account-token mode.

`get-replay(environment, sessionId, replayId, delivery?, project?)`: Retrieve session replay metadata and payload for a specific session. By default the tool writes the replay JSON to a temporary file (under your system temp directory) and returns the path. Set `delivery="resource"` to receive a `rollbar://replay/<environment>/<sessionId>/<replayId>` link for MCP-aware clients. Optional `project` when multiple projects are configured or in account-token mode. `delivery="resource"` is only supported when the server addresses a single project (single-project-token mode, or account-token mode with exactly one project); otherwise use `delivery="file"` with a `project` parameter instead. Example prompt: `Fetch the replay 789 from session abc in staging`.

`update-item(itemId, status?, level?, title?, assignedUserId?, resolvedInVersion?, snoozed?, teamId?, project?)`: Update an item's properties including status, level, title, assignment, and more. Optional `project` when multiple projects are configured or in account-token mode. Example prompt: `Mark Rollbar item #123456 as resolved` or `Assign item #123456 to user ID 789`. Requires a project token with `write` scope, or an account token with both `read` and `write` scope.

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

### VS Code

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
