import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRollbarRequest } from '../../../src/utils/api.js';

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_ACCESS_TOKEN: 'test-token',
  USER_AGENT: 'test-user-agent'
}));

describe('api utilities', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    console.error = vi.fn();
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

      const result = await makeRollbarRequest(testUrl);

      expect(fetchMock).toHaveBeenCalledWith(testUrl, {
        headers: {
          'User-Agent': 'test-user-agent',
          'X-Rollbar-Access-Token': 'test-token',
          'Accept': 'application/json'
        }
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle missing ROLLBAR_ACCESS_TOKEN', async () => {
      vi.resetModules();
      vi.mock('../../../src/config.js', () => ({
        ROLLBAR_ACCESS_TOKEN: undefined,
        USER_AGENT: 'test-user-agent'
      }));

      const { makeRollbarRequest: makeRequest } = await import('../../../src/utils/api.js');
      
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      const result = await makeRequest(testUrl);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Error making Rollbar API request:',
        expect.any(Error)
      );
    });

    it('should handle HTTP 401 error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      const result = await makeRollbarRequest(testUrl);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Error making Rollbar API request:',
        expect.objectContaining({
          message: 'HTTP error! status: 401'
        })
      );
    });

    it('should handle HTTP 403 error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403
      });

      const result = await makeRollbarRequest(testUrl);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Error making Rollbar API request:',
        expect.objectContaining({
          message: 'HTTP error! status: 403'
        })
      );
    });

    it('should handle HTTP 404 error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      const result = await makeRollbarRequest(testUrl);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Error making Rollbar API request:',
        expect.objectContaining({
          message: 'HTTP error! status: 404'
        })
      );
    });

    it('should handle HTTP 500 error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      const result = await makeRollbarRequest(testUrl);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Error making Rollbar API request:',
        expect.objectContaining({
          message: 'HTTP error! status: 500'
        })
      );
    });

    it('should handle network failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await makeRollbarRequest(testUrl);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Error making Rollbar API request:',
        expect.objectContaining({
          message: 'Network error'
        })
      );
    });

    it('should handle JSON parsing errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValueOnce(new Error('Invalid JSON'))
      });

      const result = await makeRollbarRequest(testUrl);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Error making Rollbar API request:',
        expect.objectContaining({
          message: 'Invalid JSON'
        })
      );
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

      const result = await makeRollbarRequest<TestResponse>(testUrl);

      expect(result).toEqual(mockResponse);
      expect(result?.id).toBe(1);
      expect(result?.name).toBe('test');
    });
  });
});