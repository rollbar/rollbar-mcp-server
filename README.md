# rollbar-mcp-server

A Model Context Protocol (MCP) server for [Rollbar](https://rollbar.com).

## Features

This MCP server supports two transport modes:

- **HTTP/SSE mode**: Run as a standalone HTTP server with Server-Sent Events for remote access or web-based clients
- **stdio mode** (legacy): Your AI tool (e.g. Claude, Cursor) runs it directly as a subprocess

Most users should use stdio mode for local development. HTTP mode is useful for:
- Remote server deployments
- Web-based MCP clients
- Shared team access to a single Rollbar MCP instance

### Configuration

**Multiple Projects: AWS Secrets Manager (recommended for production)**

Set `ROLLBAR_AWS_SECRET_NAME` to the name of your AWS Secrets Manager secret. The secret should contain a JSON object with project names as keys and tokens as values:

```json
{
  "backend": "tok_abc123",
  "frontend": "tok_xyz789",
  "mobile": "tok_def456"
}
```

Environment variables:
- `ROLLBAR_AWS_SECRET_NAME`: Name of the AWS Secrets Manager secret (e.g., `prod/rollbar-mcp/project-tokens`)
- `AWS_REGION`: AWS region for Secrets Manager (defaults to `us-east-1`)
- `ROLLBAR_API_BASE` (optional): override the API base URL (defaults to `https://api.rollbar.com/api/1`)

AWS credentials are sourced from the standard AWS SDK credential chain (environment variables, IAM roles, AWS profiles, etc.).

**Single Project: Environment variable (single project, backward compatible)**

- `ROLLBAR_ACCESS_TOKEN`: access token for your Rollbar project.
- `ROLLBAR_API_BASE` (optional): override the API base URL (defaults to `https://api.rollbar.com/api/1`).

**Multiple Project: Config file (single or multiple projects)**

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

**Configuration lookup order:**

1. `ROLLBAR_AWS_SECRET_NAME` env var (AWS Secrets Manager)
2. `ROLLBAR_CONFIG_FILE` env var
3. `.rollbar-mcp.json` in current working directory
4. `~/.rollbar-mcp.json` in home directory
5. `ROLLBAR_ACCESS_TOKEN` env var (single project, backward compatible)

If a config source exists but is invalid, the server exits with an error instead of falling back to a lower-priority config source.

### Tools

`list-projects()`: List configured Rollbar projects (names and apiBase only; tokens are never returned). Use this when multiple projects are configured to see which project names you can pass to other tools.

`get-item-details(counter, max_tokens?, project?)`: Given an item number, fetch the item details and last occurrence details. Supports an optional `max_tokens` parameter (default: 20000) to automatically truncate large occurrence responses. Optional `project` selects which configured project to use when multiple are defined. Example prompt: `Diagnose the root cause of Rollbar item #123456`

`get-deployments(limit, project?)`: List deploy data for the given project. Optional `project` when multiple projects are configured. Example prompt: `List the last 5 deployments` or `Are there any failed deployments?`

`get-version(version, environment, project?)`: Fetch version details for the given version string and environment. Optional `project` when multiple projects are configured.

`get-top-items(environment, project?)`: Fetch the top items in the last 24 hours for the given environment. Optional `project` when multiple projects are configured.

`list-items(status?, level?, environment?, page?, limit?, query?, project?)`: List items filtered by status, environment, and search query. Optional `project` when multiple projects are configured.

`get-replay(environment, sessionId, replayId, delivery?, project?)`: Retrieve session replay metadata and payload for a specific session. By default the tool writes the replay JSON to a temporary file (under your system temp directory) and returns the path. Set `delivery="resource"` to receive a `rollbar://replay/<environment>/<sessionId>/<replayId>` link for MCP-aware clients. Optional `project` when multiple projects are configured. `delivery="resource"` is only supported in single-project mode; when multiple projects are configured, use `delivery="file"` with a `project` parameter instead. Example prompt: `Fetch the replay 789 from session abc in staging`.

`update-item(itemId, status?, level?, title?, assignedUserId?, resolvedInVersion?, snoozed?, teamId?, project?)`: Update an item's properties including status, level, title, assignment, and more. Optional `project` when multiple projects are configured. Example prompt: `Mark Rollbar item #123456 as resolved` or `Assign item #123456 to user ID 789`. (Requires `write` scope)

## How to Use

Tested with node 20 and 22 (`nvm use 22`).

### HTTP Server Mode

Run as a standalone HTTP server:

```bash
# Using AWS Secrets Manager (multiple projects, recommended for production)
PORT=3000 ROLLBAR_AWS_SECRET_NAME=prod/rollbar-mcp/project-tokens AWS_REGION=us-east-1 node build/index.js

# Using environment variable (single project)
PORT=3000 ROLLBAR_ACCESS_TOKEN=your_token node build/index.js

# Using config file (single or multiple projects)
PORT=3000 ROLLBAR_CONFIG_FILE=/path/to/.rollbar-mcp.json node build/index.js
```

The server provides these endpoints:
- `http://localhost:3000/sse` - MCP protocol over Server-Sent Events
- `http://localhost:3000/health` - Health check endpoint (returns `{"status":"ok"}`)

Environment variables:
- `PORT` - HTTP server port (default: 3000)
- `ROLLBAR_AWS_SECRET_NAME` - AWS Secrets Manager secret name (multiple projects mode)
- `AWS_REGION` - AWS region for Secrets Manager (defaults to `us-east-1`)
- `ROLLBAR_ACCESS_TOKEN` - Your Rollbar project token (single project mode)
- `ROLLBAR_CONFIG_FILE` - Path to config file (single or multiple projects)
- `ROLLBAR_API_BASE` - Override API base URL (optional)

The HTTP server supports CORS for cross-origin requests and can be accessed by web-based MCP clients or deployed as a shared service.

**For Fetch Rewards deployments**: See [DEPLOYMENT.md](DEPLOYMENT.md) for instructions on deploying to production via FSD (Fetch Service Deployer).

### stdio Mode (Local Development)

The following configurations use stdio mode where the MCP server runs as a subprocess of your AI tool.

#### Claude Code

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


#### Codex CLI

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


#### Junie

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


#### Cursor

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

#### VS Code

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
