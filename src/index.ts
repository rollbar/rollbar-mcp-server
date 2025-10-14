#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";

// Create server instance
const server = new McpServer({
  name: "rollbar",
  version: "0.0.1",
  capabilities: {
    resources: {},
    tools: {
      "get-item-details": {
        description:
          "Get detailed information about a Rollbar item by its counter",
      },
      "get-deployments": {
        description:
          "Get deployment status and information for a Rollbar project",
      },
      "get-version": {
        description: "Get version data and information for a Rollbar project",
      },
      "get-top-items": {
        description: "Get list of top items in the Rollbar project",
      },
      "list-items": {
        description:
          "List all items in the Rollbar project with optional search and filtering",
      },
      "get-replay": {
        description: "Get replay data for a specific session replay in Rollbar",
      },
    },
  },
});

// Register all tools
registerAllTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rollbar MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
