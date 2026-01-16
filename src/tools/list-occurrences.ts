import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import {
  RollbarApiResponse,
  RollbarItemResponse,
  RollbarListOccurrencesResponse,
} from "../types/index.js";

export function registerListOccurrencesTool(server: McpServer) {
  server.tool(
    "list-occurrences",
    "List all occurrences for a Rollbar item",
    {
      counter: z.number().int().describe("Rollbar item counter"),
      limit: z
        .number()
        .int()
        .optional()
        .default(3)
        .describe("Number of occurrences to return (default: 3, max: 20)"),
      page: z
        .number()
        .int()
        .optional()
        .default(1)
        .describe("Page number for pagination (default: 1)"),
      lastId: z
        .number()
        .int()
        .optional()
        .describe(
          "ID of last occurrence from previous page. Use for reliable pagination. Overrides page if both provided.",
        ),
    },
    async ({ counter, limit, page, lastId }) => {
      // Fetch item by counter to get item ID (redirects are followed)
      const counterUrl = `${ROLLBAR_API_BASE}/item_by_counter/${counter}`;
      const itemResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarItemResponse>
      >(counterUrl, "list-occurrences");

      if (itemResponse.err !== 0) {
        const errorMessage =
          itemResponse.message || `Unknown error (code: ${itemResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const item = itemResponse.result;

      // Fetch occurrences for the item
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (lastId !== undefined) {
        params.set("lastId", String(lastId));
      } else {
        params.set("page", String(page));
      }
      const occurrencesUrl = `${ROLLBAR_API_BASE}/item/${item.id}/instances?${params.toString()}`;
      const occurrencesResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarListOccurrencesResponse>
      >(occurrencesUrl, "list-occurrences");

      if (occurrencesResponse.err !== 0) {
        const errorMessage =
          occurrencesResponse.message ||
          `Unknown error (code: ${occurrencesResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const responseData = {
        page: occurrencesResponse.result.page,
        instances: occurrencesResponse.result.instances,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData),
          },
        ],
      };
    },
  );
}
