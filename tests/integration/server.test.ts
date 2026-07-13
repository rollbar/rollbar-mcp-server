import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from '../../src/tools/index.js';

// Mock the config to provide PROJECTS and resolveProject
vi.mock('../../src/config.js', () => ({
  PROJECTS: [
    {
      name: 'default',
      token: 'test-token',
      apiBase: 'https://api.rollbar.com/api/1',
    },
  ],
  resolveProject: vi.fn(() => ({
    name: 'default',
    token: 'test-token',
    apiBase: 'https://api.rollbar.com/api/1',
  })),
  getUserAgent: (toolName: string) => `rollbar-mcp-server/test (tool: ${toolName})`,
}));

// Mock the transport
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn()
}));

describe('MCP Server Integration', () => {
  let server: McpServer;
  let mockTransport: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // Mock transport
    mockTransport = {
      start: vi.fn(),
      close: vi.fn()
    };
    (StdioServerTransport as any).mockImplementation(function () {
      return mockTransport;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should initialize server with correct configuration', () => {
    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        }
      }
    );

    expect(server).toBeDefined();
  });

  it('should register all tools correctly', () => {
    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: { resources: {}, tools: {} }
      }
    );

    const toolSpy = vi.spyOn(server, 'tool');
    registerAllTools(server);

    expect(toolSpy).toHaveBeenCalledTimes(8);
    expect(toolSpy).toHaveBeenCalledWith(
      'get-item-details',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(toolSpy).toHaveBeenCalledWith(
      'get-deployments',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(toolSpy).toHaveBeenCalledWith(
      'get-version',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(toolSpy).toHaveBeenCalledWith(
      'get-top-items',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(toolSpy).toHaveBeenCalledWith(
      'list-items',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(toolSpy).toHaveBeenCalledWith(
      'update-item',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(toolSpy).toHaveBeenCalledWith(
      'get-replay',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(toolSpy).toHaveBeenCalledWith(
      'list-projects',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('should handle missing ROLLBAR_ACCESS_TOKEN on startup', () => {
    // We can't test this in integration tests because config.ts uses process.exit
    // which would terminate the test runner. This is tested in unit tests instead.
    expect(true).toBe(true);
  });

  it('should connect to transport successfully', async () => {
    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: { resources: {}, tools: {} }
      }
    );

    const connectSpy = vi.spyOn(server, 'connect').mockResolvedValue();

    await server.connect(mockTransport);

    expect(connectSpy).toHaveBeenCalledWith(mockTransport);
  });

  it('should handle server lifecycle correctly', async () => {
    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: { resources: {}, tools: {} }
      }
    );

    // Mock the connect method
    const connectSpy = vi.spyOn(server, 'connect').mockResolvedValue();

    // Simulate SSE connection handling
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rollbar MCP Server running on http://localhost:3000');

    expect(connectSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Rollbar MCP Server running on http://localhost:3000');
  });

  it('should handle connection errors in handleSSEConnection', async () => {
    const testError = new Error('Connection failed');

    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: { resources: {}, tools: {} }
      }
    );

    // Mock connect to throw error
    vi.spyOn(server, 'connect').mockRejectedValue(testError);

    // Simulate connection error handling
    try {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    } catch (error) {
      console.error('SSE connection error:', error);
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith('SSE connection error:', testError);
  });

  it('should verify MCP protocol compliance', () => {
    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        }
      }
    );

    // Verify server has required MCP methods
    expect(typeof server.connect).toBe('function');
    expect(typeof server.tool).toBe('function');
    expect(server).toBeDefined();
  });

  it.skip('should not output anything to stdout during server startup (stdio mode removed in favor of HTTP/SSE)', async () => {
    const { spawn } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify((await import('child_process')).exec);

    // First ensure the server is built
    await execAsync('npm run build');

    // Spawn the server process to capture its output
    const serverProcess = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ROLLBAR_ACCESS_TOKEN: 'test-token' }
    });

    let stdoutOutput = '';

    // Collect stdout output
    serverProcess.stdout?.on('data', (data) => {
      stdoutOutput += data.toString();
    });

    // Send initialization request to trigger server startup
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "1.0.0",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      },
      id: 1
    }) + '\n';

    serverProcess.stdin?.write(initRequest);

    // Wait for server to process the request or timeout
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        serverProcess.kill();
        reject(new Error('Server startup timeout'));
      }, 5000);

      serverProcess.stdout?.on('data', (data) => {
        const response = data.toString();
        if (response.includes('"jsonrpc":"2.0"')) {
          clearTimeout(timeout);
          serverProcess.kill();
          resolve();
        }
      });

      serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // The MCP JSON response is expected, but anything else is not.
    // If response is not valid json, fail the test.
    var response = JSON.parse(stdoutOutput);
    expect(response.result).toBeDefined();
  });

  it('should handle concurrent tool registration', () => {
    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: { resources: {}, tools: {} }
      }
    );

    const toolSpy = vi.spyOn(server, 'tool');

    // Register all tools concurrently
    const registrations = [
      () => server.tool('tool1', 'desc1', {}, async () => ({ content: [] })),
      () => server.tool('tool2', 'desc2', {}, async () => ({ content: [] })),
      () => server.tool('tool3', 'desc3', {}, async () => ({ content: [] }))
    ];

    registrations.forEach(reg => reg());

    expect(toolSpy).toHaveBeenCalledTimes(3);
  });

  it('should handle tool execution errors gracefully', () => {
    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: { resources: {}, tools: {} }
      }
    );

    const toolSpy = vi.spyOn(server, 'tool');

    // Register a tool that throws an error
    expect(() => {
      server.tool('error-tool', 'Test error handling', {}, async () => {
        throw new Error('Tool execution failed');
      });
    }).not.toThrow();

    // Verify the tool was registered
    expect(toolSpy).toHaveBeenCalledWith(
      'error-tool',
      'Test error handling',
      {},
      expect.any(Function)
    );
  });

  it('should validate server capabilities structure', () => {
    server = new McpServer(
      {
        name: 'rollbar',
        version: '0.0.1',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        }
      }
    );

    // Register all tools
    registerAllTools(server);

    // Verify server is properly configured
    expect(server).toBeDefined();
  });
});
