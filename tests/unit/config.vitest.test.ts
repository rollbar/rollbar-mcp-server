import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('dotenv', () => ({
  default: {
    config: vi.fn()
  }
}));

describe('config', () => {
  const originalEnv = process.env;
  const originalExit = process.exit;
  const originalConsoleError = console.error;

  beforeEach(() => {
    process.env = { ...originalEnv, ROLLBAR_ACCESS_TOKEN: 'test-token' };
    delete process.env.ROLLBAR_API_BASE;
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

  it('should have correct API base URL', async () => {
    const { ROLLBAR_API_BASE } = await import('../../src/config.js');
    expect(ROLLBAR_API_BASE).toBe('https://api.rollbar.com/api/1');
  });

  it('should allow overriding API base URL via environment variable', async () => {
    process.env.ROLLBAR_API_BASE = 'https://rollbar-dev.example.com/api/1/';
    vi.resetModules();
    const { ROLLBAR_API_BASE } = await import('../../src/config.js');
    expect(ROLLBAR_API_BASE).toBe('https://rollbar-dev.example.com/api/1');
  });

  it('should have getUserAgent function that generates correct user agent string', async () => {
    const { getUserAgent } = await import('../../src/config.js');
    const packageJsonModule = await import('../../package.json', { with: { type: 'json' } });
    const expectedVersion = packageJsonModule.default.version;
    expect(getUserAgent('test-tool')).toBe(`rollbar-mcp-server/${expectedVersion} (tool: test-tool)`);
  });

  it('should load access token from environment', async () => {
    process.env.ROLLBAR_ACCESS_TOKEN = 'custom-token';
    const { ROLLBAR_ACCESS_TOKEN } = await import('../../src/config.js');
    expect(ROLLBAR_ACCESS_TOKEN).toBe('custom-token');
  });

  it('should exit when ROLLBAR_ACCESS_TOKEN is missing', async () => {
    delete process.env.ROLLBAR_ACCESS_TOKEN;
    
    await import('../../src/config.js');

    expect(console.error).toHaveBeenCalledWith(
      'Error: ROLLBAR_ACCESS_TOKEN is not set in env var or .env file'
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should exit when ROLLBAR_API_BASE is invalid', async () => {
    process.env.ROLLBAR_API_BASE = 'not-a-valid-url';
    vi.resetModules();

    await import('../../src/config.js');

    expect(console.error).toHaveBeenCalledWith(
      'Error: ROLLBAR_API_BASE must be a valid HTTP(S) URL. Received "not-a-valid-url".'
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should call dotenv.config() on module load', async () => {
    const dotenv = await import('dotenv');
    vi.clearAllMocks();
    
    await import('../../src/config.js');
    
    expect(dotenv.default.config).toHaveBeenCalled();
  });
});
