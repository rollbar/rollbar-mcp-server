import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('api utilities', () => {
  let fetchMock: any;
  let makeRollbarRequest: any;

  beforeEach(async () => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    
    // Reset modules and setup mocks before each test
    vi.resetModules();
    
    // Mock config module with test values
    vi.doMock('../../../src/config.js', () => ({
      ROLLBAR_ACCESS_TOKEN: 'test-token',
      getUserAgent: (toolName: string) => `test-user-agent (tool: ${toolName})`
    }));
    
    // Import the function after mocking
    const apiModule = await import('../../../src/utils/api.js');
    makeRollbarRequest = apiModule.makeRollbarRequest;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('makeRollbarRequest', () => {
    const testUrl = 'https://api.rollbar.com/test';

    it('should make successful API request with correct headers', async () => {
      const mockResponse = { data: 'test' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockResponse)
      });

      const result = await makeRollbarRequest(testUrl, 'test-tool');

      expect(fetchMock).toHaveBeenCalledWith(testUrl, {
        headers: {
          'User-Agent': 'test-user-agent (tool: test-tool)',
          'X-Rollbar-Access-Token': 'test-token',
          'Accept': 'application/json'
        }
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle missing ROLLBAR_ACCESS_TOKEN', async () => {
      vi.resetModules();
      vi.doMock('../../../src/config.js', () => ({
        ROLLBAR_ACCESS_TOKEN: undefined,
        getUserAgent: (toolName: string) => `test-user-agent (tool: ${toolName})`
      }));

      const { makeRollbarRequest: makeRequest } = await import('../../../src/utils/api.js');
      
      await expect(makeRequest(testUrl, 'test-tool')).rejects.toThrow('ROLLBAR_ACCESS_TOKEN environment variable is not set');
    });

    it('should handle HTTP 401 error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValueOnce('')
      });

      await expect(makeRollbarRequest(testUrl, 'test-tool')).rejects.toThrow('Rollbar API error: 401 Unauthorized');
    });

    it('should handle HTTP 403 error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: vi.fn().mockResolvedValueOnce('')
      });

      await expect(makeRollbarRequest(testUrl, 'test-tool')).rejects.toThrow('Rollbar API error: 403 Forbidden');
    });

    it('should handle HTTP 404 error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValueOnce('')
      });

      await expect(makeRollbarRequest(testUrl, 'test-tool')).rejects.toThrow('Rollbar API error: 404 Not Found');
    });

    it('should handle HTTP 500 error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValueOnce('')
      });

      await expect(makeRollbarRequest(testUrl, 'test-tool')).rejects.toThrow('Rollbar API error: 500 Internal Server Error');
    });

    it('should handle network failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await expect(makeRollbarRequest(testUrl, 'test-tool')).rejects.toThrow('Network error');
    });

    it('should handle JSON parsing errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValueOnce(new Error('Invalid JSON'))
      });

      await expect(makeRollbarRequest(testUrl, 'test-tool')).rejects.toThrow('Invalid JSON');
    });

    it('should properly type the response', async () => {
      interface TestResponse {
        id: number;
        name: string;
      }

      const mockResponse: TestResponse = { id: 1, name: 'test' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockResponse)
      });

      const result = await makeRollbarRequest<TestResponse>(testUrl, 'test-tool');

      expect(result).toEqual(mockResponse);
      expect(result?.id).toBe(1);
      expect(result?.name).toBe('test');
    });

    it('should extract error message from JSON response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValueOnce('{"message": "Custom error message"}')
      });

      await expect(makeRollbarRequest(testUrl, 'test-tool')).rejects.toThrow('Rollbar API error: Custom error message');
    });

    it('should include short text in error when not JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValueOnce('Short error text')
      });

      await expect(makeRollbarRequest(testUrl, 'test-tool')).rejects.toThrow('Rollbar API error: 400 Bad Request - Short error text');
    });
    it('should include tool name in user agent string', async () => {
      const mockResponse = { data: 'test' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockResponse)
      });

      await makeRollbarRequest(testUrl, 'get-item-details');

      expect(fetchMock).toHaveBeenCalledWith(testUrl, {
        headers: {
          'User-Agent': 'test-user-agent (tool: get-item-details)',
          'X-Rollbar-Access-Token': 'test-token',
          'Accept': 'application/json'
        }
      });
    });

    it('should handle different tool names in user agent', async () => {
      const mockResponse = { data: 'test' };
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse)
      });

      await makeRollbarRequest(testUrl, 'list-items');
      expect(fetchMock).toHaveBeenLastCalledWith(testUrl, {
        headers: {
          'User-Agent': 'test-user-agent (tool: list-items)',
          'X-Rollbar-Access-Token': 'test-token',
          'Accept': 'application/json'
        }
      });

      await makeRollbarRequest(testUrl, 'update-item');
      expect(fetchMock).toHaveBeenLastCalledWith(testUrl, {
        headers: {
          'User-Agent': 'test-user-agent (tool: update-item)',
          'X-Rollbar-Access-Token': 'test-token',
          'Accept': 'application/json'
        }
      });
    });
  });
});