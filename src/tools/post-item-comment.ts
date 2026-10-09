import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAuthContext } from "../config.js";
import type {
  RollbarApiResponse,
  RollbarItemCommentResponse,
} from "../types/index.js";
import { makeRollbarRequest } from "../utils/api.js";
import {
  itemSelectorParams,
  parseItemSelector,
  resolveItemId,
} from "../utils/item.js";
import { injectProjectIdQueryParam } from "../utils/params.js";
import { buildProjectParam } from "../utils/project-params.js";
import { getRollbarResult } from "../utils/response.js";

export function registerPostItemCommentTool(server: McpServer) {
  server.registerTool(
    "post-item-comment",
    {
      description:
        "Post a comment as the connected Rollbar user. Requires a configured user token with read and write scope and project comment permission. May notify subscribers. The backend limits the full stored comment data to 65,535 bytes. Do not automatically retry an uncertain result: this operation is not idempotent.",
      inputSchema: {
        ...itemSelectorParams,
        project: buildProjectParam(),
        comment: z
          .string()
          .refine((text) => text.trim().length > 0, "Comment must not be blank")
          .describe(
            "Comment text. Author identity is taken from the connected user's token.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ item_id, counter, project, comment }) => {
      const selector = parseItemSelector({ item_id, counter });
      const auth = await resolveAuthContext(project, {
        requireUserToken: true,
      });
      const id = await resolveItemId(selector, auth, "post-item-comment");
      const url = injectProjectIdQueryParam(
        `${auth.apiBase}/item/${id}/comments`,
        auth,
      );
      const response = await makeRollbarRequest<
        RollbarApiResponse<RollbarItemCommentResponse>
      >(url, "post-item-comment", auth.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      const result = getRollbarResult(response, "comment");
      if (!Number.isSafeInteger(result.id) || result.id <= 0) {
        throw new Error("Invalid Rollbar API response: missing comment ID");
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
