import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { RollbarApiResponse, RollbarDeployResponse } from "../types/index.js";

export function registerGetDeploymentsTool(server: McpServer) {
  server.tool(
    "get-deployments",
    "Get deployments data from Rollbar",
    {
      limit: z
        .number()
        .int()
        .describe("Number of Rollbar deployments to retrieve"),
    },
    async ({ limit }) => {
      try {
        const deploysUrl = `${ROLLBAR_API_BASE}/deploys?limit=${limit}`;
        const deploysResponse =
          await makeRollbarRequest<RollbarApiResponse<RollbarDeployResponse>>(
            deploysUrl,
          );
        console.error(deploysResponse);

        if (!deploysResponse || deploysResponse.err !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to retrieve deployments.`,
              },
            ],
          };
        }

        const deployItem = deploysResponse.result;
        console.error("Deployments response:", deployItem);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(deployItem, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Error in get-deployments tool:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving deployment details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
