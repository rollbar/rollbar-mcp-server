# rollbar-mcp-server

An initial Model Context Protocl (MCP) server for Rollbar. This implementation is designed for the `stdio` mode, which means your AI tool (e.g. Claude) will run it directly; you don't run a separate process.

## Usage

Tested with node 22 (`nvm use 22`).

Install and build:

```
npm install
npm run build
```

Configure your `.mcp.json` as follows:

```
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "/node",
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


## Development

Install and build:

```
npm install
npm run build
```

You can test an individual tool using the `@modelcontextprotocol/inspector` module. For example, test the tool `get-item-details` with arg `counter=2455389`:

```
npx @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=$TOKEN node build/index.js --method tools/call --tool-name get-item-details --tool-arg counter=2455389 --debug
```

