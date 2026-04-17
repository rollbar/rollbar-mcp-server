import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListOccurrencesTool } from "../../../src/tools/list-occurrences.js";
import {
  mockSuccessfulItemResponse,
  mockSuccessfulListOccurrencesResponse,
  mockErrorResponse,
} from "../../fixtures/rollbar-responses.js";

vi.mock("../../../src/utils/api.js", () => ({
  makeRollbarRequest: vi.fn(),
}));

vi.mock("../../../src/config.js", () => ({
  resolveProject: vi.fn(() => ({
    token: "test-token",
    apiBase: "https://api.rollbar.com/api/1",
  })),
}));

vi.mock("../../../src/utils/project-params.js", () => ({
  buildProjectParam: vi.fn(() => ({
    optional: () => ({ describe: () => ({}) }),
  })),
}));

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

  it("should register the tool with correct parameters", () => {
    expect(server.tool).toHaveBeenCalledWith(
      "list-occurrences",
      "List all occurrences for a Rollbar item",
      expect.objectContaining({
        counter: expect.any(Object),
        page: expect.any(Object),
        limit: expect.any(Object),
        last_id: expect.any(Object),
        lastId: expect.any(Object), // deprecated alias retained for compatibility
        project: expect.any(Object),
      }),
      expect.any(Function)
    );
  });

  it("should handle successful API response with occurrences", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

    const result = await toolHandler({ counter: 42, page: 1, limit: 3 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item_by_counter/42",
      "list-occurrences",
      "test-token"
    );
    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=3&page=1",
      "list-occurrences",
      "test-token"
    );

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData).toHaveProperty("page", 1);
    expect(responseData).toHaveProperty("instances");
    expect(responseData.instances).toHaveLength(2); // Mock has 2 instances
    expect(responseData.instances[0]).toHaveProperty("id", 999);
    expect(responseData.instances[1]).toHaveProperty("id", 998);
  });

  it("should pass limit parameter to API", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce({
        err: 0,
        result: { page: 1, instances: [{ id: 999 }] },
      });

    const result = await toolHandler({ counter: 42, page: 1, limit: 1 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=1&page=1",
      "list-occurrences",
      "test-token"
    );

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.instances).toHaveLength(1);
  });

  it("should handle pagination parameter", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce({
        err: 0,
        result: { page: 2, instances: [] },
      });

    const result = await toolHandler({ counter: 42, page: 2, limit: 3 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=3&page=2",
      "list-occurrences",
      "test-token"
    );

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData).toHaveProperty("page", 2);
    expect(responseData.instances).toHaveLength(0);
  });

  it("should use last_id for pagination when provided", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce({
        err: 0,
        result: { page: 1, instances: [{ id: 997 }] },
      });

    const result = await toolHandler({
      counter: 42,
      limit: 3,
      last_id: 998,
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=3&last_id=998",
      "list-occurrences",
      "test-token"
    );

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData.instances).toHaveLength(1);
    expect(responseData.instances[0].id).toBe(997);
  });

  it("should handle API error response for item (err !== 0)", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(mockErrorResponse);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow(
      "Rollbar API returned error: Invalid access token"
    );
  });

  it("should handle API error response for occurrences (err !== 0)", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockErrorResponse);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow(
      "Rollbar API returned error: Invalid access token"
    );
  });

  it("should throw on null item response", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(null);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow(
      "Invalid API response",
    );
  });

  it("should throw when item result is missing", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce({ err: 0, result: null });

    await expect(toolHandler({ counter: 42 })).rejects.toThrow("missing item");
  });

  it("should throw on null occurrences response", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(null);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow(
      "Invalid API response",
    );
  });

  it("should throw when occurrences result is missing instances", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce({ err: 0, result: { page: 1 } });

    await expect(toolHandler({ counter: 42 })).rejects.toThrow("missing instances");
  });

  it("should handle exceptions during API call", async () => {
    const error = new Error("Network error");
    makeRollbarRequestMock.mockRejectedValueOnce(error);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow("Network error");
  });

  it("should handle non-Error exceptions", async () => {
    makeRollbarRequestMock.mockRejectedValueOnce("String error");

    await expect(toolHandler({ counter: 42 })).rejects.toThrow("String error");
  });

  it("should validate counter parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.counter.parse(42)).not.toThrow();
    expect(() => schema.counter.parse(0)).toThrow();
    expect(() => schema.counter.parse(-1)).toThrow();
    expect(() => schema.counter.parse(3.14)).toThrow();
    expect(() => schema.counter.parse("42")).toThrow();
    expect(() => schema.counter.parse(null)).toThrow();
  });

  it("should validate page parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.page.parse(1)).not.toThrow();
    expect(() => schema.page.parse(100)).not.toThrow();
    expect(() => schema.page.parse(undefined)).not.toThrow(); // Optional
    expect(() => schema.page.parse(3.14)).toThrow();
    expect(() => schema.page.parse("1")).toThrow();
  });

  it("should validate limit parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.limit.parse(1)).not.toThrow();
    expect(() => schema.limit.parse(3)).not.toThrow();
    expect(() => schema.limit.parse(100)).not.toThrow();
    expect(() => schema.limit.parse(undefined)).not.toThrow(); // has default
    expect(() => schema.limit.parse(101)).toThrow(); // exceeds max
    expect(() => schema.limit.parse(0)).toThrow(); // below min
    expect(() => schema.limit.parse(3.14)).toThrow();
    expect(() => schema.limit.parse("3")).toThrow();
  });

  it("should validate last_id parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.last_id.parse(12345)).not.toThrow();
    expect(() => schema.last_id.parse(1)).not.toThrow();
    expect(() => schema.last_id.parse(undefined)).not.toThrow(); // Optional
    expect(() => schema.last_id.parse(0)).toThrow(); // below min
    expect(() => schema.last_id.parse(-1)).toThrow(); // negative
    expect(() => schema.last_id.parse(3.14)).toThrow();
    expect(() => schema.last_id.parse("12345")).toThrow();
  });

  it("should format response as compact valid JSON", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce(mockSuccessfulListOccurrencesResponse);

    const result = await toolHandler({ counter: 42, page: 1, limit: 3 });

    // Check that it's valid JSON
    const parsedText = JSON.parse(result.content[0].text);
    expect(parsedText).toBeTruthy();
    expect(parsedText.page).toBe(1);
    expect(result.content[0].text).toBe(JSON.stringify(parsedText));
  });

  it("should handle empty instances array", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce({
        err: 0,
        result: { page: 1, instances: [] },
      });

    const result = await toolHandler({ counter: 42, page: 1, limit: 3 });

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData).toHaveProperty("page", 1);
    expect(responseData.instances).toHaveLength(0);
  });

  it("should handle unknown error code without message", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce({
      err: 99,
    });

    await expect(toolHandler({ counter: 42 })).rejects.toThrow(
      "Rollbar API returned error: Unknown error (code: 99)"
    );
  });
});
