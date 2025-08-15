import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetVersionTool } from '../../../src/tools/get-version.js';
import { mockSuccessfulVersionResponse, mockErrorResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
}));

describe('get-version tool', () => {
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
    
    registerGetVersionTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register the tool with correct parameters', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'get-version',
      'Get version details for a Rollbar project',
      expect.objectContaining({
        version: expect.any(Object),
        environment: expect.any(Object)
      }),
      expect.any(Function)
    );
  });

  it('should handle successful API response', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulVersionResponse);

    const result = await toolHandler({ version: 'v1.2.3', environment: 'staging' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/versions/v1.2.3?environment=staging',
      'get-version'
    );
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('"version": "v1.2.3"');
    expect(result.content[0].text).toContain('"environment": "production"');
  });

  it('should use default environment parameter', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulVersionResponse);

    const result = await toolHandler({ version: 'abc123', environment: 'production' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/versions/abc123?environment=production',
      'get-version'
    );
  });

  it('should handle API error response (err !== 0)', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    await expect(toolHandler({ version: 'v1.2.3', environment: 'production' })).rejects.toThrow('Rollbar API returned error: Invalid access token');
  });

  it('should handle null/undefined response', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(null);

    await expect(toolHandler({ version: 'v1.2.3', environment: 'production' })).rejects.toThrow();
  });

  it('should handle exceptions during API call', async () => {
    const error = new Error('Network error');
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    await expect(toolHandler({ version: 'v1.2.3', environment: 'production' })).rejects.toThrow('Network error');
  });

  it('should handle non-Error exceptions', async () => {
    makeRollbarRequestMock.mockRejectedValueOnce('String error');

    await expect(toolHandler({ version: 'v1.2.3', environment: 'production' })).rejects.toThrow('String error');
  });

  it('should validate version parameter with Zod schema', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];
    
    // Test coercion for version
    expect(schema.version.parse('v1.2.3')).toBe('v1.2.3');
    expect(schema.version.parse(123)).toBe('123'); // coerce to string
    expect(schema.version.parse(null)).toBe('null'); // coerce null to string
    expect(schema.version.parse(undefined)).toBe('undefined'); // coerce undefined to string
  });

  it('should validate environment parameter with Zod schema', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];
    
    // Test coercion and default value for environment
    expect(schema.environment.parse('staging')).toBe('staging');
    expect(schema.environment.parse(123)).toBe('123'); // coerce to string
    expect(schema.environment.parse(undefined)).toBe('production'); // default value
    expect(schema.environment.parse(null)).toBe('null'); // coerce null to string
  });

  it('should format response as JSON with proper indentation', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulVersionResponse);

    const result = await toolHandler({ version: 'v1.2.3', environment: 'production' });

    const parsedText = JSON.parse(result.content[0].text);
    expect(parsedText).toEqual(mockSuccessfulVersionResponse.result);
    expect(result.content[0].text).toContain('  '); // Check for indentation
  });

  it('should not log response data anymore', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulVersionResponse);

    await toolHandler({ version: 'v1.2.3', environment: 'production' });

    expect(console.error).not.toHaveBeenCalled();
  });

  it('should construct URL with correct parameters', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulVersionResponse);

    await toolHandler({ version: 'git-sha-abc123', environment: 'development' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/versions/git-sha-abc123?environment=development',
      'get-version'
    );
  });
});