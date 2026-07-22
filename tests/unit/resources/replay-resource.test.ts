import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mockSuccessfulReplayResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  HAS_ACCOUNT_TOKEN: false,
  PROJECTS: [
    {
      name: 'default',
      token: 'test-token',
      apiBase: 'https://api.rollbar.com/api/1',
    },
  ],
  resolveProject: vi.fn(() => ({
    name: 'default',
    token: 'test-token',
    apiBase: 'https://api.rollbar.com/api/1',
  })),
  resolveAuthContext: vi.fn(async () => ({
    token: 'test-token',
    tokenType: 'project',
    apiBase: 'https://api.rollbar.com/api/1',
  })),
  getAccountModeInfo: vi.fn(async () => ({ active: false })),
}));

let makeRollbarRequestMock: any;
let replayModule: Awaited<
  typeof import('../../../src/resources/replay-resource.js')
>;

beforeAll(async () => {
  replayModule = await import('../../../src/resources/replay-resource.js');
});

describe('replay resource registration', () => {
  let server: McpServer;
  let resourceSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    makeRollbarRequestMock = makeRollbarRequest as any;
    resourceSpy = vi.fn();
    server = {
      resource: resourceSpy
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register resource template only once per server', () => {
    replayModule.registerReplayResource(server);
    replayModule.registerReplayResource(server);

    expect(resourceSpy).toHaveBeenCalledTimes(1);
    expect(resourceSpy.mock.calls[0][1]).toBeInstanceOf(ResourceTemplate);
  });

  it('exposes helper to build replay resource URIs', () => {
    const uri = replayModule.buildReplayResourceUri(
      'production',
      'session/sub',
      'replay id'
    );
    expect(uri).toBe('rollbar://replay/production/session%2Fsub/replay%20id');
  });
});

