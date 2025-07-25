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
      const reportUrl = `${ROLLBAR_API_BASE}/reports/top_active_items?hours=24&environments=${environment}&sort=occurrences`;
      const reportResponse =
        await makeRollbarRequest<RollbarApiResponse<RollbarTopItemResponse>>(
          reportUrl,
        );

      if (reportResponse.err !== 0) {
        const errorMessage =
          reportResponse.message ||
          `Unknown error (code: ${reportResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const topItems = reportResponse.result;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(topItems, null, 2),
          },
        ],
      };
    },
  );
}
