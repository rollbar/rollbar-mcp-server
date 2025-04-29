import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { RollbarApiResponse, RollbarTopItemResponse } from "../types/index.js";

export function registerGetTopItemsTool(server: McpServer) {
  server.tool(
    "get-top-items",
    "Get list of top items in the Rollbar project",
    {
      environment: z.coerce
        .string()
        .default("production")
        .describe("Environment name (default: production)"),
    },
    async ({ environment }) => {
      try {
        const reportUrl = `${ROLLBAR_API_BASE}/reports/top_active_items?hours=24&environments=${environment}&sort=occurrences`;
        const reportResponse =
          await makeRollbarRequest<RollbarApiResponse<RollbarTopItemResponse>>(
            reportUrl,
          );
        console.error(reportResponse);

        if (!reportResponse || reportResponse.err !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to retrieve top item data.`,
              },
            ],
          };
        }

        const itemItem = reportResponse.result;
        console.error("Top items response:", itemItem);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(itemItem, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Error in get-topitems tool:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving top items details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
