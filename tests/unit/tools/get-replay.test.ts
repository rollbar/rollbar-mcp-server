import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetReplayTool } from '../../../src/tools/get-replay.js';
import { mockSuccessfulReplayResponse, mockErrorResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
}));

describe('get-replay tool', () => {
  let server: McpServer;
  let toolHandler: any;
  let makeRollbarRequestMock: any;

  beforeEach(async () => {
    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    makeRollbarRequestMock = makeRollbarRequest as any;

    server = {
      tool: vi.fn((name, description, schema, handler) => {
        toolHandler = handler;
      })
    } as any;

    registerGetReplayTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register the tool with correct parameters', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'get-replay',
      'Get replay data for a specific session replay in Rollbar',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('should fetch replay data and return compact JSON', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulReplayResponse);

    const result = await toolHandler({
      environment: 'production',
      sessionId: 'session-123',
      replayId: 'replay-456'
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/environment/production/session/session-123/replay/replay-456',
      'get-replay'
    );

    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(mockSuccessfulReplayResponse.result);
    expect(result.content[0].text).toBe(JSON.stringify(parsed));
  });

  it('should encode URL components when necessary', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulReplayResponse);

    await toolHandler({
      environment: 'prod env',
      sessionId: 'session/123',
      replayId: 'replay:456'
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/environment/prod%20env/session/session%2F123/replay/replay%3A456',
      'get-replay'
    );
  });

  it('should throw when API response contains an error', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    await expect(
      toolHandler({
        environment: 'production',
        sessionId: 'session-123',
        replayId: 'replay-456'
      })
    ).rejects.toThrow('Rollbar API returned error: Invalid access token');
  });

  it('should propagate underlying request errors', async () => {
    const error = new Error('Network failure');
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    await expect(
      toolHandler({
        environment: 'production',
        sessionId: 'session-123',
        replayId: 'replay-456'
      })
    ).rejects.toThrow('Network failure');
  });

  it('should validate inputs via schema', () => {
    const schema = (server.tool as any).mock.calls[0][2];

    expect(() => schema.environment.parse('production')).not.toThrow();
    expect(() => schema.environment.parse('')).toThrow();
    expect(() => schema.sessionId.parse('session-123')).not.toThrow();
    expect(() => schema.sessionId.parse('')).toThrow();
    expect(() => schema.replayId.parse('replay-123')).not.toThrow();
    expect(() => schema.replayId.parse('')).toThrow();
  });
});
