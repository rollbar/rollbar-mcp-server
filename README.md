# rollbar-mcp-server

A Model Context Protocol (MCP) server for [Rollbar](https://rollbar.com).

> [!NOTE]
> This software is alpha quality and under active development.

## Features

This MCP server implementes the `stdio` server type, which means your AI tool (e.g. Claude) will run it directly; you don't run a separate process or connect over http.

### Configuration

- `ROLLBAR_ACCESS_TOKEN`: an access token for your Rollbar project with `read` and/or `write` scope.
- `ROLLBAR_API_BASE` (optional): override the Rollbar API base URL (defaults to `https://api.rollbar.com/api/1`). Use this when running against a staging or development Rollbar deployment.

### Tools

`get-item-details(counter, max_tokens?)`: Given an item number, fetch the item details and last occurrence details. Supports an optional `max_tokens` parameter (default: 20000) to automatically truncate large occurrence responses. Example prompt: `Diagnose the root cause of Rollbar item #123456`

`get-deployments(limit)`: List deploy data for the given project. Example prompt: `List the last 5 deployments` or `Are there any failed deployments?`

`get-version(version, environment)`: Fetch version details for the given version string, environment name, and the configured project.

`get-top-items(environment)`: Fetch the top items in the last 24 hours given the environment name, and the configured project.

`list-items(environment)`: List items filtered by status, environment and a search query.

`get-replay(environment, sessionId, replayId, delivery?)`: Retrieve session replay metadata and payload for a specific session in the configured project. By default the tool writes the replay JSON to a temporary file (under your system temp directory) and returns the path so any client can inspect it. Set `delivery="resource"` to receive a `rollbar://replay/<environment>/<sessionId>/<replayId>` link for MCP-aware clients. Example prompt: `Fetch the replay 789 from session abc in staging`.

`update-item(itemId, status?, level?, title?, assignedUserId?, resolvedInVersion?, snoozed?, teamId?)`: Update an item's properties including status, level, title, assignment, and more. Example prompt: `Mark Rollbar item #123456 as resolved` or `Assign item #123456 to user ID 789`. (Requires `write` scope)

## How to Use

Tested with node 20 and 22 (`nvm use 22`).

### Claude Code

Configure your `.mcp.json` as follows:

```
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@rollbar/mcp-server@latest"
      ],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

Optionally include `ROLLBAR_API_BASE` in the `env` block to target a non-production API endpoint, for example `"ROLLBAR_API_BASE": "https://rollbar-dev.example.com/api/1"`.


### Codex CLI

Add to your `~/.codex/config.toml`:

```
[mcp_servers.rollbar]
command = "npx"
args = ["-y", "@rollbar/mcp-server@latest"]
env = { "ROLLBAR_ACCESS_TOKEN" = "<project read/write acecss token>" }
```


### Junie

Configure your `.junie/mcp/mcp.json` as follows:

```
{
    "mcpServers": {
        "rollbar": {
            "type": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@rollbar/mcp-server@latest"
            ],
            "env": {
                "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
            }
        }
    }
}
```


### VS Code

Configure your `.vscode/mcp.json` as follows:

```
{
  "servers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@rollbar/mcp-server@latest"
      ],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

Or using a local development installation - see CONTRIBUTING.md.
