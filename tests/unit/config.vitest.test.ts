import { describe, it, expect } from 'vitest';
import { ROLLBAR_API_BASE, USER_AGENT } from '../../src/config.js';

describe('config', () => {
  it('should have correct API base URL', () => {
    expect(ROLLBAR_API_BASE).toBe('https://api.rollbar.com/api/1');
  });

  it('should have correct user agent', () => {
    expect(USER_AGENT).toBe('rollbar-mcp-server/0.0.1');
  });

  it('should load access token from environment', () => {
    // Access token will be whatever is in the environment
    expect(typeof process.env.ROLLBAR_ACCESS_TOKEN).toBe('string');
  });
});