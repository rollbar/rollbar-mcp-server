import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetDeploymentsTool } from '../../../src/tools/get-deployments.js';
import { mockSuccessfulDeployResponse, mockErrorResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
}));

describe('get-deployments tool', () => {
  let server: McpServer;
  let toolHandler: any;
  let makeRollbarRequestMock: any;

  beforeEach(async () => {
    console.error = vi.fn();
    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    makeRollbarRequestMock = makeRollbarRequest as any;
    
    server = {
      tool: vi.fn((name, description, schema, handler) => {
        toolHandler = handler;
      })
    } as any;
    
    registerGetDeploymentsTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register the tool with correct parameters', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'get-deployments',
      'Get deployments data from Rollbar',
      expect.objectContaining({
        limit: expect.any(Object)
      }),
      expect.any(Function)
    );
  });

  it('should handle successful API response', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulDeployResponse);

    const result = await toolHandler({ limit: 10 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/deploys?limit=10'
    );
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('"environment": "production"');
    expect(result.content[0].text).toContain('"revision": "abc123"');
  });

  it('should handle API error response (err !== 0)', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    await expect(toolHandler({ limit: 5 })).rejects.toThrow('Rollbar API returned error: Invalid access token');
  });

  it('should handle null/undefined response', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(null);

    await expect(toolHandler({ limit: 5 })).rejects.toThrow();
  });

  it('should use default limit parameter', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulDeployResponse);

    const result = await toolHandler({ limit: 20 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/deploys?limit=20'
    );
  });

  it('should handle exceptions during API call', async () => {
    const error = new Error('Network error');
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    await expect(toolHandler({ limit: 10 })).rejects.toThrow('Network error');
  });

  it('should handle non-Error exceptions', async () => {
    makeRollbarRequestMock.mockRejectedValueOnce('String error');

    await expect(toolHandler({ limit: 10 })).rejects.toThrow('String error');
  });

  it('should validate limit parameter with Zod schema', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];
    
    expect(() => schema.limit.parse(10)).not.toThrow();
    expect(() => schema.limit.parse(0)).not.toThrow();
    expect(() => schema.limit.parse(-1)).not.toThrow();
    expect(() => schema.limit.parse(3.14)).toThrow();
    expect(() => schema.limit.parse('10')).toThrow();
    expect(() => schema.limit.parse(null)).toThrow();
  });

  it('should format response as JSON with proper indentation', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulDeployResponse);

    const result = await toolHandler({ limit: 10 });

    const parsedText = JSON.parse(result.content[0].text);
    expect(parsedText).toEqual(mockSuccessfulDeployResponse.result);
    expect(result.content[0].text).toContain('  '); // Check for indentation
  });

  it('should not log deployment response anymore', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulDeployResponse);

    await toolHandler({ limit: 10 });

    expect(console.error).not.toHaveBeenCalled();
  });
});