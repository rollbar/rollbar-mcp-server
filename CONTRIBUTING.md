# Contributing

Contributions are welcome.

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

Add `ROLLBAR_API_BASE` to the `env` map if you need to point the server at a custom Rollbar API endpoint (for example, `"ROLLBAR_API_BASE": "https://rollbar-dev.example.com/api/1"`).

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

To run the e2e tests, you'll need a read token in the env var ROLLBAR_E2E_READ_TOKEN, which should be a read-scope project access token for a Rollbar project that has items inside, including an item with counter #8.
