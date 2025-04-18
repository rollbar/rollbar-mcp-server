import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRollbarMcpServer } from './mcp/server.js';
import { config } from './config.js';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import cors from 'cors';
import express from 'express';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';

async function main() {
  // Create the Rollbar MCP server
  const server = createRollbarMcpServer();

  // Determine which transport to use based on command line arguments
  const args = process.argv.slice(2);
  const transportType = args[0] || 'stdio';

  if (transportType === 'http') {
    // Create Express app
    const app = express();
    
    // Enable CORS for all routes with specific headers needed for SSE
    app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Accept', 'Last-Event-ID'],
      exposedHeaders: ['Mcp-Session-Id', 'Content-Type'],
      credentials: true
    }));
    
    // Parse JSON bodies
    app.use(express.json());
    
    // Create HTTP server
    const httpServer = createServer(app);
    
    // Create a single event store for all sessions to enable resumability
    const eventStore = new InMemoryEventStore();

    // Create a single transport for the HTTP server
    const transport = new StreamableHTTPServerTransport({
      eventStore,
      sessionIdGenerator: () => randomUUID(),
    });

    // Connect the transport to the server
    await server.connect(transport);

    // Handle all MCP requests (GET, POST, DELETE)
    app.all('/mcp', async (req, res) => {
      try {
        // Let the transport handle the request
        await transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          if (req.method === 'POST') {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal server error',
              },
              id: req.body?.id || null,
            });
          } else {
            res.status(500).send('Internal server error');
          }
        }
      }
    });

    // Handle preflight OPTIONS requests
    app.options('/mcp', (req, res) => {
      res.status(200).end();
    });

    // Start HTTP server
    httpServer.listen(config.port, () => {
      console.log(`Starting Rollbar MCP server with HTTP transport on port ${config.port}...`);
      console.log(`Rollbar MCP server is running on http://localhost:${config.port}/mcp`);
    });
    
    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      
      try {
        console.log('Closing transport');
        await transport.close();
      } catch (error) {
        console.error('Error closing transport:', error);
      }
      
      console.log('Server shutdown complete');
      process.exit(0);
    });
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
