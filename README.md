# rollbar-mcp-server

A Model Context Protocl (MCP) server for [Rollbar](https://rollbar.com).

> [!NOTE]
> This software is alpha quality and under active development.

## Features

This MCP server implementes the `stdio` server type, which means your AI tool (e.g. Claude) will run it directly; you don't run a separate process or connect over http.

### Configuration

`ROLLBAR_ACCESS_TOKEN`: an access token for your Rollbar project with `read` and/or `write` scope.

### Tools

`get-item-details(counter)`: Given an item number, fetch the item details and last occurrence details. Example prompt: `Diagnose the root cause of Rollbar item #123456`

`get-deployments(limit)`: List deploy data for the given project. Example prompt: `List the last 5 deployments` or `Are there any failed deployments?`

`get-version(version, environment)`: Fetch version details for the given version string, environment name, and the configured project.

`get-top-items(environment)`: Fetch the top items in the last 24 hours given the environment name, and the configured project.

`list-items(environment)`: List items filtered by status, environment and a search query.

`update-item(itemId, status?, level?, title?, assignedUserId?, resolvedInVersion?, snoozed?, teamId?)`: Update an item's properties including status, level, title, assignment, and more. Example prompt: `Mark Rollbar item #123456 as resolved` or `Assign item #123456 to user ID 789`. (Requires `write` scope)

## How to Use

Tested with node 18, 20, and 22 (`nvm use 22`).

Install and build:

```
npm install
npm run build
```

### Claude Code

Configure your `.mcp.json` as follows:

Using npx (recommended):

```
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@rollbar/mcp-server"
      ],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

Or using a local installation:


### VS Code

Configure your `.vscode/mcp.json` as follows:

Using npx (recommended):

```
{
  "servers": {
    "rollbar": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@rollbar/mcp-server"
      ],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

Or using a local installation:


## How to Develop

Install and build:

```
npm install
npm run build
```

Run your local installation from Claude Code:

```
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/rollbar-mcp-server/build/index.js"
      ],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

Run your local installation from VSCode:

```
{
  "servers": {
    "rollbar": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/rollbar-mcp-server/build/index.js"
      ],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

You can test an individual tool using the `@modelcontextprotocol/inspector` module. For example, test the tool `get-item-details` with arg `counter=2455389`:

```
npx @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=$TOKEN node build/index.js --method tools/call --tool-name get-item-details --tool-arg counter=2455389 --debug
```

