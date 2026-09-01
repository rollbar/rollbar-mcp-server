import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListItemCommentsTool } from "../../../src/tools/list-item-comments.js";

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
  resolveAuthContext: vi.fn(async () => ({
    token: "test-token",
    tokenType: "project",
    apiBase: "https://api.rollbar.com/api/1",
  })),
  getUserAgent: (toolName: string) =>
    `rollbar-mcp-server/test (tool: ${toolName})`,
}));

const commentsResponse = {
  err: 0,
  result: {
    comments: [
      {
        id: 11,
        type: "comment",
        item_id: 1,
        user_id: 2,
        username: "Ada",
        timestamp: 1_700_000_000,
        text: "Investigating",
      },
    ],
    page: 1,
    total_count: 1,
  },
};

describe("list-item-comments tool", () => {
  let server: McpServer;
  let toolHandler: (args: Record<string, unknown>) => Promise<any>;
  let makeRollbarRequestMock: any;

  beforeEach(async () => {
    const { makeRollbarRequest } = await import("../../../src/utils/api.js");
    makeRollbarRequestMock = makeRollbarRequest;
    server = {
      tool: vi.fn((_name, _description, _schema, handler) => {
        toolHandler = handler;
      }),
    } as any;
    registerListItemCommentsTool(server);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers the full parameter surface", () => {
    expect(server.tool).toHaveBeenCalledWith(
      "list-item-comments",
      expect.any(String),
      expect.objectContaining({
        counter: expect.any(Object),
        item_id: expect.any(Object),
        page: expect.any(Object),
        limit: expect.any(Object),
        type: expect.any(Object),
        max_tokens: expect.any(Object),
        project: expect.any(Object),
      }),
      expect.any(Function),
    );
  });

  it("resolves a counter before listing comments", async () => {
    makeRollbarRequestMock
      .mockResolvedValueOnce({ err: 0, result: { id: 1 } })
      .mockResolvedValueOnce(commentsResponse);

    const result = await toolHandler({
      counter: 42,
      page: 1,
      limit: 20,
    });

    expect(makeRollbarRequestMock).toHaveBeenNthCalledWith(
      1,
      "https://api.rollbar.com/api/1/item/?counter=42",
      "list-item-comments",
      "test-token",
    );
    expect(makeRollbarRequestMock).toHaveBeenNthCalledWith(
      2,
      "https://api.rollbar.com/api/1/item/1/comments?page=1&limit=20",
      "list-item-comments",
      "test-token",
    );
    expect(JSON.parse(result.content[0].text)).toEqual(commentsResponse.result);
  });

  it("uses item_id directly and passes pagination and type", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce(commentsResponse);

    await toolHandler({
      item_id: 123,
      page: 3,
      limit: 50,
      type: "resolve_note",
    });

    expect(makeRollbarRequestMock).toHaveBeenCalledTimes(1);
    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/123/comments?page=3&limit=50&type=resolve_note",
      "list-item-comments",
      "test-token",
    );
  });

  it("rejects calls with neither addressing mode", async () => {
    await expect(toolHandler({ page: 1, limit: 20 })).rejects.toThrow(
      "Provide exactly one of counter or item_id",
    );
    expect(makeRollbarRequestMock).not.toHaveBeenCalled();
  });

  it("rejects calls with both addressing modes", async () => {
    await expect(
      toolHandler({ counter: 42, item_id: 123, page: 1, limit: 20 }),
    ).rejects.toThrow("Provide exactly one of counter or item_id");
    expect(makeRollbarRequestMock).not.toHaveBeenCalled();
  });

  it("injects project_id into both requests in account mode", async () => {
    const { resolveAuthContext } = await import("../../../src/config.js");
    vi.mocked(resolveAuthContext).mockResolvedValueOnce({
      token: "account-token",
      tokenType: "account",
      projectId: 77,
      apiBase: "https://api.rollbar.com/api/1",
    });
    makeRollbarRequestMock
      .mockResolvedValueOnce({ err: 0, result: { id: 1 } })
      .mockResolvedValueOnce(commentsResponse);

    await toolHandler({
      counter: 42,
      page: 1,
      limit: 20,
      project: "backend",
    });

    expect(makeRollbarRequestMock).toHaveBeenNthCalledWith(
      1,
      "https://api.rollbar.com/api/1/item/?counter=42&project_id=77",
      "list-item-comments",
      "account-token",
    );
    expect(makeRollbarRequestMock).toHaveBeenNthCalledWith(
      2,
      "https://api.rollbar.com/api/1/item/1/comments?page=1&limit=20&project_id=77",
      "list-item-comments",
      "account-token",
    );
  });

  it("injects project_id for direct item_id addressing in account mode", async () => {
    const { resolveAuthContext } = await import("../../../src/config.js");
    vi.mocked(resolveAuthContext).mockResolvedValueOnce({
      token: "account-token",
      tokenType: "account",
      projectId: 77,
      apiBase: "https://api.rollbar.com/api/1",
    });
    makeRollbarRequestMock.mockResolvedValueOnce(commentsResponse);

    await toolHandler({ item_id: 123, page: 1, limit: 20 });

    expect(makeRollbarRequestMock).toHaveBeenCalledWith(
      "https://api.rollbar.com/api/1/item/123/comments?page=1&limit=20&project_id=77",
      "list-item-comments",
      "account-token",
    );
  });

  it("returns an empty comments page unchanged", async () => {
    const empty = {
      err: 0,
      result: { comments: [], page: 2, total_count: 0 },
    };
    makeRollbarRequestMock.mockResolvedValueOnce(empty);

    const result = await toolHandler({ item_id: 123, page: 2, limit: 20 });

    expect(JSON.parse(result.content[0].text)).toEqual(empty.result);
  });

  it("surfaces API errors and malformed responses with distinct messages", async () => {
    makeRollbarRequestMock.mockResolvedValueOnce({
      err: 1,
      result: null,
      message: "Invalid comment type",
    });
    await expect(
      toolHandler({ item_id: 123, page: 1, limit: 20 }),
    ).rejects.toThrow("Rollbar API returned error: Invalid comment type");

    // Transport-level malformation: non-object body
    makeRollbarRequestMock.mockResolvedValueOnce(null);
    await expect(
      toolHandler({ item_id: 123, page: 1, limit: 20 }),
    ).rejects.toThrow("non-object response");

    // Success envelope with no result at all
    makeRollbarRequestMock.mockResolvedValueOnce({ err: 0, result: null });
    await expect(
      toolHandler({ item_id: 123, page: 1, limit: 20 }),
    ).rejects.toThrow("missing comments");

    // Success envelope whose result lacks the comments array
    makeRollbarRequestMock.mockResolvedValueOnce({
      err: 0,
      result: { page: 1, total_count: 0 },
    });
    await expect(
      toolHandler({ item_id: 123, page: 1, limit: 20 }),
    ).rejects.toThrow("missing comments array");
  });

  describe("max_tokens truncation", () => {
    const makeComment = (id: number, textLength: number) => ({
      id,
      type: "comment",
      item_id: 1,
      user_id: 2,
      username: "Ada",
      timestamp: 1_700_000_000 + id,
      text: "x".repeat(textLength),
    });

    it("returns the page unchanged when it fits the budget", async () => {
      makeRollbarRequestMock.mockResolvedValueOnce(commentsResponse);

      const result = await toolHandler({
        item_id: 123,
        page: 1,
        limit: 20,
        max_tokens: 1000,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(commentsResponse.result);
      expect(parsed._truncation).toBeUndefined();
    });

    it("keeps every comment and elides the longest texts when over budget", async () => {
      const comments = [
        makeComment(1, 1800),
        makeComment(2, 1800),
        makeComment(3, 1800),
      ];
      makeRollbarRequestMock.mockResolvedValueOnce({
        err: 0,
        result: { comments, page: 1, total_count: 3 },
      });

      // max_tokens=1000 => 4000-char budget; three ~1900-char comments do
      // not fit, so the largest texts are elided until the page does.
      const result = await toolHandler({
        item_id: 123,
        page: 1,
        limit: 20,
        max_tokens: 1000,
      });

      const text = result.content[0].text;
      expect(text.length).toBeLessThanOrEqual(4000);
      const parsed = JSON.parse(text);
      expect(parsed.comments).toHaveLength(3);
      expect(parsed.comments.map((c: any) => c.id)).toEqual([1, 2, 3]);
      expect(parsed.total_count).toBe(3);
      expect(parsed._truncation.comments_on_page).toBe(3);
      expect(parsed._truncation.comments_with_truncated_text).toBeGreaterThan(
        0,
      );
      const elided = parsed.comments.filter((c: any) => c.text_truncated);
      expect(elided).toHaveLength(
        parsed._truncation.comments_with_truncated_text,
      );
      for (const comment of elided) {
        expect(comment.text).toHaveLength(200);
      }
    });

    it("elides a single oversized comment instead of dropping it", async () => {
      makeRollbarRequestMock.mockResolvedValueOnce({
        err: 0,
        result: { comments: [makeComment(1, 5000)], page: 1, total_count: 1 },
      });

      const result = await toolHandler({
        item_id: 123,
        page: 1,
        limit: 20,
        max_tokens: 1000,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.comments).toHaveLength(1);
      expect(parsed.comments[0].text).toHaveLength(200);
      expect(parsed.comments[0].text_truncated).toBe(true);
      expect(parsed._truncation.comments_with_truncated_text).toBe(1);
      expect(parsed._truncation.comments_on_page).toBe(1);
    });

    it("fails with actionable guidance when even elided text cannot fit the page", async () => {
      const comments = Array.from({ length: 60 }, (_, i) =>
        makeComment(i + 1, 250),
      );
      makeRollbarRequestMock.mockResolvedValueOnce({
        err: 0,
        result: { comments, page: 1, total_count: 60 },
      });

      await expect(
        toolHandler({ item_id: 123, page: 1, limit: 60, max_tokens: 1000 }),
      ).rejects.toThrow("Lower limit or raise max_tokens");
    });
  });
});
