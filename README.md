# rollbar-mcp-server

A Model Context Protocol (MCP) server for [Rollbar](https://rollbar.com).

> [!NOTE]
> This software is alpha quality and under active development.

## Features

This MCP server implementes the `stdio` server type, which means your AI tool (e.g. Claude) will run it directly; you don't run a separate process or connect over http.

### Configuration

`ROLLBAR_ACCESS_TOKEN`: an access token for your Rollbar project with `read` and/or `write` scope.

### Tools

`get-item-details(counter, max_tokens?)`: Given an item number, fetch the item details and last occurrence details. Supports an optional `max_tokens` parameter (default: 20000) to automatically truncate large occurrence responses. Example prompt: `Diagnose the root cause of Rollbar item #123456`

`get-deployments(limit)`: List deploy data for the given project. Example prompt: `List the last 5 deployments` or `Are there any failed deployments?`

`get-version(version, environment)`: Fetch version details for the given version string, environment name, and the configured project.

`get-top-items(environment)`: Fetch the top items in the last 24 hours given the environment name, and the configured project.

`list-items(environment)`: List items filtered by status, environment and a search query.

`get-replay(environment, sessionId, replayId)`: Retrieve session replay metadata and payload for a specific session in the configured project. The tool now returns a `rollbar://replay/<environment>/<sessionId>/<replayId>` resource link so clients can `read-resource` to download the full JSON payload without embedding large responses inline. Example prompt: `Fetch the replay 789 from session abc in staging` or `Download the replay data for session 456.`

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
