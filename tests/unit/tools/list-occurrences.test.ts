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
  ROLLBAR_API_BASE: "https://api.rollbar.com/api/1",
  ROLLBAR_ACCESS_TOKEN: "test-token",
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
        lastId: expect.any(Object),
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
      "list-occurrences"
    );
    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=3&page=1",
      "list-occurrences"
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
      "list-occurrences"
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
      "list-occurrences"
    );

    const responseData = JSON.parse(result.content[0].text);
    expect(responseData).toHaveProperty("page", 2);
    expect(responseData.instances).toHaveLength(0);
  });

  it("should use lastId for pagination when provided", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce(mockSuccessfulItemResponse)
      .mockResolvedValueOnce({
        err: 0,
        result: { page: 1, instances: [{ id: 997 }] },
      });

    const result = await toolHandler({
      counter: 42,
      limit: 3,
      lastId: 998,
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/1/instances?limit=3&lastId=998",
      "list-occurrences"
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

  it("should handle null/undefined item response", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(null);

    await expect(toolHandler({ counter: 42 })).rejects.toThrow();
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
    expect(() => schema.counter.parse(0)).not.toThrow();
    expect(() => schema.counter.parse(-1)).not.toThrow();
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

    expect(() => schema.limit.parse(3)).not.toThrow();
    expect(() => schema.limit.parse(20)).not.toThrow();
    expect(() => schema.limit.parse(undefined)).not.toThrow(); // Optional
    expect(() => schema.limit.parse(3.14)).toThrow();
    expect(() => schema.limit.parse("3")).toThrow();
  });

  it("should validate lastId parameter with Zod schema", () => {
    const schemaCall = (server.tool as any).mock.calls[0];
    const schema = schemaCall[2];

    expect(() => schema.lastId.parse(12345)).not.toThrow();
    expect(() => schema.lastId.parse(undefined)).not.toThrow(); // Optional
    expect(() => schema.lastId.parse(3.14)).toThrow();
    expect(() => schema.lastId.parse("12345")).toThrow();
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
