import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProject } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { buildProjectParam } from "../utils/project-params.js";
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
      project: buildProjectParam(),
    },
    async ({ environment, project }) => {
      const { token, apiBase } = resolveProject(project);
      const reportUrl = `${apiBase}/reports/top_active_items?hours=24&environments=${environment}&sort=occurrences`;
      const reportResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarTopItemResponse>
      >(reportUrl, "get-top-items", token);

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
            text: JSON.stringify(topItems),
          },
        ],
      };
    },
  );
}
