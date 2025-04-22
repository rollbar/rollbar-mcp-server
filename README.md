# rollbar-mcp-server

A Model Context Protocl (MCP) server for [Rollbar](https://rollbar.com).

> [!NOTE]
> This software is pre-release, alpha quality, and under active development.

## Features

This MCP server implementes the `stdio` server type, which means your AI tool (e.g. Claude) will run it directly; you don't run a separate process.

### Configuration

`ROLLBAR_ACCESS_TOKEN`: a `read`-scope access token for your Rollbar project.

### Tools

`get-item-details(counter)`: Given an item number, fetch the item details and last occurrence details. Example prompt: `Diagnose the root cause of Rollbar item #123456`

`get-deployments(limit)`: List deploy data for the given project. Example prompt: `List the last 5 deployments` or `Are there any failed deployments?`

`get-version(version, environment)`: List version (sha) data for the given environment and project.

## How to Use

Tested with node 22 (`nvm use 22`).

Install and build:

```
npm install
npm run build
```

### Claude Code

Configure your `.mcp.json` as follows:

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
        "ROLLBAR_ACCESS_TOKEN": "<project read access token>"
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
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/rollbar-mcp-server/build/index.js"
      ],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read access token>"
      }
    }
  }
}
```

## How to Develop

Install and build:

```
npm install
npm run build
```

You can test an individual tool using the `@modelcontextprotocol/inspector` module. For example, test the tool `get-item-details` with arg `counter=2455389`:

```
npx @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=$TOKEN node build/index.js --method tools/call --tool-name get-item-details --tool-arg counter=2455389 --debug
```

