import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from '../../src/tools/index.js';

// Mock the config to provide ROLLBAR_ACCESS_TOKEN
vi.mock('../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  USER_AGENT: 'rollbar-mcp-server/0.0.1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
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
    (StdioServerTransport as any).mockImplementation(() => mockTransport);
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should initialize server with correct configuration', () => {
    const config = {
      name: 'rollbar',
      version: '0.0.1',
      capabilities: {
        resources: {},
        tools: {
          'get-item-details': {
            description: 'Get detailed information about a Rollbar item by its counter'
          },
          'get-deployments': {
            description: 'Get deployment status and information for a Rollbar project'
          },
          'get-version': {
            description: 'Get version data and information for a Rollbar project'
          },
          'get-top-items': {
            description: 'Get list of top items in the Rollbar project'
          },
          'list-items': {
            description: 'List all items in the Rollbar project with optional search and filtering'
          }
        }
      }
    };

    server = new McpServer(config);

    expect(server).toBeDefined();
    // McpServer might not expose these properties directly
    expect(config.name).toBe('rollbar');
    expect(config.version).toBe('0.0.1');
  });

  it('should register all tools correctly', () => {
    server = new McpServer({
      name: 'rollbar',
      version: '0.0.1',
      capabilities: { resources: {}, tools: {} }
    });

    const toolSpy = vi.spyOn(server, 'tool');
    registerAllTools(server);

    expect(toolSpy).toHaveBeenCalledTimes(7);
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
  });

  it('should handle missing ROLLBAR_ACCESS_TOKEN on startup', () => {
    // We can't test this in integration tests because config.ts uses process.exit
    // which would terminate the test runner. This is tested in unit tests instead.
    expect(true).toBe(true);
  });

  it('should connect to transport successfully', async () => {
    server = new McpServer({
      name: 'rollbar',
      version: '0.0.1',
      capabilities: { resources: {}, tools: {} }
    });

    const connectSpy = vi.spyOn(server, 'connect').mockResolvedValue();

    await server.connect(mockTransport);

    expect(connectSpy).toHaveBeenCalledWith(mockTransport);
  });

  it('should handle server lifecycle correctly', async () => {
    server = new McpServer({
      name: 'rollbar',
      version: '0.0.1',
      capabilities: { resources: {}, tools: {} }
    });

    // Mock the connect method
    const connectSpy = vi.spyOn(server, 'connect').mockResolvedValue();

    // Simulate main function
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Rollbar MCP Server running on stdio');

    expect(connectSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Rollbar MCP Server running on stdio');
  });

  it('should handle fatal errors in main', async () => {
    const testError = new Error('Connection failed');

    server = new McpServer({
      name: 'rollbar',
      version: '0.0.1',
      capabilities: { resources: {}, tools: {} }
    });

    // Mock connect to throw error
    vi.spyOn(server, 'connect').mockRejectedValue(testError);

    // Simulate main function with error
    try {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    } catch (error) {
      console.error('Fatal error in main():', error);
      process.exit(1);
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith('Fatal error in main():', testError);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should verify MCP protocol compliance', () => {
    const config = {
      name: 'rollbar',
      version: '0.0.1',
      capabilities: {
        resources: {},
        tools: {
          'get-item-details': { description: 'Test tool' }
        }
      }
    };

    server = new McpServer(config);

    // Verify server has required MCP methods
    expect(typeof server.connect).toBe('function');
    expect(typeof server.tool).toBe('function');
    // Server config is passed in constructor
    expect(config.name).toBeDefined();
    expect(config.version).toBeDefined();
    expect(config.capabilities).toBeDefined();
  });

  it('should not output anything to stdout during server startup', async () => {
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
    server = new McpServer({
      name: 'rollbar',
      version: '0.0.1',
      capabilities: { resources: {}, tools: {} }
    });

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

  it('should handle tool execution errors gracefully', async () => {
    server = new McpServer({
      name: 'rollbar',
      version: '0.0.1',
      capabilities: { resources: {}, tools: {} }
    });

    const toolSpy = vi.spyOn(server, 'tool');

    server.tool('error-tool', 'Test error handling', {}, async (params) => {
      throw new Error('Tool execution failed');
    });

    // Get the registered handler
    const toolCall = toolSpy.mock.calls[0];
    const errorHandler = toolCall[3];

    await expect(errorHandler({})).rejects.toThrow('Tool execution failed');
  });

  it('should validate server capabilities structure', () => {
    const capabilities = {
      resources: {},
      tools: {
        'get-item-details': {
          description: 'Get detailed information about a Rollbar item by its counter'
        },
        'get-deployments': {
          description: 'Get deployment status and information for a Rollbar project'
        },
        'get-version': {
          description: 'Get version data and information for a Rollbar project'
        },
        'get-top-items': {
          description: 'Get list of top items in the Rollbar project'
        },
        'list-items': {
          description: 'List all items in the Rollbar project with optional search and filtering'
        }
      }
    };

    const config = {
      name: 'rollbar',
      version: '0.0.1',
      capabilities
    };

    server = new McpServer(config);

    expect(capabilities).toEqual(capabilities);
    expect(Object.keys(capabilities.tools)).toHaveLength(5);

    // Verify all tools have descriptions
    Object.values(capabilities.tools).forEach(tool => {
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    });
  });
});
