import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetItemDetailsTool } from '../../../src/tools/get-item-details.js';
import { mockSuccessfulItemResponse, mockSuccessfulOccurrenceResponse, mockErrorResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
}));

describe('get-item-details tool', () => {
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
    
    registerGetItemDetailsTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register the tool with correct parameters', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'get-item-details',
      'Get item details for a Rollbar item',
      expect.objectContaining({
        counter: expect.any(Object)
      }),
      expect.any(Function)
    );
  });

  it('should handle successful API response with both item and occurrence', async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulOccurrenceResponse);

    const result = await toolHandler({ counter: 42 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/item_by_counter/42'
    );
    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/instance/999'
    );
    
    const responseData = JSON.parse(result.content[0].text);
    expect(responseData).toHaveProperty('id', 1);
    expect(responseData).toHaveProperty('counter', 42);
    expect(responseData).toHaveProperty('occurrence');
    expect(responseData.occurrence).toHaveProperty('id', 999);
  });

  it('should handle API error response for item (err !== 0)', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow('Rollbar API returned error: Invalid access token');
  });

  it('should handle null/undefined item response', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(null);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow();
  });

  it('should return only item data when occurrence fetch fails', async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockErrorResponse);

    const result = await toolHandler({ counter: 42 });

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData).toEqual(mockSuccessfulItemResponse.result);
    expect(responseData).not.toHaveProperty('occurrence');
  });

  it('should return only item data when occurrence response fails', async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockErrorResponse);

    const result = await toolHandler({ counter: 42 });

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData).toEqual(mockSuccessfulItemResponse.result);
    expect(responseData).not.toHaveProperty('occurrence');
  });

  it('should remove metadata from occurrence data', async () => {
    const occurrenceWithMetadata = {
      ...mockSuccessfulOccurrenceResponse,
      result: {
        ...mockSuccessfulOccurrenceResponse.result,
        data: {
          ...mockSuccessfulOccurrenceResponse.result.data,
          metadata: { sensitive: 'data' }
        }
      }
    };

    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(occurrenceWithMetadata);

    const result = await toolHandler({ counter: 42 });

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.occurrence.data).not.toHaveProperty('metadata');
  });

  it('should handle exceptions during API call', async () => {
    const error = new Error('Network error');
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow('Network error');
  });

  it('should handle non-Error exceptions', async () => {
    makeRollbarRequestMock.mockRejectedValueOnce('String error');

    await expect(toolHandler({ counter: 42 })).rejects.toThrow('String error');
  });

  it('should validate counter parameter with Zod schema', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];
    
    expect(() => schema.counter.parse(42)).not.toThrow();
    expect(() => schema.counter.parse(0)).not.toThrow();
    expect(() => schema.counter.parse(-1)).not.toThrow();
    expect(() => schema.counter.parse(3.14)).toThrow();
    expect(() => schema.counter.parse('42')).toThrow();
    expect(() => schema.counter.parse(null)).toThrow();
  });

  it('should not log debug information anymore', async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulOccurrenceResponse);

    await toolHandler({ counter: 42 });

    expect(console.error).not.toHaveBeenCalled();
  });

  it('should format response as JSON with proper indentation', async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulOccurrenceResponse);

    const result = await toolHandler({ counter: 42 });

    expect(result.content[0].text).toContain('  '); // Check for indentation
    const parsedText = JSON.parse(result.content[0].text);
    expect(parsedText).toBeTruthy();
  });
});