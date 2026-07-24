import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListOccurrencesTool } from "../../../src/tools/list-occurrences.js";
import {
  mockSuccessfulItemResponse,
  mockGroupItemResponse,
  mockSuccessfulListOccurrencesResponse,
  mockLargeBrowserOccurrence,
  mockErrorResponse,
} from "../../fixtures/rollbar-responses.js";

vi.mock("../../../src/utils/api.js", () => ({
  makeRollbarRequest: vi.fn(),
}));

vi.mock("../../../src/config.js", () => ({
  HAS_ACCOUNT_TOKEN: false,
  PROJECTS: [
    {
      name: "default",
      token: "test-token",
      apiBase: "https://api.rollbar.com/api/1",
    },
  ],
  resolveProject: vi.fn(() => ({
    name: "default",
    token: "test-token",
    apiBase: "https://api.rollbar.com/api/1",
  })),
  resolveAuthContext: vi.fn(async () => ({
    token: "test-token",
    tokenType: "project",
    apiBase: "https://api.rollbar.com/api/1",
  })),
  getUserAgent: (toolName: string) =>
    `rollbar-mcp-server/test (tool: ${toolName})`,
}));

// Deliberately NOT mocking ../../../src/utils/truncation.js: Issue 1
// requires the response-size fallback to be verified against the REAL
// truncateOccurrence()/allocateResponseBudget() code path, not a fake.

