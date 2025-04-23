import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { RollbarApiResponse, RollbarVersionsResponse } from "../types/index.js";

export function registerGetVersionTool(server: McpServer) {
  server.tool(
    "get-version",
    "Get version details for a Rollbar project",
    {
      version: z.coerce.string().describe("Version string (e.g. git sha)"),
      environment: z.coerce
        .string()
        .default("production")
        .describe("Environment name (default: production)"),
    },
    async ({ version, environment }) => {
      try {
        const versionsUrl = `${ROLLBAR_API_BASE}/versions/${version}?environment=${environment}`;
        const versionsResponse =
          await makeRollbarRequest<RollbarApiResponse<RollbarVersionsResponse>>(
            versionsUrl,
          );
        console.error(versionsResponse);

        if (!versionsResponse || versionsResponse.err !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to retrieve version data.`,
              },
            ],
          };
        }

        const versionItem = versionsResponse.result;
        console.error("Versions response:", versionItem);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(versionItem, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Error in get-versions tool:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving versions details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
