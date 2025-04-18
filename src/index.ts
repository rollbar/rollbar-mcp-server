import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpServerTransport } from '@modelcontextprotocol/sdk/server/http.js';
import { createRollbarMcpServer } from './mcp/server.js';
import { config } from './config.js';

async function main() {
  // Create the Rollbar MCP server
  const server = createRollbarMcpServer();

  // Determine which transport to use based on command line arguments
  const args = process.argv.slice(2);
  const transportType = args[0] || 'stdio';

  if (transportType === 'http') {
    // Start the server with HTTP transport
    const transport = new HttpServerTransport({
      port: config.port,
    });

    console.log(`Starting Rollbar MCP server with HTTP transport on port ${config.port}...`);
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