describe("list-occurrences tool", () => {
  let server: McpServer;
  let toolHandler: any;
  let makeRollbarRequestMock: any;

  beforeEach(async () => {
    console.error = vi.fn();
    const { makeRollbarRequest } = await import("../../../src/utils/api.js");
    makeRollbarRequestMock = makeRollbarRequest as any;

    server = {
      tool: vi.fn((name, description, schema, handler) => {
        toolHandler = handler;
      }),
    } as any;

    registerListOccurrencesTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should register the tool with correct name and params", () => {
    expect(server.tool).toHaveBeenCalledWith(
      "list-occurrences",
      expect.any(String),
      expect.objectContaining({
        counter: expect.any(Object),
        limit: expect.any(Object),
        page: expect.any(Object),
        last_id: expect.any(Object),
        max_tokens: expect.any(Object),
        project: expect.any(Object),
      }),
      expect.any(Function),
    );
  });

  it('should not promise "all" occurrences or newest-first ordering in the description', () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const description: string = schemaCall[1];
    expect(description.toLowerCase()).not.toContain("all occurrences");
    expect(description.toLowerCase()).not.toContain("newest");
  });

  it("should call item lookup by counter then instances, and return correct JSON output", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

    const result = await toolHandler({
      counter: 42,
      limit: 3,
      page: 1,
      max_tokens: 20000,
      project: undefined,
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/?counter=42",
      "list-occurrences",
      "test-token",
    );
    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=3&page=1",
      "list-occurrences",
      "test-token",
    );

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData).toHaveProperty("page", 1);
    expect(responseData).toHaveProperty("instances");
    expect(responseData.instances).toHaveLength(2);
    expect(result.content[0].text).toBe(JSON.stringify(responseData));
  });

  it("should sort same-timestamp instances by id DESC so the last item is the min id", async () => {
    const sameTimestampResponse = {
      err: 0,
      result: {
        page: 1,
        instances: [
          // Deliberately out of id order for a shared timestamp, mirroring
          // Mox's re-sort step which orders by timestamp only.
          { id: 500, item_id: 1, timestamp: 1640001000, version: 1, data: {} },
          { id: 502, item_id: 1, timestamp: 1640001000, version: 1, data: {} },
          { id: 501, item_id: 1, timestamp: 1640001000, version: 1, data: {} },
        ],
      },
    };

    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(sameTimestampResponse);

    const result = await toolHandler({
      counter: 42,
      limit: 3,
      page: 1,
      max_tokens: 20000,
    });

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.instances.map((i: { id: number }) => i.id)).toEqual([
      502, 501, 500,
    ]);
  });

  it("should pass limit and page through to the API query string", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

    await toolHandler({ counter: 42, limit: 50, page: 2 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=50&page=2",
      "list-occurrences",
      "test-token",
    );
  });

  it("should use last_id instead of page when provided", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

    await toolHandler({ counter: 42, limit: 3, page: 1, last_id: 998 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=3&last_id=998",
      "list-occurrences",
      "test-token",
    );
  });

  it("should only send last_id when both page and last_id are provided", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

    await toolHandler({ counter: 42, limit: 3, page: 5, last_id: 998 });

    const instancesCall = makeRollbarRequestMock.mock.calls[1][0];
    expect(instancesCall).toContain("last_id=998");
    expect(instancesCall).not.toContain("page=");
  });

  it("should throw with API message when item lookup returns err !== 0", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("Rollbar API returned error: Invalid access token");
  });

  it("should throw with API message when instances lookup returns err !== 0", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockErrorResponse);

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("Rollbar API returned error: Invalid access token");
  });

  it("should throw a missing item error for a null item response", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(null);

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("missing item");
  });

  it("should throw a missing item error for malformed item result", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce({ err: 0, result: {} });

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("missing item");
  });

  it("should throw a missing instances error for a null instances response", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(null);

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("missing instances");
  });

  it("should throw a missing instances error for malformed instances result", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce({ err: 0, result: { page: 1 } });

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("missing instances");
  });

  it("should propagate network errors", async () => {
    const error = new Error("Network error");
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("Network error");
  });

  it("should propagate non-Error rejections", async () => {
    makeRollbarRequestMock.mockRejectedValueOnce("String error");

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("String error");
  });

  it("should handle an empty instances array", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce({ err: 0, result: { page: 1, instances: [] } });

    const result = await toolHandler({ counter: 42, limit: 3, page: 1 });

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.instances).toEqual([]);
    expect(responseData).not.toHaveProperty("_truncation");
  });

  it("should omit data.metadata without mutating the mocked API response", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

    const result = await toolHandler({
      counter: 42,
      limit: 3,
      page: 1,
      max_tokens: 20000,
    });

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.instances[0].data).not.toHaveProperty("metadata");
    // original fixture object must remain untouched
    expect(
      mockSuccessfulListOccurrencesResponse.result.instances[0].data,
    ).toHaveProperty("metadata");
  });

  it("should format the error message as 'Unknown error (code: N)' when no message is present", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce({ err: 5 });

    await expect(
      toolHandler({ counter: 42, limit: 3, page: 1 }),
    ).rejects.toThrow("Unknown error (code: 5)");
  });

  it("should validate the counter parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.counter.parse(42)).not.toThrow();
    expect(() => schema.counter.parse(0)).toThrow();
    expect(() => schema.counter.parse(-1)).toThrow();
    expect(() => schema.counter.parse(3.14)).toThrow();
    expect(() => schema.counter.parse("42")).toThrow();
  });

  it("should validate the limit parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.limit.parse(1)).not.toThrow();
    expect(() => schema.limit.parse(100)).not.toThrow();
    expect(schema.limit.parse(undefined)).toBe(3);
    expect(() => schema.limit.parse(0)).toThrow();
    expect(() => schema.limit.parse(101)).toThrow();
    expect(() => schema.limit.parse(3.14)).toThrow();
    expect(() => schema.limit.parse("3")).toThrow();
  });

  it("should validate the page parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.page.parse(1)).not.toThrow();
    expect(schema.page.parse(undefined)).toBe(1);
    expect(() => schema.page.parse(0)).toThrow();
    expect(() => schema.page.parse(3.14)).toThrow();
    expect(() => schema.page.parse("1")).toThrow();
  });

  it("should validate the last_id parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.last_id.parse(998)).not.toThrow();
    expect(() => schema.last_id.parse(undefined)).not.toThrow();
    expect(() => schema.last_id.parse(0)).toThrow();
    expect(() => schema.last_id.parse(3.14)).toThrow();
    expect(() => schema.last_id.parse("998")).toThrow();
  });

  it("should validate max_tokens with a positive minimum, aligned otherwise with get-item-details behavior", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.max_tokens.parse(25000)).not.toThrow();
    expect(schema.max_tokens.parse(undefined)).toBe(20000);
    expect(() => schema.max_tokens.parse(3.14)).toThrow();
    expect(() => schema.max_tokens.parse("25000")).toThrow();
    // Below the documented minimum should be rejected rather than silently
    // producing an unusable or malformed response.
    expect(() => schema.max_tokens.parse(0)).toThrow();
    expect(() => schema.max_tokens.parse(1)).toThrow();
    expect(() => schema.max_tokens.parse(99)).toThrow();
    expect(() => schema.max_tokens.parse(100)).not.toThrow();
  });

  it("should inject project_id as a query param when resolveAuthContext returns account mode", async () => {
    const { resolveAuthContext } = await import("../../../src/config.js");
    (resolveAuthContext as any).mockResolvedValueOnce({
      token: "acct-token",
      tokenType: "account",
      projectId: 77,
      apiBase: "https://api.rollbar.com/api/1",
    });

    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

    await toolHandler({
      counter: 42,
      limit: 3,
      page: 1,
      project: "SomeProject",
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/?counter=42&project_id=77",
      "list-occurrences",
      "acct-token",
    );
    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=3&page=1&project_id=77",
      "list-occurrences",
      "acct-token",
    );
  });

  describe("group item handling (Issue 2)", () => {
    it("should surface a clear, distinguishing result for a group item instead of a silent empty array", async () => {
      makeRollbarRequestMock.mockResolvedValueOnce(mockGroupItemResponse);

      const result = await toolHandler({ counter: 3655, limit: 3, page: 1 });

      // Must NOT make the instances call at all — a group item is detected
      // purely from the item lookup response, no /instances request needed.
      expect(makeRollbarRequestMock).toHaveBeenCalledTimes(1);

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toHaveProperty("error", "group_item_not_supported");
      expect(responseData.message.toLowerCase()).toContain("group");
      expect(responseData).not.toHaveProperty("instances");
      expect(responseData.item_id).toBe(mockGroupItemResponse.result.id);
    });

    it("should treat a genuinely occurrence-free (non-group) item as an empty instances array", async () => {
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse) // group_status is undefined/native
        .mockResolvedValueOnce({ err: 0, result: { page: 1, instances: [] } });

      const result = await toolHandler({ counter: 42, limit: 3, page: 1 });

      expect(makeRollbarRequestMock).toHaveBeenCalledTimes(2);
      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toEqual({ page: 1, instances: [] });
    });

    it("should still fetch instances normally for a native (ungrouped) item", async () => {
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

      const result = await toolHandler({
        counter: 42,
        limit: 3,
        page: 1,
        max_tokens: 20000,
      });

      expect(makeRollbarRequestMock).toHaveBeenCalledTimes(2);
      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.instances).toHaveLength(2);
    });
  });

  describe("response-level budget allocation (Issues 1 & 2)", () => {
    // These tests exercise the REAL truncateOccurrence() (rollbar.js) and
    // allocateResponseBudget() code paths end to end — no mocking of
    // ../../../src/utils/truncation.js — against realistic
    // browser-occurrence-shaped payloads that remain oversized even after
    // truncateOccurrence()'s own strategies run.

    function idsOf(responseData: any): number[] {
      return responseData.instances.map((i: any) => i.id);
    }

    it("bounds a small budget with 1 large instance and preserves its identity (mirrors limit=1, max_tokens=100 live scenario)", async () => {
      const large = mockLargeBrowserOccurrence(999, 1640001000);
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({
          err: 0,
          result: { page: 1, instances: [large] },
        });

      const result = await toolHandler({
        counter: 42,
        limit: 1,
        page: 1,
        max_tokens: 100,
      });

      const text = result.content[0].text as string;
      const maxChars = 100 * 4;
      // Documented margin: budget + a small, fixed overhead allowance, never
      // an exact byte cap.
      expect(text.length).toBeLessThanOrEqual(maxChars + 128);

      const responseData = JSON.parse(text);
      expect(responseData.page).toBe(1);
      // Never dropped — always represented, even if only as an id.
      expect(responseData.instances).toHaveLength(1);
      expect(responseData.instances[0].id).toBe(999);
    });

    it("bounds the default budget with a few large instances (mirrors default limit=3, max_tokens=20000 live scenario)", async () => {
      const instances = [
        mockLargeBrowserOccurrence(999, 1640001000),
        mockLargeBrowserOccurrence(998, 1640000900),
        mockLargeBrowserOccurrence(997, 1640000800),
      ];
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({ err: 0, result: { page: 1, instances } });

      const result = await toolHandler({
        counter: 42,
        limit: 3,
        page: 1,
        max_tokens: 20000,
      });

      const text = result.content[0].text as string;
      const maxChars = 20000 * 4;
      expect(text.length).toBeLessThanOrEqual(maxChars + 256);

      const responseData = JSON.parse(text);
      expect(responseData.instances).toHaveLength(3);
      expect(idsOf(responseData)).toEqual([999, 998, 997]);
    });

    it("bounds a large limit with a small budget without crashing or looping (mirrors limit=100, max_tokens=1000 live scenario)", async () => {
      const instances = Array.from({ length: 100 }, (_, i) =>
        mockLargeBrowserOccurrence(1000 - i, 1640001000 - i),
      );
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({ err: 0, result: { page: 1, instances } });

      const result = await toolHandler({
        counter: 42,
        limit: 100,
        page: 1,
        max_tokens: 1000,
      });

      const text = result.content[0].text as string;
      const maxChars = 1000 * 4;
      expect(text.length).toBeLessThanOrEqual(maxChars + 256);

      const responseData = JSON.parse(text);
      // No "returned + dropped = requested" pattern: every occurrence is
      // represented, at whatever tier fits.
      expect(responseData.instances).toHaveLength(100);
      expect(idsOf(responseData)).toEqual(
        Array.from({ length: 100 }, (_, i) => 1000 - i),
      );
      // Strict order preservation.
      const orderedDescending = idsOf(responseData).every(
        (id: number, idx: number, arr: number[]) =>
          idx === 0 || arr[idx - 1] > id,
      );
      expect(orderedDescending).toBe(true);
    });

    it("keeps small occurrences intact when only one instance in the page is oversized", async () => {
      const small = {
        id: 998,
        item_id: 1,
        timestamp: 1640000900,
        version: 1,
        data: {
          body: {},
          level: "error",
          environment: "production",
          framework: "node",
          language: "javascript",
          timestamp: 1640000900,
          platform: "server",
        },
      };
      const large = mockLargeBrowserOccurrence(999, 1640001000);

      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({
          err: 0,
          result: { page: 1, instances: [large, small] },
        });

      const result = await toolHandler({
        counter: 42,
        limit: 2,
        page: 1,
        max_tokens: 500,
      });

      const responseData = JSON.parse(result.content[0].text);
      const survivingIds = idsOf(responseData);
      // The small instance should always survive intact even when its
      // sibling needed heavy degradation.
      expect(survivingIds).toContain(998);
      expect(survivingIds).toEqual([999, 998]);
    });

    it("never mutates the original API response objects while truncating", async () => {
      const large = mockLargeBrowserOccurrence(999, 1640001000);
      const originalJson = JSON.stringify(large);

      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({
          err: 0,
          result: { page: 1, instances: [large] },
        });

      await toolHandler({ counter: 42, limit: 1, page: 1, max_tokens: 100 });

      expect(JSON.stringify(large)).toBe(originalJson);
    });

    it("large-page continuity: 100 oversized occurrences, max_tokens=1000 — every id represented, strict order", async () => {
      const instances = Array.from({ length: 100 }, (_, i) =>
        mockLargeBrowserOccurrence(2000 - i, 1650000000 - i),
      );
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({ err: 0, result: { page: 1, instances } });

      const result = await toolHandler({
        counter: 42,
        limit: 100,
        page: 1,
        max_tokens: 1000,
      });

      const responseData = JSON.parse(result.content[0].text);
      expect(idsOf(responseData)).toEqual(
        Array.from({ length: 100 }, (_, i) => 2000 - i),
      );
    });

    it("mixed-size ordering: no earlier occurrence omitted while a later one survives; cursor from last returned id has no gap on the next page", async () => {
      const instances = [
        mockLargeBrowserOccurrence(110, 1640001100), // large, newest
        {
          id: 109,
          item_id: 1,
          timestamp: 1640001090,
          version: 1,
          data: { body: {}, level: "error", environment: "production" },
        }, // small
        mockLargeBrowserOccurrence(108, 1640001080), // large
        {
          id: 107,
          item_id: 1,
          timestamp: 1640001070,
          version: 1,
          data: { body: {}, level: "error", environment: "production" },
        }, // small, oldest in this page
      ];

      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({ err: 0, result: { page: 1, instances } });

      const page1 = await toolHandler({
        counter: 42,
        limit: 4,
        page: 1,
        max_tokens: 600,
      });
      const page1Data = JSON.parse(page1.content[0].text);

      // All four ids present and in backend order — no earlier one omitted
      // while a later one survives.
      expect(idsOf(page1Data)).toEqual([110, 109, 108, 107]);

      const lastId = idsOf(page1Data)[idsOf(page1Data).length - 1];
      expect(lastId).toBe(107);

      // Cursor pagination from the last RETURNED id must not skip anything:
      // paginate again with last_id=107 and confirm the next page's backend
      // window (mocked here) starts exactly where page 1 left off, with no
      // gap introduced by local budget enforcement.
      const nextPageInstances = [
        {
          id: 106,
          item_id: 1,
          timestamp: 1640001060,
          version: 1,
          data: { body: {}, level: "error", environment: "production" },
        },
      ];
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({
          err: 0,
          result: { page: 1, instances: nextPageInstances },
        });

      const page2 = await toolHandler({
        counter: 42,
        limit: 4,
        last_id: lastId,
        max_tokens: 600,
      });
      const page2Data = JSON.parse(page2.content[0].text);

      const overlap = idsOf(page2Data).filter((id: number) =>
        idsOf(page1Data).includes(id),
      );
      expect(overlap).toEqual([]);

      const instancesCall = makeRollbarRequestMock.mock.calls[3][0];
      expect(instancesCall).toContain(`last_id=${lastId}`);
    });

    it("page-number safety: page 1 then page 2 (separate mocked backend responses) never skip occurrences due to local budget enforcement", async () => {
      const page1Instances = Array.from({ length: 5 }, (_, i) =>
        mockLargeBrowserOccurrence(200 - i, 1640002000 - i),
      );
      const page2Instances = Array.from({ length: 5 }, (_, i) =>
        mockLargeBrowserOccurrence(195 - i, 1640001995 - i),
      );

      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({
          err: 0,
          result: { page: 1, instances: page1Instances },
        });
      const page1 = await toolHandler({
        counter: 42,
        limit: 5,
        page: 1,
        max_tokens: 800,
      });
      const page1Data = JSON.parse(page1.content[0].text);
      expect(idsOf(page1Data)).toEqual([200, 199, 198, 197, 196]);

      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({
          err: 0,
          result: { page: 2, instances: page2Instances },
        });
      const page2 = await toolHandler({
        counter: 42,
        limit: 5,
        page: 2,
        max_tokens: 800,
      });
      const page2Data = JSON.parse(page2.content[0].text);
      expect(idsOf(page2Data)).toEqual([195, 194, 193, 192, 191]);

      const overlap = idsOf(page2Data).filter((id: number) =>
        idsOf(page1Data).includes(id),
      );
      expect(overlap).toEqual([]);
    });

    it("budget utilization: limit=10, max_tokens=5000 uses a reasonable portion of budget and preserves diagnostics for some occurrences", async () => {
      const instances = Array.from({ length: 10 }, (_, i) =>
        mockLargeBrowserOccurrence(300 - i, 1640003000 - i),
      );
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({ err: 0, result: { page: 1, instances } });

      const result = await toolHandler({
        counter: 42,
        limit: 10,
        page: 1,
        max_tokens: 5000,
      });

      const text = result.content[0].text as string;
      const maxChars = 5000 * 4;

      expect(text.length).toBeLessThanOrEqual(maxChars + 256);
      // Regression guard for the ~6% utilization bug: expect a meaningful
      // fraction of the budget to actually be used, not left on the table.
      expect(text.length).toBeGreaterThanOrEqual(maxChars * 0.3);

      const responseData = JSON.parse(text);
      expect(idsOf(responseData)).toEqual(
        Array.from({ length: 10 }, (_, i) => 300 - i),
      );

      // At least some occurrences should carry real diagnostic value
      // (compact tier or better), not just bare ids.
      const withDiagnostics = responseData.instances.filter(
        (inst: any) => inst.level !== undefined || inst.data !== undefined,
      );
      expect(withDiagnostics.length).toBeGreaterThan(0);
    });

    it("hard size behavior across limit/max_tokens combinations stays within the documented margin", async () => {
      const cases = [
        { limit: 1, max_tokens: 100, count: 1 },
        { limit: 3, max_tokens: 20000, count: 3 },
        { limit: 100, max_tokens: 1000, count: 100 },
      ];

      for (const { limit, max_tokens, count } of cases) {
        const instances = Array.from({ length: count }, (_, i) =>
          mockLargeBrowserOccurrence(500 - i, 1640005000 - i),
        );
        makeRollbarRequestMock
          .mockResolvedValueOnce(mockSuccessfulItemResponse)
          .mockResolvedValueOnce({ err: 0, result: { page: 1, instances } });

        const result = await toolHandler({
          counter: 42,
          limit,
          page: 1,
          max_tokens,
        });
        const text = result.content[0].text as string;
        const maxChars = max_tokens * 4;

        expect(text.length).toBeLessThanOrEqual(maxChars + 256);
      }
    });

    it("insufficient baseline: rejects with an actionable error when even id-only representations cannot fit", async () => {
      const instances = Array.from({ length: 100 }, (_, i) =>
        mockLargeBrowserOccurrence(600 - i, 1640006000 - i),
      );
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({ err: 0, result: { page: 1, instances } });

      // MIN_MAX_TOKENS=100 keeps a single-instance response feasible, but a
      // 100-occurrence page still cannot fit 100 id-only stubs plus wrapper
      // overhead within max_tokens=100 (~400 chars) — must reject clearly,
      // never return a silently partial page.
      await expect(
        toolHandler({ counter: 42, limit: 100, page: 1, max_tokens: 100 }),
      ).rejects.toThrow(/lower.*limit|raise.*max_tokens/i);
    });

    it("insufficient baseline (internal allocator): tiny budget with a large synthetic id list throws InsufficientBudgetError", async () => {
      const { allocateResponseBudget, InsufficientBudgetError } =
        await import("../../../src/utils/truncation.js");

      const instances = Array.from({ length: 500 }, (_, i) => ({
        id: 1000 + i,
        timestamp: 1640000000 + i,
      }));

      expect(() => allocateResponseBudget(instances, 10)).toThrow(
        InsufficientBudgetError,
      );
    });

    it("includes a single top-level _truncation field (not per-instance) describing degraded tiers", async () => {
      const instances = Array.from({ length: 5 }, (_, i) =>
        mockLargeBrowserOccurrence(700 - i, 1640007000 - i),
      );
      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({ err: 0, result: { page: 1, instances } });

      const result = await toolHandler({
        counter: 42,
        limit: 5,
        page: 1,
        max_tokens: 200,
      });

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toHaveProperty("_truncation");
      expect(responseData._truncation.applied).toBe(true);
      expect(typeof responseData._truncation.message).toBe("string");
      // No per-instance long truncation string repeated on every instance.
      for (const inst of responseData.instances) {
        expect(inst).not.toHaveProperty("_truncation");
      }
    });

    it("is deterministic: identical input produces byte-identical output across repeated calls", async () => {
      const buildInstances = () => [
        mockLargeBrowserOccurrence(801, 1640008010),
        mockLargeBrowserOccurrence(800, 1640008000),
      ];

      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({
          err: 0,
          result: { page: 1, instances: buildInstances() },
        });
      const first = await toolHandler({
        counter: 42,
        limit: 2,
        page: 1,
        max_tokens: 800,
      });

      makeRollbarRequestMock
        .mockResolvedValueOnce(mockSuccessfulItemResponse)
        .mockResolvedValueOnce({
          err: 0,
          result: { page: 1, instances: buildInstances() },
        });
      const second = await toolHandler({
        counter: 42,
        limit: 2,
        page: 1,
        max_tokens: 800,
      });

      expect(first.content[0].text).toBe(second.content[0].text);
    });
  });
});
