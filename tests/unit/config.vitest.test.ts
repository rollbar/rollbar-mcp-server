import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ROLLBAR_API_BASE, USER_AGENT } from '../../src/config.js';

vi.mock('dotenv', () => ({
  config: vi.fn()
}));

describe('config', () => {
  const originalEnv = process.env;
  const originalExit = process.exit;
  const originalConsoleError = console.error;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.exit = vi.fn() as any;
    console.error = vi.fn();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  it('should have correct API base URL', () => {
    expect(ROLLBAR_API_BASE).toBe('https://api.rollbar.com/api/1');
  });

  it('should have correct user agent', () => {
    expect(USER_AGENT).toBe('rollbar-mcp-server/0.0.1');
  });

  it('should load access token from environment', async () => {
    process.env.ROLLBAR_ACCESS_TOKEN = 'test-token';
    const { ROLLBAR_ACCESS_TOKEN } = await import('../../src/config.js');
    expect(ROLLBAR_ACCESS_TOKEN).toBe('test-token');
  });

  it('should exit when ROLLBAR_ACCESS_TOKEN is missing', async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    
    try {
      await import('../../src/config.js');
    } catch (e) {
      // Module may throw during import
    }

    expect(console.error).toHaveBeenCalledWith(
      'Error: ROLLBAR_ACCESS_TOKEN is not set in env var or .env file'
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should call dotenv.config() on module load', async () => {
    process.env.ROLLBAR_ACCESS_TOKEN = 'test-token';
    const dotenv = await import('dotenv');
    
    vi.resetModules();
    await import('../../src/config.js');
    
    expect(dotenv.config).toHaveBeenCalled();
  });
});