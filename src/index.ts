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
    
    // Map to store transports by session ID
    const transports: Record<string, StreamableHTTPServerTransport> = {};
    
    // Create a single event store for all sessions to enable resumability
    const eventStore = new InMemoryEventStore();

    // Handle SSE connections (GET requests)
    app.get('/mcp', async (req, res) => {
      console.log('Received SSE connection request');
      
      try {
        // Check for session ID
        const sessionId = req.headers['mcp-session-id'] as string;
        
        if (!sessionId) {
          // For SSE connections without a session ID, we need to create a new session
          console.log('Creating new SSE session');
          
          // Create a new transport with a new session ID
          const newSessionId = randomUUID();
          console.log(`Generated new session ID: ${newSessionId}`);
          
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
            eventStore,
          });
          
          // Store the transport
          transports[newSessionId] = transport;
          
          // Connect the transport to the server
          await server.connect(transport);
          
          // Set headers for SSE
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Mcp-Session-Id', newSessionId);
          
          // Handle client disconnect
          req.on('close', () => {
            console.log(`Client disconnected from session ${newSessionId}`);
          });
          
          // Start the SSE stream
          await transport.handleRequest(req, res);
          return;
        }
        
        // If we have a session ID, check if we have a transport for it
        if (!transports[sessionId]) {
          console.log(`No transport found for session ID: ${sessionId}`);
          res.status(400).send('Invalid session ID');
          return;
        }
        
        console.log(`Resuming SSE stream for session ${sessionId}`);
        
        // Set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Handle client disconnect
        req.on('close', () => {
          console.log(`Client disconnected from session ${sessionId}`);
        });
        
        // Resume the SSE stream
        await transports[sessionId].handleRequest(req, res);
      } catch (error) {
        console.error('Error handling SSE connection:', error);
        if (!res.headersSent) {
          res.status(500).send('Internal server error');
        }
      }
    });

    // Handle JSON-RPC requests (POST requests)
    app.post('/mcp', async (req, res) => {
      console.log('Received JSON-RPC request:', req.body);
      
      try {
        // Check for session ID
        const sessionId = req.headers['mcp-session-id'] as string;
        
        if (!sessionId) {
          // For requests without a session ID, check if it's an initialization request
          if (isInitializeRequest(req.body)) {
            console.log('Received initialization request without session ID');
            
            // Create a new transport with a new session ID
            const newSessionId = randomUUID();
            console.log(`Generated new session ID: ${newSessionId}`);
            
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => newSessionId,
              eventStore,
            });
            
            // Store the transport
            transports[newSessionId] = transport;
            
            // Connect the transport to the server
            await server.connect(transport);
            
            // Set the session ID header
            res.setHeader('Mcp-Session-Id', newSessionId);
            
            // Handle the request
            await transport.handleRequest(req, res, req.body);
            return;
          }
          
          // Not an initialization request and no session ID
          console.log('Received non-initialization request without session ID');
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Session ID required for non-initialization requests',
            },
            id: req.body.id || null,
          });
          return;
        }
        
        // If we have a session ID, check if we have a transport for it
        if (!transports[sessionId]) {
          console.log(`No transport found for session ID: ${sessionId}`);
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Invalid session ID',
            },
            id: req.body.id || null,
          });
          return;
        }
        
        console.log(`Handling JSON-RPC request for session ${sessionId}`);
        
        // Handle the request
        await transports[sessionId].handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling JSON-RPC request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: req.body?.id || null,
          });
        }
      }
    });

    // Handle session termination (DELETE requests)
    app.delete('/mcp', async (req, res) => {
      console.log('Received session termination request');
      
      try {
        // Check for session ID
        const sessionId = req.headers['mcp-session-id'] as string;
        
        if (!sessionId || !transports[sessionId]) {
          console.log(`Invalid session ID for termination: ${sessionId}`);
          res.status(400).send('Invalid session ID');
          return;
        }
        
        console.log(`Terminating session ${sessionId}`);
        
        // Close the transport
        await transports[sessionId].close();
        
        // Remove the transport from the map
        delete transports[sessionId];
        
        // Send success response
        res.status(200).send('Session terminated');
      } catch (error) {
        console.error('Error handling session termination:', error);
        if (!res.headersSent) {
          res.status(500).send('Internal server error');
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
      
      // Close all active transports
      for (const sessionId in transports) {
        try {
          console.log(`Closing transport for session ${sessionId}`);
          await transports[sessionId].close();
        } catch (error) {
          console.error(`Error closing transport for session ${sessionId}:`, error);
        }
      }
      
      // Clear the transports map
      Object.keys(transports).forEach(key => delete transports[key]);
      
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
