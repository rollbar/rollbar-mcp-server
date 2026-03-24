import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListProjectsTool } from '../../../src/tools/list-projects.js';

vi.mock('../../../src/config.js', () => ({
  PROJECTS: [
    {
      name: 'default',
      token: 'test-token',
      apiBase: 'https://api.rollbar.com/api/1',
    },
  ],
}));

describe('list-projects tool', () => {
  let server: McpServer;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

  beforeEach(async () => {
    server = {
      tool: vi.fn((_name, _description, _schema, handler) => {
        toolHandler = handler as typeof toolHandler;
      }),
    } as any;
    registerListProjectsTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register the tool with name list-projects', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'list-projects',
      'List configured Rollbar projects available to this MCP server',
      {},
      expect.any(Function)
    );
  });

  it('should return project names and apiBase but NOT tokens', async () => {
    const result = await toolHandler({});
    const content = JSON.parse(result.content[0].text) as Array<{
      name: string;
      apiBase: string;
      token?: string;
    }>;

    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      name: 'default',
      apiBase: 'https://api.rollbar.com/api/1',
    });
    expect(content[0]).not.toHaveProperty('token');
  });

  it('should return text content type', async () => {
    const result = await toolHandler({});
    expect(result.content[0].type).toBe('text');
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });
});
