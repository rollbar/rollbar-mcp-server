import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerUpdateItemTool } from '../../../src/tools/update-item.js';
import { mockErrorResponse } from '../../fixtures/rollbar-responses.js';

vi.mock('../../../src/utils/api.js', () => ({
  makeRollbarRequest: vi.fn()
}));

vi.mock('../../../src/config.js', () => ({
  ROLLBAR_API_BASE: 'https://api.rollbar.com/api/1',
  ROLLBAR_ACCESS_TOKEN: 'test-token'
}));

describe('update-item tool', () => {
  let server: McpServer;
  let toolHandler: any;
  let makeRollbarRequestMock: any;

  beforeEach(async () => {
    console.error = vi.fn();
    const { makeRollbarRequest } = await import('../../../src/utils/api.js');
    makeRollbarRequestMock = makeRollbarRequest as any;

    server = {
      tool: vi.fn((name, description, schema, handler) => {
        toolHandler = handler;
      })
    } as any;

    registerUpdateItemTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register the tool with correct parameters', () => {
    expect(server.tool).toHaveBeenCalledWith(
      'update-item',
      'Update an item in Rollbar (status, level, title, assignment, etc.)',
      expect.objectContaining({
        itemId: expect.any(Object),
        status: expect.any(Object),
        level: expect.any(Object),
        title: expect.any(Object),
        assignedUserId: expect.any(Object),
        resolvedInVersion: expect.any(Object),
        snoozed: expect.any(Object),
        teamId: expect.any(Object)
      }),
      expect.any(Function)
    );
  });

  it('should handle successful API response with status update', async () => {
    const mockResponse = {
      err: 0,
      result: { id: 123, status: 'resolved' }
    };
    makeRollbarRequestMock.mockResolvedValueOnce(mockResponse);

    const result = await toolHandler({
      itemId: 123,
      status: 'resolved'
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/item/123',
      'update-item',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'resolved' })
      }
    );
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('resolved');
  });

  it('should handle multiple field updates', async () => {
    const mockResponse = {
      err: 0,
      result: { id: 456, status: 'active', level: 'error', title: 'Updated title' }
    };
    makeRollbarRequestMock.mockResolvedValueOnce(mockResponse);

    const result = await toolHandler({
      itemId: 456,
      status: 'active',
      level: 'error',
      title: 'Updated title',
      assignedUserId: 789,
      resolvedInVersion: '1.2.3',
      snoozed: true,
      teamId: 101
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/item/456',
      'update-item',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'active',
          level: 'error',
          title: 'Updated title',
          assigned_user_id: 789,
          resolved_in_version: '1.2.3',
          snoozed: true,
          team_id: 101
        })
      }
    );
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe('Updated title');
  });

  it('should throw error when no fields provided to update', async () => {
    await expect(toolHandler({ itemId: 123 })).rejects.toThrow(
      'At least one field must be provided to update'
    );
    expect(makeRollbarRequestMock).not.toHaveBeenCalled();
  });

  it('should handle API error response (err !== 0)', async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    await expect(toolHandler({
      itemId: 123,
      status: 'resolved'
    })).rejects.toThrow('Rollbar API returned error: Invalid access token');
  });

  it('should handle API error with no message', async () => {
    const errorResponse = {
      err: 1,
      result: null
    };
    makeRollbarRequestMock.mockResolvedValueOnce(errorResponse);

    await expect(toolHandler({
      itemId: 123,
      level: 'critical'
    })).rejects.toThrow('Rollbar API returned error: Unknown error (code: 1)');
  });

  it('should handle exceptions during API call', async () => {
    const error = new Error('Network error');
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    await expect(toolHandler({
      itemId: 123,
      status: 'muted'
    })).rejects.toThrow('Network error');
  });

  it('should handle undefined optional fields correctly', async () => {
    const mockResponse = {
      err: 0,
      result: { id: 123, title: 'New title' }
    };
    makeRollbarRequestMock.mockResolvedValueOnce(mockResponse);

    await toolHandler({
      itemId: 123,
      title: 'New title',
      status: undefined,
      level: undefined
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/item/123',
      'update-item',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'New title' })
      }
    );
  });

  it('should validate status enum values with Zod schema', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.status.parse('active')).not.toThrow();
    expect(() => schema.status.parse('resolved')).not.toThrow();
    expect(() => schema.status.parse('muted')).not.toThrow();
    expect(() => schema.status.parse('archived')).not.toThrow();
    expect(() => schema.status.parse('invalid')).toThrow();
    expect(() => schema.status.parse(undefined)).not.toThrow();
  });

  it('should validate level enum values with Zod schema', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.level.parse('debug')).not.toThrow();
    expect(() => schema.level.parse('info')).not.toThrow();
    expect(() => schema.level.parse('warning')).not.toThrow();
    expect(() => schema.level.parse('error')).not.toThrow();
    expect(() => schema.level.parse('critical')).not.toThrow();
    expect(() => schema.level.parse('invalid')).toThrow();
    expect(() => schema.level.parse(undefined)).not.toThrow();
  });

  it('should validate itemId as integer with Zod schema', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.itemId.parse(123)).not.toThrow();
    expect(() => schema.itemId.parse(0)).not.toThrow();
    expect(() => schema.itemId.parse(-1)).not.toThrow();
    expect(() => schema.itemId.parse(3.14)).toThrow();
    expect(() => schema.itemId.parse('123')).toThrow();
    expect(() => schema.itemId.parse(null)).toThrow();
  });

  it('should format response as compact JSON', async () => {
    const mockResponse = {
      err: 0,
      result: { id: 123, status: 'resolved', level: 'info' }
    };
    makeRollbarRequestMock.mockResolvedValueOnce(mockResponse);

    const result = await toolHandler({
      itemId: 123,
      status: 'resolved'
    });

    const parsedText = JSON.parse(result.content[0].text);
    expect(parsedText).toEqual(mockResponse.result);
    expect(result.content[0].text).toBe(JSON.stringify(parsedText));
  });

  it('should handle boolean snoozed field correctly', async () => {
    const mockResponse = {
      err: 0,
      result: { id: 123, snoozed: true }
    };
    makeRollbarRequestMock.mockResolvedValueOnce(mockResponse);

    await toolHandler({
      itemId: 123,
      snoozed: false
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      'https://api.rollbar.com/api/1/item/123',
      'update-item',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ snoozed: false })
      }
    );
  });
});
