import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetTopItemsTool } from '../../../src/tools/get-top-items.js';
import { mockSuccessfulTopItemsResponse, mockErrorResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
}));

describe('get-top-items tool', () => {
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
    
    registerGetTopItemsTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register the tool with correct parameters', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'get-top-items',
      'Get list of top items in the Rollbar project',
      expect.objectContaining({
        environment: expect.any(Object)
      }),
      expect.any(Function)
    );
  });

  it('should handle successful API response', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulTopItemsResponse);

    const result = await toolHandler({ environment: 'staging' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/reports/top_active_items?hours=24&environments=staging&sort=occurrences'
    );
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('"id": 1');
    expect(result.content[0].text).toContain('"title": "Top Error"');
  });

  it('should use default environment parameter', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulTopItemsResponse);

    const result = await toolHandler({ environment: 'production' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/reports/top_active_items?hours=24&environments=production&sort=occurrences'
    );
  });

  it('should handle API error response (err !== 0)', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    const result = await toolHandler({ environment: 'production' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Failed to retrieve top item data.');
  });

  it('should handle null/undefined response', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(null);

    const result = await toolHandler({ environment: 'production' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Failed to retrieve top item data.');
  });

  it('should handle exceptions during API call', async () => {
    const error = new Error('Network error');
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    const result = await toolHandler({ environment: 'production' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Error retrieving top items details: Network error');
    expect(console.error).toHaveBeenCalledWith('Error in get-topitems tool:', error);
  });

  it('should handle non-Error exceptions', async () => {
    makeRollbarRequestMock.mockRejectedValueOnce('String error');

    const result = await toolHandler({ environment: 'production' });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Error retrieving top items details: String error');
  });

  it('should validate environment parameter with Zod schema', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];
    
    // Test coercion and default value
    expect(schema.environment.parse('staging')).toBe('staging');
    expect(schema.environment.parse(123)).toBe('123'); // coerce to string
    expect(schema.environment.parse(undefined)).toBe('production'); // default value
    expect(schema.environment.parse(null)).toBe('null'); // coerce null to string
  });

  it('should format response as JSON with proper indentation', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulTopItemsResponse);

    const result = await toolHandler({ environment: 'production' });

    const parsedText = JSON.parse(result.content[0].text);
    expect(parsedText).toEqual(mockSuccessfulTopItemsResponse.result);
    expect(result.content[0].text).toContain('  '); // Check for indentation
  });

  it('should log response data to console.error', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulTopItemsResponse);

    await toolHandler({ environment: 'production' });

    expect(console.error).toHaveBeenCalledWith(mockSuccessfulTopItemsResponse);
    expect(console.error).toHaveBeenCalledWith('Top items response:', mockSuccessfulTopItemsResponse.result);
  });

  it('should construct URL with correct parameters', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulTopItemsResponse);

    await toolHandler({ environment: 'development' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/reports/top_active_items?hours=24&environments=development&sort=occurrences'
    );
  });
});