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

// Text length kept when a comment's text has to be elided to fit the budget.
const ELIDED_TEXT_CHARS = 200;

// Every comment on the page is always returned (the API paginates by limit,
// so dropping entries here would make them unreachable via page); over
// budget, the longest texts are shortened instead and flagged.
function elideCommentText(
  comment: RollbarItemCommentResponse,
): RollbarItemCommentResponse {
  if (
    typeof comment.text !== "string" ||
    comment.text.length <= ELIDED_TEXT_CHARS
  ) {
    return comment;
  }
  return {
    ...comment,
    text: comment.text.slice(0, ELIDED_TEXT_CHARS),
    text_truncated: true,
  };
}

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
          "Target budget for the complete response, in tokens (default: 20000, minimum: 1000; approx. max_tokens*4 characters). Every comment on the page is always returned in chronological order; when the page does not fit, the longest comment texts are shortened (marked with text_truncated) and a top-level _truncation field reports how many were shortened. If even shortened text cannot fit the page, the call fails asking you to lower limit or raise max_tokens.",
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
      // page, so bound the response like the sibling item tools do. The API
      // paginates by limit before this tool runs, so entries are never
      // dropped (a dropped entry would be unreachable via page); the longest
      // texts are elided instead, largest savings first.
      let text = JSON.stringify(result);
      const budgetChars = max_tokens * CHARS_PER_TOKEN;
      if (text.length > budgetChars) {
        const savingsByIndex = result.comments
          .map((comment, index) => {
            const fullChars = JSON.stringify(comment).length;
            const elidedChars = JSON.stringify(
              elideCommentText(comment),
            ).length;
            return { index, savings: fullChars - elidedChars };
          })
          .sort((a, b) => b.savings - a.savings);

        const comments = [...result.comments];
        let projectedChars = text.length + ENVELOPE_OVERHEAD_CHARS;
        let elidedCount = 0;
        for (const { index, savings } of savingsByIndex) {
          if (projectedChars <= budgetChars || savings <= 0) {
            break;
          }
          comments[index] = elideCommentText(comments[index]);
          projectedChars -= savings;
          elidedCount += 1;
        }

        if (projectedChars > budgetChars) {
          throw new Error(
            `The requested page of ${result.comments.length} comments does not fit within max_tokens=${max_tokens} even with comment text elided. Lower limit or raise max_tokens.`,
          );
        }

        text = JSON.stringify({
          ...result,
          comments,
          _truncation: {
            comments_on_page: result.comments.length,
            comments_with_truncated_text: elidedCount,
            note: "Every comment on this page is present and in order, but the longest comment texts were shortened to fit within max_tokens (marked with text_truncated). Raise max_tokens, or lower limit and re-request, to see full text.",
          },
        });
      }

      return {
        content: [{ type: "text" as const, text }],
      };
    },
  );
}
