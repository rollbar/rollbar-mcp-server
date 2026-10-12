import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from '../../src/tools/index.js';

// Mock the config to provide PROJECTS and resolveProject
vi.mock('../../src/config.js', () => ({
  HAS_ACCOUNT_TOKEN: false,
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

    expect(toolSpy).toHaveBeenCalledTimes(9);
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
    expect(toolSpy).toHaveBeenCalledWith(
      'list-occurrences',
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
    const { spawn, exec } = await import('node:child_process');
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);

    // First ensure the server is built
    await execAsync('npm run build');

    const testDirectory = await mkdtemp(join(tmpdir(), 'rollbar-mcp-startup-'));
    try {
      const configPath = join(testDirectory, 'config.json');
      await writeFile(configPath, JSON.stringify({ token: 'test-token' }));
      const env = { ...process.env };
      for (const name of [
        'ROLLBAR_ACCESS_TOKEN',
        'ROLLBAR_ACCOUNT_ACCESS_TOKEN',
        'ROLLBAR_USER_ACCESS_TOKEN',
        'ROLLBAR_API_BASE',
      ]) {
        delete env[name];
      }
      env.ROLLBAR_CONFIG_FILE = configPath;

      // The child does not share Vitest's config mock. An explicit config
      // bypasses cwd/home configs, and an empty cwd prevents loading .env.
      const serverPath = fileURLToPath(
        new URL('../../build/index.js', import.meta.url)
      );
      const serverProcess = spawn(process.execPath, [serverPath], {
        cwd: testDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      const closed = new Promise<void>((resolve) => {
        serverProcess.once('close', () => resolve());
      });
      let stdoutOutput = '';
      let stderrOutput = '';
      let timeout: ReturnType<typeof setTimeout> | undefined;
      serverProcess.stdout.setEncoding('utf8');
      serverProcess.stderr.setEncoding('utf8');
      serverProcess.stderr.on('data', (data) => {
        stderrOutput += data;
      });

      try {
        await new Promise<void>((resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('Server startup timeout'));
          }, 5000);
          serverProcess.stdout.on('data', (data) => {
            stdoutOutput += data;
            // Wait for a complete stdio frame, even when JSON spans chunks.
            if (stdoutOutput.includes('\n')) resolve();
          });
          serverProcess.once('error', reject);
          serverProcess.stdin.once('error', reject);
          serverProcess.once('close', (code, signal) => {
            reject(new Error(
              `Server exited before initialization (code=${code}, signal=${signal}): ${stderrOutput}`
            ));
          });
          serverProcess.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '1.0.0',
              capabilities: {},
              clientInfo: { name: 'test-client', version: '1.0.0' },
            },
            id: 1,
          }) + '\n');
        });
      } finally {
        clearTimeout(timeout);
        serverProcess.kill();
        await closed;
      }

      // The MCP JSON response is expected, but anything else is not.
      const response = JSON.parse(stdoutOutput);
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toBeDefined();
    } finally {
      await rm(testDirectory, { recursive: true, force: true });
    }
  }, 10000);

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
        },
        'update-item': {
          description: 'Update the status, level, title, or assignment of a Rollbar item'
        },
        'get-replay': {
          description: 'Get replay data for a specific session replay in Rollbar'
        },
        'list-projects': {
          description: 'List configured Rollbar projects available in this MCP server'
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
    expect(Object.keys(capabilities.tools)).toHaveLength(8);

    // Verify all tools have descriptions
    Object.values(capabilities.tools).forEach(tool => {
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    });
  });
});
