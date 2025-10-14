import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mockSuccessfulReplayResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
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
});
