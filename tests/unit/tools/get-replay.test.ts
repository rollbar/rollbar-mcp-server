import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mockSuccessfulReplayResponse, mockErrorResponse } from '../../fixtures/rollbar-responses.js';
import { buildReplayResourceUri } from '../../../src/resources/index.js';

const mkdirMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
}));

describe('get-replay tool', () => {
  let server: McpServer;
  let toolHandler: any;
  let makeRollbarRequestMock: any;
  let registerGetReplayTool: typeof import('../../../src/tools/get-replay.js')['registerGetReplayTool'];

  beforeEach(async () => {
    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    makeRollbarRequestMock = makeRollbarRequest as any;

    ({ registerGetReplayTool } = await import('../../../src/tools/get-replay.js'));

    server = {
      tool: vi.fn((name, description, schema, handler) => {
        toolHandler = handler;
      })
    } as any;

    registerGetReplayTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mkdirMock.mockReset();
    writeFileMock.mockReset();
  });

  it('should register the tool with correct parameters', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'get-replay',
      'Get replay data for a specific session replay in Rollbar',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('should fetch replay data and return a resource link', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulReplayResponse);

    const result = await toolHandler({
      environment: 'production',
      sessionId: 'session-123',
      replayId: 'replay-456',
      delivery: 'resource'
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/environment/production/session/session-123/replay/replay-456',
      'get-replay'
    );

    const expectedResourceUri = buildReplayResourceUri(
      'production',
      'session-123',
      'replay-456'
    );

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining(expectedResourceUri)
    });

    expect(result.content[1]).toMatchObject({
      type: 'resource_link',
      uri: expectedResourceUri,
      mimeType: 'application/json'
    });

    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('should write replay data to a file by default', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulReplayResponse);
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const result = await toolHandler({
      environment: 'production',
      sessionId: 'session-123',
      replayId: 'replay-456'
    });

    const expectedDir = path.join(tmpdir(), 'rollbar-mcp-replays');
    expect(mkdirMock).toHaveBeenCalledWith(expectedDir, { recursive: true });
    expect(writeFileMock).toHaveBeenCalledTimes(1);

    const [filePath, fileContents, encoding] = writeFileMock.mock.calls[0];
    expect(filePath.startsWith(expectedDir + path.sep)).toBe(true);
    expect(fileContents).toBe(JSON.stringify(mockSuccessfulReplayResponse.result, null, 2));
    expect(encoding).toBe('utf8');
    expect(result.content[0].text).toContain(filePath);
    expect(result.content[0].text).toContain('not automatically deleted');

    dateSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it('should allow delivery to be explicitly set to file', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockSuccessfulReplayResponse);

    await toolHandler({
      environment: 'production',
      sessionId: 'session-XYZ',
      replayId: 'replay-ABC',
      delivery: 'file'
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
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
