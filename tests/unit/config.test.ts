import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('config utilities', () => {
  let getUserAgent: any;

  beforeEach(async () => {
    vi.resetModules();
    process.env.ROLLBAR_ACCESS_TOKEN = 'test-token';
    
    // Mock the package.json import
    vi.doMock('../../src/package.json', () => ({
      version: '0.2.3'
    }));

    const configModule = await import('../../src/config.js');
    getUserAgent = configModule.getUserAgent;
  });

  afterEach(() => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
  });

  describe('getUserAgent', () => {
    it('should generate correct user agent string with tool name', () => {
      const userAgent = getUserAgent('get-item-details');
      expect(userAgent).toBe('rollbar-mcp-server/0.2.3 (tool: get-item-details)');
    });

    it('should handle different tool names', () => {
      expect(getUserAgent('list-items')).toBe('rollbar-mcp-server/0.2.3 (tool: list-items)');
      expect(getUserAgent('update-item')).toBe('rollbar-mcp-server/0.2.3 (tool: update-item)');
      expect(getUserAgent('get-version')).toBe('rollbar-mcp-server/0.2.3 (tool: get-version)');
      expect(getUserAgent('get-deployments')).toBe('rollbar-mcp-server/0.2.3 (tool: get-deployments)');
      expect(getUserAgent('get-top-items')).toBe('rollbar-mcp-server/0.2.3 (tool: get-top-items)');
    });

    it('should handle tool names with special characters', () => {
      expect(getUserAgent('custom-tool-123')).toBe('rollbar-mcp-server/0.2.3 (tool: custom-tool-123)');
    });

    it('should handle empty string tool name', () => {
      expect(getUserAgent('')).toBe('rollbar-mcp-server/0.2.3 (tool: )');
    });
  });
});
