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
      sessionIdGenerator: () => randomUUID()
    });

    // Set up routes for the transport
    app.use('/', (req, res, next) => {
      if (req.method === 'GET') {
        // Handle SSE connections
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Send initial connection message
        res.write('event: connected\ndata: {}\n\n');
        
        // Keep the connection alive
        const keepAliveInterval = setInterval(() => {
          res.write(': keepalive\n\n');
        }, 30000);
        
        // Clean up on close
        res.on('close', () => {
          clearInterval(keepAliveInterval);
        });
      } else if (req.method === 'POST') {
        // Handle incoming messages
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', async () => {
          try {
            const message = JSON.parse(body);
            // Process the message (in a real implementation, this would be handled by the transport)
            console.log('Received message:', message);
            res.status(200).end();
          } catch (error) {
            console.error('Error processing message:', error);
            res.status(400).json({ error: 'Invalid message format' });
          }
        });
      } else {
        next();
      }
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
