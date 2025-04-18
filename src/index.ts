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
    
    // Enable CORS for all routes
    app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Accept', 'Last-Event-ID'],
      exposedHeaders: ['Mcp-Session-Id'],
      credentials: true
    }));
    
    // Parse JSON bodies
    app.use(express.json());
    
    // Create HTTP server
    const httpServer = createServer(app);
    
    // Map to store transports by session ID
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    // Handle POST requests for MCP messages
    app.post('/mcp', async (req, res) => {
      console.log('Received MCP request:', req.body);
      
      try {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string;
        let transport: StreamableHTTPServerTransport;
        
        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request
          const eventStore = new InMemoryEventStore();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            eventStore, // Enable resumability
            onsessioninitialized: (sid) => {
              // Store the transport by session ID when session is initialized
              console.log(`Session initialized with ID: ${sid}`);
              transports[sid] = transport;
            }
          });
          
          // Set up onclose handler to clean up transport when closed
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              console.log(`Transport closed for session ${sid}, removing from transports map`);
              delete transports[sid];
            }
          };
          
          // Connect the transport to the MCP server BEFORE handling the request
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return; // Already handled
        } else {
          // Invalid request - no session ID or not initialization request
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }
        
        // Handle the request with existing transport
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    // Handle GET requests for SSE streams
    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      
      // Check for Last-Event-ID header for resumability
      const lastEventId = req.headers['last-event-id'];
      if (lastEventId) {
        console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
      } else {
        console.log(`Establishing new SSE stream for session ${sessionId}`);
      }
      
      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    });

    // Handle DELETE requests for session termination
    app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      
      console.log(`Received session termination request for session ${sessionId}`);
      try {
        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error('Error handling session termination:', error);
        if (!res.headersSent) {
          res.status(500).send('Error processing session termination');
        }
      }
    });

    // Start HTTP server
    httpServer.listen(config.port, () => {
      console.log(`Starting Rollbar MCP server with HTTP transport on port ${config.port}...`);
    });

    console.log(`Rollbar MCP server is running on http://localhost:${config.port}/mcp`);
    
    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      
      // Close all active transports to properly clean up resources
      for (const sessionId in transports) {
        try {
          console.log(`Closing transport for session ${sessionId}`);
          await transports[sessionId].close();
          delete transports[sessionId];
        } catch (error) {
          console.error(`Error closing transport for session ${sessionId}:`, error);
        }
      }
      
      // No need to close the server as it doesn't have a close method
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
