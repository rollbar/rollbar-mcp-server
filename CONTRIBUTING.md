# Contributing

Contributions are welcome.

## How to Develop

Install and build:

```bash
npm install
npm run build
```

You can run the server directly to confirm it starts (it will wait for stdin; Ctrl+C to stop):

```bash
node build/index.js
```

For local development, configure Rollbar either with an environment variable or a config file. Create `.rollbar-mcp.json` in the project root (or set `ROLLBAR_CONFIG_FILE` to its path) for single- or multi-project config—see the README Configuration section.

### Run your local installation from Claude Code

In your Claude Code MCP config (e.g. `.mcp.json`):

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/rollbar-mcp-server/build/index.js"],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

To use a config file instead, set `"ROLLBAR_CONFIG_FILE": "/path/to/.rollbar-mcp.json"` in `env` (or omit it if `.rollbar-mcp.json` is in the project root or your home directory). Add `ROLLBAR_API_BASE` to `env` if you need a custom Rollbar API endpoint (e.g. `"ROLLBAR_API_BASE": "https://rollbar-dev.example.com/api/1"`).

### Run your local installation from your IDE

1. Open **Cursor Settings** (Cmd+, or File → Preferences).
2. Go to **Cursor Settings → Features → MCP** (or search for “MCP”).
3. Edit the MCP config and add a server that runs your local build:

```json
{
  "mcpServers": {
    "rollbar": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/rollbar-mcp-server/build/index.js"],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/rollbar-mcp-server` with the real path to your clone. To use a config file instead, set `"ROLLBAR_CONFIG_FILE": "/path/to/.rollbar-mcp.json"` in `env`. Save and restart Cursor (or reload the window) so the new server is picked up. In a new Agent/Composer chat, the Rollbar tools (e.g. `list-projects`, `get-item-details`) will be available.

### Run your local installation from VS Code

In your `.vscode/mcp.json`:

```json
{
  "servers": {
    "rollbar": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/rollbar-mcp-server/build/index.js"],
      "env": {
        "ROLLBAR_ACCESS_TOKEN": "<project read/write access token>"
      }
    }
  }
}
```

You can use `ROLLBAR_CONFIG_FILE` in `env` instead of `ROLLBAR_ACCESS_TOKEN` for config-file-based setup.

## Testing

Test an individual tool with the MCP inspector. List tools:

```bash
npx @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=$TOKEN node build/index.js --method tools/list --debug
```

Call a tool (e.g. `list-projects` or `get-item-details`):

```bash
npx @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=$TOKEN node build/index.js --method tools/call --tool-name list-projects --debug
npx @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=$TOKEN node build/index.js --method tools/call --tool-name get-item-details --tool-arg counter=2455389 --debug
```

Replace `$TOKEN` with your Rollbar access token (or use a config file and set `ROLLBAR_CONFIG_FILE` in the env).

The full e2e suite (`npm run test:e2e`) runs two scripts: the npx-install test (no token needed) and the get-item-details test. If `ROLLBAR_E2E_READ_TOKEN` is not set, the get-item-details test is skipped and the suite still passes. To run that test, set `ROLLBAR_E2E_READ_TOKEN` to a read-scope project access token for a Rollbar project that has items, including an item with counter #8.
