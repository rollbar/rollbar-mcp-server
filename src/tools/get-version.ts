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
      const versionsUrl = `${ROLLBAR_API_BASE}/versions/${version}?environment=${environment}`;
      const versionsResponse =
        await makeRollbarRequest<RollbarApiResponse<RollbarVersionsResponse>>(
          versionsUrl,
        );

      if (versionsResponse.err !== 0) {
        const errorMessage =
          versionsResponse.message ||
          `Unknown error (code: ${versionsResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const versionData = versionsResponse.result;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(versionData, null, 2),
          },
        ],
      };
    },
  );
}
