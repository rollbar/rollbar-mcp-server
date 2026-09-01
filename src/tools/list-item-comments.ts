import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAuthContext } from "../config.js";
import {
  RollbarApiResponse,
  RollbarItemCommentResponse,
  RollbarListItemCommentsResponse,
} from "../types/index.js";
import { makeRollbarRequest } from "../utils/api.js";
import { getItemByCounter } from "../utils/item.js";
import { validateRollbarResponse } from "../utils/response.js";
import { injectProjectIdQueryParam } from "../utils/params.js";
import { buildProjectParam } from "../utils/project-params.js";
import { CHARS_PER_TOKEN } from "../utils/truncation.js";

// Fixed allowance for the response envelope (page, total_count, _truncation
// note) when fitting comments into the max_tokens character budget.
const ENVELOPE_OVERHEAD_CHARS = 300;

export function registerListItemCommentsTool(server: McpServer) {
  server.tool(
    "list-item-comments",
    "List comments and resolve notes for a Rollbar item",
    {
      counter: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Rollbar item counter; provide exactly one of counter or item_id",
        ),
      item_id: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Rollbar item id; provide exactly one of item_id or counter"),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Page number for pagination (default: 1)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .default(20)
        .describe("Number of comments to return (default: 20, max: 5000)"),
      type: z
        .enum(["comment", "resolve_note"])
        .optional()
        .describe("Filter to comments or resolve notes; omit to return both"),
      max_tokens: z
        .number()
        .int()
        .min(1000)
        .default(20000)
        .describe(
          "Target budget for the complete response, in tokens (default: 20000, minimum: 1000; approx. max_tokens*4 characters). Comments are kept whole and in chronological order; when the page does not fit, trailing comments are dropped and a top-level _truncation field reports how many of the page's comments were returned. Lower limit or raise max_tokens to adjust.",
        ),
      project: buildProjectParam(),
    },
    async ({ counter, item_id, page, limit, type, max_tokens, project }) => {
      if ((counter === undefined) === (item_id === undefined)) {
        throw new Error("Provide exactly one of counter or item_id");
      }

      const auth = await resolveAuthContext(project);
      const resolvedItemId =
        item_id ??
        (await getItemByCounter(counter!, auth, "list-item-comments")).id;

      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (type !== undefined) {
        params.append("type", type);
      }

      const commentsUrl = injectProjectIdQueryParam(
        `${auth.apiBase}/item/${resolvedItemId}/comments?${params.toString()}`,
        auth,
      );
      const response = await makeRollbarRequest<
        RollbarApiResponse<RollbarListItemCommentsResponse>
      >(commentsUrl, "list-item-comments", auth.token);

      const result = validateRollbarResponse(response, commentsUrl, "comments");
      if (!Array.isArray(result.comments)) {
        throw new Error(
          `Invalid API response from ${commentsUrl}: missing comments array`,
        );
      }

      // Comments are small individually but limit allows up to 5000 per
      // page, so bound the response like the sibling item tools do. Keep
      // comments whole and in order; drop from the tail when over budget.
      let text = JSON.stringify(result);
      const budgetChars = max_tokens * CHARS_PER_TOKEN;
      if (text.length > budgetChars) {
        const kept: RollbarItemCommentResponse[] = [];
        const commentBudget = budgetChars - ENVELOPE_OVERHEAD_CHARS;
        let used = 0;
        for (const comment of result.comments) {
          const commentChars = JSON.stringify(comment).length + 1;
          if (used + commentChars > commentBudget) {
            break;
          }
          kept.push(comment);
          used += commentChars;
        }
        text = JSON.stringify({
          ...result,
          comments: kept,
          _truncation: {
            returned_comments: kept.length,
            comments_on_page: result.comments.length,
            note: "Trailing comments on this page were dropped to fit within max_tokens. Raise max_tokens or lower limit to retrieve more; comments are chronological, so use page to continue.",
          },
        });
      }

      return {
        content: [{ type: "text" as const, text }],
      };
    },
  );
}
