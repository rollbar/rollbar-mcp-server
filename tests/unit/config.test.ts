import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('config utilities', () => {
  let getUserAgent: any;
  let originalToken: string | undefined; // Preserve any real token injected by CI so we can restore it later.
  let packageVersion: string;

  beforeEach(async () => {
    vi.resetModules();
    originalToken = process.env.ROLLBAR_ACCESS_TOKEN;
    // Force a token during the test run only when CI hasn't provided one so importing config.ts doesn't call process.exit.
    if (originalToken === undefined) {
      process.env.ROLLBAR_ACCESS_TOKEN = 'test-token';
    }
    const packageJsonModule = await import('../../package.json', { with: { type: 'json' } });
    packageVersion = packageJsonModule.default.version;

    const configModule = await import('../../src/config.js');
    getUserAgent = configModule.getUserAgent;
  });

  afterEach(() => {
    // Put back the original token (or clear it) so parallel tests see the same environment state.
    if (originalToken === undefined) {
      delete process.env.ROLLBAR_ACCESS_TOKEN;
    } else {
      process.env.ROLLBAR_ACCESS_TOKEN = originalToken;
    }
  });

  describe('getUserAgent', () => {
    it('should generate correct user agent string with tool name', () => {
      const userAgent = getUserAgent('get-item-details');
      expect(userAgent).toBe(`rollbar-mcp-server/${packageVersion} (tool: get-item-details)`);
    });

    it('should handle different tool names', () => {
      expect(getUserAgent('list-items')).toBe(`rollbar-mcp-server/${packageVersion} (tool: list-items)`);
      expect(getUserAgent('update-item')).toBe(`rollbar-mcp-server/${packageVersion} (tool: update-item)`);
      expect(getUserAgent('get-version')).toBe(`rollbar-mcp-server/${packageVersion} (tool: get-version)`);
      expect(getUserAgent('get-deployments')).toBe(`rollbar-mcp-server/${packageVersion} (tool: get-deployments)`);
      expect(getUserAgent('get-top-items')).toBe(`rollbar-mcp-server/${packageVersion} (tool: get-top-items)`);
    });

    it('should handle tool names with special characters', () => {
      expect(getUserAgent('custom-tool-123')).toBe(`rollbar-mcp-server/${packageVersion} (tool: custom-tool-123)`);
    });

    it('should handle empty string tool name', () => {
      expect(getUserAgent('')).toBe(`rollbar-mcp-server/${packageVersion} (tool: )`);
    });
  });
});
