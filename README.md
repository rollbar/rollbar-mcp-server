# Rollbar MCP Server

A Model Context Protocol (MCP) server for Rollbar, enabling the use of Rollbar with AI coding tools like Claude Code and Cursor.

## Overview

This project implements an MCP server that provides access to Rollbar's error tracking data and functionality through the Model Context Protocol. It allows AI coding assistants to:

- List and search for errors in your Rollbar projects
- View detailed error information and stack traces
- Update error statuses (resolve, mute, reactivate)
- Access project information

## Prerequisites

- Node.js 18 or higher
- A Rollbar account with API access
- A Rollbar API access token with appropriate permissions

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/rollbar/rollbar-mcp-server.git
   cd rollbar-mcp-server
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your Rollbar API token:
   ```
   ROLLBAR_ACCESS_TOKEN=your_rollbar_access_token
   ROLLBAR_API_BASE_URL=https://api.rollbar.com/api/1
   PORT=3000
   ```

4. Build the project:
   ```
   npm run build
   ```

## Usage

### Running the Server

You can run the server in two modes:

1. **stdio mode** (default, for use with Claude Desktop and other MCP clients):
   ```
   npm start
   ```

2. **HTTP mode** (for development and testing):
   ```
   npm start http
   ```

### Configuring with Claude Desktop

To use this server with Claude Desktop:

1. Open your Claude Desktop App configuration at `~/Library/Application Support/Claude/claude_desktop_config.json` (create it if it doesn't exist)

2. Add the Rollbar MCP server configuration:

```json
{
  "mcpServers": {
    "rollbar": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/rollbar-mcp-server/dist/index.js"
      ]
    }
  }
}
```

3. Restart Claude Desktop

### Configuring with Cursor

To use this server with Cursor:

1. Open Cursor settings
2. Navigate to the MCP section
3. Add a new MCP server with:
   - Name: Rollbar
   - Command: `node /ABSOLUTE/PATH/TO/rollbar-mcp-server/dist/index.js`

## Available Tools

The server provides the following MCP tools:

- `list-projects`: List all Rollbar projects
- `get-project`: Get details for a specific project
- `list-items`: List errors/items for a project
- `get-item`: Get details for a specific error/item
- `get-item-occurrences`: Get occurrences of a specific error
- `get-occurrence`: Get details for a specific error occurrence
- `update-item-status`: Update the status of an error (resolve, mute, etc.)
- `search-items`: Search for errors by title or other criteria

## Development

To run the server in development mode with automatic recompilation:

```
npm run dev
```

In another terminal, you can run the server:

```
node dist/index.js
```

## License

MIT
