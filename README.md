# Rollbar MCP Server

A Machine Consumable Protocol (MCP) server that allows AI coding tools to interact with Rollbar's error tracking capabilities.

## Overview

This server implements the MCP protocol, which is a JSON-RPC 2.0 based protocol designed for AI coding tools to interact with various services. The Rollbar MCP Server provides a standardized interface for AI assistants to access and manipulate Rollbar data, including:

- Projects
- Error items
- Error occurrences
- Deploys

## Features

- **Comprehensive Rollbar Integration**: Access to all major Rollbar features through a standardized MCP interface.
- **Secure Authentication**: JWT-based authentication with configurable token expiration.
- **Flexible Configuration**: Environment-based configuration for easy deployment in different environments.
- **Robust Error Handling**: Proper error handling and reporting throughout the application.
- **Detailed Logging**: Winston-based logging for debugging and monitoring.

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Rollbar account with API tokens

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/rollbar/rollbar-mcp-server.git
   cd rollbar-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your Rollbar API tokens and other configuration.

5. Build the project:
   ```bash
   npm run build
   ```

6. Start the server:
   ```bash
   npm start
   ```

## Development

To run the server in development mode with hot reloading:

```bash
npm run dev
```

## Configuration

The server can be configured using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port to run the server on | `3000` |
| `NODE_ENV` | Environment (development, production, test) | `development` |
| `JWT_SECRET` | Secret key for JWT tokens | (required) |
| `JWT_EXPIRATION` | JWT token expiration time | `1h` |
| `ROLLBAR_ACCESS_TOKEN` | Rollbar API access token | (required) |
| `ROLLBAR_ACCOUNT_READ_TOKEN` | Rollbar account read token | (required) |
| `ROLLBAR_ACCOUNT_WRITE_TOKEN` | Rollbar account write token | (required) |
| `LOG_LEVEL` | Logging level | `info` |

## API Endpoints

### MCP Endpoint

The MCP protocol is exposed through a single endpoint:

```
POST /mcp
```

All MCP requests should be sent to this endpoint as JSON-RPC 2.0 requests.

### Health Check

```
GET /health
```

Returns a simple status check to verify the server is running.

## MCP Protocol

The MCP protocol is based on JSON-RPC 2.0 and supports the following methods:

### initialize

Initializes the connection and returns server capabilities.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "authentication": {
      "token": "optional-jwt-token"
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "serverInfo": {
      "name": "Rollbar MCP Server",
      "version": "0.1.0"
    },
    "capabilities": {
      "resources": ["projects", "items", "occurrences", "deploys"],
      "tools": ["resolveItem", "createItem", "trackDeploy", "searchItems"]
    },
    "authentication": {
      "token": "jwt-token"
    }
  }
}
```

### getResource

Retrieves resources from Rollbar.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "getResource",
  "params": {
    "resourceType": "projects",
    "resourceId": "optional-id",
    "options": {
      "key": "value"
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": [
    {
      "id": 123,
      "name": "My Project",
      "account_id": 456,
      "status": "enabled",
      "date_created": 1609459200,
      "date_modified": 1609459200
    }
  ]
}
```

### executeTool

Executes a tool to perform an action in Rollbar.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "executeTool",
  "params": {
    "toolName": "resolveItem",
    "params": {
      "itemId": 123
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "success": true,
    "itemId": 123
  }
}
```

## Available Resources

### projects

Represents Rollbar projects.

**Options:**
- None

### items

Represents error items in Rollbar.

**Options:**
- `projectId` (required): ID of the project
- `status`: Filter by status (active, resolved, muted, archived)
- `level`: Filter by level (debug, info, warning, error, critical)
- `environment`: Filter by environment
- `query`: Search query
- `limit`: Maximum number of items to return
- `offset`: Offset for pagination

### occurrences

Represents individual occurrences of error items.

**Options:**
- `itemId` (required): ID of the item
- `limit`: Maximum number of occurrences to return
- `offset`: Offset for pagination

### deploys

Represents deploys tracked in Rollbar.

**Options:**
- `projectId` (required): ID of the project
- `environment`: Filter by environment
- `limit`: Maximum number of deploys to return
- `offset`: Offset for pagination

## Available Tools

### resolveItem

Resolves an error item in Rollbar.

**Parameters:**
- `itemId` (required): ID of the item to resolve

### createItem

Creates a new error item in Rollbar.

**Parameters:**
- `environment` (required): Environment name
- `level` (required): Error level (debug, info, warning, error, critical)
- `title` (required): Error title
- `message` (required): Error message
- `framework`: Framework name
- `codeVersion`: Code version
- `person`: Person information (id, username, email)
- `custom`: Custom data

### trackDeploy

Tracks a new deploy in Rollbar.

**Parameters:**
- `environment` (required): Environment name
- `revision` (required): Revision identifier (e.g., Git SHA)
- `projectId` (required): ID of the project
- `username`: Username of the person who deployed
- `comment`: Deploy comment

### searchItems

Searches for items using RQL (Rollbar Query Language).

**Parameters:**
- `projectId` (required): ID of the project
- `query` (required): RQL query string
- `limit`: Maximum number of items to return
- `offset`: Offset for pagination

## License

MIT
