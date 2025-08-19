import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListItemsTool } from '../../../src/tools/list-items.js';
import { mockSuccessfulListItemsResponse, mockErrorResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
}));

describe('list-items tool', () => {
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
    
    registerListItemsTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register the tool with correct parameters', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'list-items',
      'List all items in the Rollbar project with optional search and filtering',
      expect.objectContaining({
        status: expect.any(Object),
        level: expect.any(Object),
        environment: expect.any(Object),
        page: expect.any(Object),
        query: expect.any(Object)
      }),
      expect.any(Function)
    );
  });

  it('should handle successful API response with default parameters', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulListItemsResponse);

    const result = await toolHandler({ status: 'active', environment: 'production' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/items/?status=active&environment=production',
      'list-items'
    );
    
    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.items).toHaveLength(1);
    expect(responseData.pagination).toEqual({
      page: 1,
      total_count: 100,
      items_on_page: 1
    });
    expect(responseData.filters_applied).toEqual({
      status: 'active',
      level: null,
      environment: 'production',
      query: null
    });
  });

  it('should handle all filter parameters', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulListItemsResponse);

    const result = await toolHandler({
      status: 'resolved',
      level: ['error', 'critical'],
      environment: 'staging',
      page: 2,
      query: 'TypeError'
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/items/?status=resolved&level=error&level=critical&environment=staging&page=2&q=TypeError',
      'list-items'
    );
    
    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.filters_applied).toEqual({
      status: 'resolved',
      level: ['error', 'critical'],
      environment: 'staging',
      query: 'TypeError'
    });
  });

  it('should not include page parameter when page is 1', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulListItemsResponse);

    await toolHandler({ page: 1, status: 'active', environment: 'production' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/items/?status=active&environment=production',
      'list-items'
    );
  });

  it('should handle API error response (err !== 0)', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    await expect(toolHandler({})).rejects.toThrow('Rollbar API returned error: Invalid access token');
  });

  it('should handle null/undefined response', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(null);

    await expect(toolHandler({})).rejects.toThrow();
  });

  it('should handle exceptions during API call', async () => {
    const error = new Error('Network error');
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    await expect(toolHandler({})).rejects.toThrow('Network error');
  });

  it('should handle non-Error exceptions', async () => {
    makeRollbarRequestMock.mockRejectedValueOnce('String error');

    await expect(toolHandler({})).rejects.toThrow('String error');
  });

  it('should validate parameter schemas with Zod', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];
    
    // Test status parameter
    expect(schema.status.parse(undefined)).toBe('active'); // default
    expect(schema.status.parse('resolved')).toBe('resolved');
    
    // Test level parameter
    expect(schema.level.parse(undefined)).toBeUndefined(); // optional
    expect(schema.level.parse(['error', 'warning'])).toEqual(['error', 'warning']);
    expect(() => schema.level.parse('error')).toThrow(); // must be array
    
    // Test environment parameter
    expect(schema.environment.parse(undefined)).toBe('production'); // default
    expect(schema.environment.parse('staging')).toBe('staging');
    
    // Test page parameter
    expect(schema.page.parse(undefined)).toBe(1); // default
    expect(schema.page.parse(5)).toBe(5);
    expect(() => schema.page.parse(0)).toThrow(); // min is 1
    expect(() => schema.page.parse(3.14)).toThrow(); // must be int
    
    // Test query parameter
    expect(schema.query.parse(undefined)).toBeUndefined(); // optional
    expect(schema.query.parse('search term')).toBe('search term');
  });

  it('should format response as JSON with proper indentation', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulListItemsResponse);

    const result = await toolHandler({});

    expect(result.content[0].text).toContain('  '); // Check for indentation
    const parsedText = JSON.parse(result.content[0].text);
    expect(parsedText).toBeTruthy();
  });

  it('should not log URL and response anymore', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulListItemsResponse);

    await toolHandler({ status: 'active', environment: 'production' });

    expect(console.error).not.toHaveBeenCalled();
  });

  it('should handle empty level array', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulListItemsResponse);

    await toolHandler({ level: [], status: 'active', environment: 'production' });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/items/?status=active&environment=production',
      'list-items'
    );
  });

  it('should handle multiple level values correctly', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulListItemsResponse);

    await toolHandler({ level: ['error', 'warning', 'critical'] });

    const urlCall = makeRollbarRequestMock.mock.calls[0][0];
    expect(urlCall).toContain('level=error');
    expect(urlCall).toContain('level=warning');
    expect(urlCall).toContain('level=critical');
  });
});