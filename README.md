# rollbar-mcp-server

A Model Context Protocol (MCP) server for [Rollbar](https://rollbar.com).

## Features

This MCP server implements the `stdio` server type, which means your AI tool (e.g. Claude, Cursor) will run it directly; you don't run a separate process or connect over http.

### Configuration

**Single Project: Environment variable (single project, backward compatible)**

- `ROLLBAR_ACCESS_TOKEN`: access token for your Rollbar project.
- `ROLLBAR_API_BASE` (optional): override the API base URL (defaults to `https://api.rollbar.com/api/1`).

**Multiple Project: Config file (single or multiple projects)**

Create `.rollbar-mcp.json` in your working directory or home directory, or set `ROLLBAR_CONFIG_FILE` to point to a custom path.

Single project shorthand:

```json
{ "token": "tok_abc123" }
```

Multiple projects:

```json
{
  "projects": [
    { "name": "backend",  "token": "tok_abc123" },
    { "name": "frontend", "token": "tok_xyz789" },
    { "name": "staging",  "token": "tok_stg456", "apiBase": "https://rollbar-staging.example.com/api/1" }
  ]
}
```

Config file lookup order:

1. `ROLLBAR_CONFIG_FILE` env var
2. `.rollbar-mcp.json` in current working directory
3. `~/.rollbar-mcp.json` in home directory
4. `ROLLBAR_ACCESS_TOKEN` env var (single project, backward compatible)

### Tools

`list-projects()`: List configured Rollbar projects (names and apiBase only; tokens are never returned). Use this when multiple projects are configured to see which project names you can pass to other tools.

`get-item-details(counter, max_tokens?, project?)`: Given an item number, fetch the item details and last occurrence details. Supports an optional `max_tokens` parameter (default: 20000) to automatically truncate large occurrence responses. Optional `project` selects which configured project to use when multiple are defined. Example prompt: `Diagnose the root cause of Rollbar item #123456`

`get-deployments(limit, project?)`: List deploy data for the given project. Optional `project` when multiple projects are configured. Example prompt: `List the last 5 deployments` or `Are there any failed deployments?`

`get-version(version, environment, project?)`: Fetch version details for the given version string and environment. Optional `project` when multiple projects are configured.

`get-top-items(environment, project?)`: Fetch the top items in the last 24 hours for the given environment. Optional `project` when multiple projects are configured.

`list-items(status?, level?, environment?, page?, limit?, query?, project?)`: List items filtered by status, environment, and search query. Optional `project` when multiple projects are configured.

`get-replay(environment, sessionId, replayId, delivery?, project?)`: Retrieve session replay metadata and payload for a specific session. By default the tool writes the replay JSON to a temporary file (under your system temp directory) and returns the path. Set `delivery="resource"` to receive a `rollbar://replay/<environment>/<sessionId>/<replayId>` link for MCP-aware clients. Optional `project` when multiple projects are configured. When multiple projects are configured, direct `rollbar://replay/...` resource reads are not supported—use this tool with a `project` parameter instead. Example prompt: `Fetch the replay 789 from session abc in staging`.

`update-item(itemId, status?, level?, title?, assignedUserId?, resolvedInVersion?, snoozed?, teamId?, project?)`: Update an item's properties including status, level, title, assignment, and more. Optional `project` when multiple projects are configured. Example prompt: `Mark Rollbar item #123456 as resolved` or `Assign item #123456 to user ID 789`. (Requires `write` scope)

## How to Use

Tested with node 20 and 22 (`nvm use 22`).

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

Or using a local development installation—see CONTRIBUTING.md.
