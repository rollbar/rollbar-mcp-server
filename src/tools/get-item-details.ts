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
      try {
        // Redirects are followed, so we get an item response from the counter request
        const counterUrl = `${ROLLBAR_API_BASE}/item_by_counter/${counter}`;
        const itemResponse =
          await makeRollbarRequest<RollbarApiResponse<RollbarItemResponse>>(
            counterUrl,
          );
        console.error(itemResponse);

        if (!itemResponse || itemResponse.err !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to retrieve item details for counter ${counter}.`,
              },
            ],
          };
        }

        const item = itemResponse.result;

        // Use the complete item data
        const formattedData = item;

        const occurrenceUrl = `${ROLLBAR_API_BASE}/instance/${item.last_occurrence_id}`;
        console.error(`Fetching occurrence details from: ${occurrenceUrl}`);
        const occurrenceResponse =
          await makeRollbarRequest<
            RollbarApiResponse<RollbarOccurrenceResponse>
          >(occurrenceUrl);
        console.error("Occurrence response:", occurrenceResponse);

        if (!occurrenceResponse || occurrenceResponse.err !== 0) {
          // We got the item but failed to get occurrence, return just the item data
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(formattedData, null, 2),
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
          ...formattedData,
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
      } catch (error) {
        console.error("Error in get-item-details tool:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving item details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