describe('read replay resource handler', () => {
  const environment = 'production';
  const sessionId = 'session-123';
  const replayId = 'replay-456';
  let replayUri: string;
  let readCallback: any;
  let server: McpServer;
  let resourceSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    makeRollbarRequestMock = makeRollbarRequest as any;
    makeRollbarRequestMock.mockResolvedValue({
      err: 0,
      result: mockSuccessfulReplayResponse.result
    } as any);

    resourceSpy = vi.fn(
      (
        _name: string,
        _template: ResourceTemplate,
        _metadata: unknown,
        handler: any
      ) => {
        readCallback = handler;
      }
    );

    server = { resource: resourceSpy } as any;
    replayModule.registerReplayResource(server);

    replayUri = replayModule.buildReplayResourceUri(
      environment,
      sessionId,
      replayId
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches replay data from the API when cache is cold', async () => {
    const uri = new URL(replayUri);

    const result = await readCallback(uri, {
      environment,
      sessionId,
      replayId
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledTimes(1);
    expect(result.contents[0].uri).toBe(uri.toString());
    expect(result.contents[0].mimeType).toBe('application/json');
  });

  it('returns cached data without calling API again', async () => {
    const uri = new URL(replayUri);

    replayModule.cacheReplayData(replayUri, { cached: true });

    const result = await readCallback(uri, {
      environment,
      sessionId,
      replayId
    });

    expect(makeRollbarRequestMock).not.toHaveBeenCalled();
    expect(result.contents[0].text).toBe(JSON.stringify({ cached: true }));
  });

  it('throws for invalid URIs', async () => {
    const uri = new URL(replayUri);

    await expect(
      readCallback(uri, {
        environment: '',
        sessionId,
        replayId
      })
    ).rejects.toThrow('Invalid replay resource URI');
  });

  it('throws when PROJECTS.length > 1 with message to use get-replay tool', async () => {
    vi.resetModules();
    vi.doMock('../../../src/config.js', () => ({
      HAS_ACCOUNT_TOKEN: false,
      PROJECTS: [
        { name: 'backend', token: 't1', apiBase: 'https://api.rollbar.com/api/1' },
        { name: 'frontend', token: 't2', apiBase: 'https://api.rollbar.com/api/1' },
      ],
      resolveProject: vi.fn(),
      resolveAuthContext: vi.fn(),
      getAccountModeInfo: vi.fn(async () => ({ active: false })),
    }));
    const replayMod = await import('../../../src/resources/replay-resource.js');
    let multiProjectReadCallback: typeof readCallback;
    const resourceSpy2 = vi.fn((_n: string, _t: unknown, _m: unknown, handler: unknown) => {
      multiProjectReadCallback = handler as typeof readCallback;
    });
    const server2 = { resource: resourceSpy2 } as any;
    replayMod.registerReplayResource(server2);

    const uri = new URL(replayUri);
    await expect(
      multiProjectReadCallback!(uri, { environment, sessionId, replayId })
    ).rejects.toThrow(
      'Direct replay resource access is not supported when multiple projects are configured'
    );
    await expect(
      multiProjectReadCallback!(uri, { environment, sessionId, replayId })
    ).rejects.toThrow('get-replay tool');
  });

  it('allows direct replay resource access in account mode even when PROJECTS.length > 1, and injects project_id', async () => {
    vi.resetModules();
    vi.doMock('../../../src/config.js', () => ({
      HAS_ACCOUNT_TOKEN: false,
      PROJECTS: [
        { name: 'backend', token: 't1', apiBase: 'https://api.rollbar.com/api/1' },
        { name: 'frontend', token: 't2', apiBase: 'https://api.rollbar.com/api/1' },
      ],
      resolveProject: vi.fn(),
      resolveAuthContext: vi.fn(async () => ({
        token: 'acct-token',
        tokenType: 'account',
        projectId: 9,
        apiBase: 'https://api.rollbar.com/api/1',
      })),
      getAccountModeInfo: vi.fn(async () => ({
        active: true,
        token: 'acct-token',
        apiBase: 'https://api.rollbar.com/api/1',
      })),
    }));

    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    const localMakeRollbarRequestMock = makeRollbarRequest as any;
    localMakeRollbarRequestMock.mockResolvedValue({
      err: 0,
      result: mockSuccessfulReplayResponse.result,
    });

    const replayMod = await import('../../../src/resources/replay-resource.js');
    let accountModeReadCallback: typeof readCallback;
    const resourceSpy3 = vi.fn((_n: string, _t: unknown, _m: unknown, handler: unknown) => {
      accountModeReadCallback = handler as typeof readCallback;
    });
    const server3 = { resource: resourceSpy3 } as any;
    replayMod.registerReplayResource(server3);

    const uri = new URL(replayUri);
    await accountModeReadCallback!(uri, { environment, sessionId, replayId });

    expect(localMakeRollbarRequestMock).toHaveBeenCalledWith(
      `https://api.rollbar.com/api/1/environment/${environment}/session/${sessionId}/replay/${replayId}?project_id=9`,
      'get-replay',
      'acct-token'
    );
  });

  it('propagates a clear error (does not silently proceed unresolved) when account mode has multiple projects and resolveAuthContext cannot pick one', async () => {
    vi.resetModules();
    vi.doMock('../../../src/config.js', () => ({
      HAS_ACCOUNT_TOKEN: false,
      PROJECTS: [],
      resolveProject: vi.fn(),
      // Mirrors what the real resolveAuthContext()/resolveProjectId() do when
      // an account token has 2+ enabled projects and no `project` was given:
      // they throw rather than resolving a projectId. The read-resource
      // handler must let that propagate as an error, not fall through to an
      // unscoped/broken account-mode request.
      resolveAuthContext: vi.fn(async () => {
        throw new Error(
          'Multiple projects available on this account token. Specify a project. Available: backend, frontend'
        );
      }),
      getAccountModeInfo: vi.fn(async () => ({
        active: true,
        token: 'acct-token',
        apiBase: 'https://api.rollbar.com/api/1',
      })),
    }));

    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    const localMakeRollbarRequestMock = makeRollbarRequest as any;

    const replayMod = await import('../../../src/resources/replay-resource.js');
    let noProjectReadCallback: typeof readCallback;
    const resourceSpy4 = vi.fn((_n: string, _t: unknown, _m: unknown, handler: unknown) => {
      noProjectReadCallback = handler as typeof readCallback;
    });
    const server4 = { resource: resourceSpy4 } as any;
    replayMod.registerReplayResource(server4);

    const uri = new URL(replayUri);
    await expect(
      noProjectReadCallback!(uri, { environment, sessionId, replayId })
    ).rejects.toThrow('Multiple projects available on this account token');

    // The request must never have been made without a resolved project.
    expect(localMakeRollbarRequestMock).not.toHaveBeenCalled();
  });

  it('rejects direct resource access up front (before calling resolveAuthContext) when account mode has multiple enabled projects', async () => {
    vi.resetModules();
    // PROJECTS is empty (account-token-only mode). Before the fix, this
    // guard checked `PROJECTS.length > 1 && !accountMode.active`, which is
    // always false here regardless of enabledProjectCount, so the guard
    // never fired and execution fell through to resolveAuthContext(undefined)
    // instead of failing with this resource's own clear error message.
    const resolveAuthContextMock = vi.fn();
    vi.doMock('../../../src/config.js', () => ({
      HAS_ACCOUNT_TOKEN: true,
      PROJECTS: [],
      resolveAuthContext: resolveAuthContextMock,
      getAccountModeInfo: vi.fn(async () => ({
        active: true,
        token: 'acct-token',
        apiBase: 'https://api.rollbar.com/api/1',
        enabledProjectCount: 2,
      })),
    }));

    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    const localMakeRollbarRequestMock = makeRollbarRequest as any;

    const replayMod = await import('../../../src/resources/replay-resource.js');
    let guardReadCallback: typeof readCallback;
    const resourceSpy5 = vi.fn((_n: string, _t: unknown, _m: unknown, handler: unknown) => {
      guardReadCallback = handler as typeof readCallback;
    });
    const server5 = { resource: resourceSpy5 } as any;
    replayMod.registerReplayResource(server5);

    const uri = new URL(replayUri);
    await expect(
      guardReadCallback!(uri, { environment, sessionId, replayId })
    ).rejects.toThrow(
      'Direct replay resource access is not supported when multiple projects are configured'
    );

    expect(resolveAuthContextMock).not.toHaveBeenCalled();
    expect(localMakeRollbarRequestMock).not.toHaveBeenCalled();
  });
});
