import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAuthContext } from "../config.js";
import {
  ITEM_EVENT_TYPES,
  type RollbarApiResponse,
  type RollbarListItemEventsResponse,
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

export function registerListItemEventsTool(server: McpServer) {
  server.registerTool(
    "list-item-events",
    {
      description:
        "List an item's history, oldest first, including system events. Requires read scope and project view permission. Omit type for all available event types. Resolve notes are in item_status_history.comment, not item_comment. This lists history, not error occurrences.",
      inputSchema: {
        ...itemSelectorParams,
        project: buildProjectParam(),
        type: z
          .array(z.enum(ITEM_EVENT_TYPES))
          .min(1)
          .optional()
          .describe(
            "Filter to these event types. Snooze history requires the account's snooze feature.",
          ),
        page: z
          .number()
          .int()
          .positive()
          .safe()
          .default(1)
          .describe("One-based page number (default 1). No cursor pagination."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(20)
          .describe(
            "Events per page (default 20, max 5000). Lower this for smaller responses; events are never dropped or truncated.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ item_id, counter, project, type, page, limit }) => {
      const selector = parseItemSelector({ item_id, counter });
      const auth = await resolveAuthContext(project);
      const id = await resolveItemId(selector, auth, "list-item-events");
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      for (const eventType of type ?? []) params.append("type", eventType);
      const url = injectProjectIdQueryParam(
        `${auth.apiBase}/item/${id}/events?${params}`,
        auth,
      );
      const response = await makeRollbarRequest<
        RollbarApiResponse<RollbarListItemEventsResponse>
      >(url, "list-item-events", auth.token);
      const result = getRollbarResult(response, "events");
      if (!Array.isArray(result.events)) {
        throw new Error("Invalid Rollbar API response: missing events array");
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
}
