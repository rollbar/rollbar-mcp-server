import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRollbarMcpServer } from './mcp/server.js';
import { config } from './config.js';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import cors from 'cors';
import express from 'express';

async function main() {
  // Create the Rollbar MCP server
  const server = createRollbarMcpServer();

  // Determine which transport to use based on command line arguments
  const args = process.argv.slice(2);
  const transportType = args[0] || 'stdio';

  if (transportType === 'http') {
    // Create Express app
    const app = express();
    
    // Enable CORS for all routes
    app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }));
    
    // Create HTTP server
    const httpServer = createServer(app);
    
    // Start the server with HTTP transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      path: '/',
      expressApp: app
    });

    // Start HTTP server
    httpServer.listen(config.port, () => {
      console.log(`Starting Rollbar MCP server with HTTP transport on port ${config.port}...`);
    });

    await server.connect(transport);
    console.log(`Rollbar MCP server is running on http://localhost:${config.port}`);
  } else {
    // Start the server with stdio transport (default)
    const transport = new StdioServerTransport();
    
    console.log('Starting Rollbar MCP server with stdio transport...');
    await server.connect(transport);
    console.log('Rollbar MCP server is running with stdio transport');
  }
}

main().catch(error => {
  console.error('Error starting Rollbar MCP server:', error);
  process.exit(1);
});
