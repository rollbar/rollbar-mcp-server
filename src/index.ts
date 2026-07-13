#!/usr/bin/env node

import "./load-env.js";
import "./utils/proxy.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Create server instance
const server = new McpServer(
  {
    name: "rollbar",
    version: "0.0.1",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

// Register all tools
registerAllResources(server);
registerAllTools(server);

async function handleSSEConnection(req: IncomingMessage, res: ServerResponse) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Create SSE transport
  const transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);

  // Handle connection close
  req.on("close", () => {
    console.error("Client disconnected");
  });
}

async function main() {
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/sse") {
      await handleSSEConnection(req, res);
    } else if (url.pathname === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  httpServer.listen(PORT, () => {
    console.error(`Rollbar MCP Server running on http://localhost:${PORT}`);
    console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
  });
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
