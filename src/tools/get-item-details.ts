import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import {
  RollbarApiResponse,
  RollbarItemResponse,
  RollbarOccurrenceResponse,
} from "../types/index.js";

export function registerGetItemDetailsTool(server: McpServer) {
  server.tool(
    "get-item-details",
    "Get item details for a Rollbar item",
    {
      counter: z.number().int().describe("Rollbar item counter"),
    },
    async ({ counter }) => {
      // Redirects are followed, so we get an item response from the counter request
      const counterUrl = `${ROLLBAR_API_BASE}/item_by_counter/${counter}`;
      const itemResponse =
        await makeRollbarRequest<RollbarApiResponse<RollbarItemResponse>>(
          counterUrl,
        );

      if (itemResponse.err !== 0) {
        const errorMessage =
          itemResponse.message || `Unknown error (code: ${itemResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const item = itemResponse.result;

      const occurrenceUrl = `${ROLLBAR_API_BASE}/instance/${item.last_occurrence_id}`;
      const occurrenceResponse =
        await makeRollbarRequest<RollbarApiResponse<RollbarOccurrenceResponse>>(
          occurrenceUrl,
        );

      if (occurrenceResponse.err !== 0) {
        // We got the item but failed to get occurrence, return just the item data
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(item, null, 2),
            },
          ],
        };
      }

      const occurrence = occurrenceResponse.result;

      // Remove the metadata section from occurrence.data to avoid exposing sensitive information
      if (occurrence.data && occurrence.data.metadata) {
        delete occurrence.data.metadata;
      }

      // Combine item and occurrence data
      const responseData = {
        ...item,
        occurrence: occurrence,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData, null, 2),
          },
        ],
      };
    },
  );
}
