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
      const deploysUrl = `${ROLLBAR_API_BASE}/deploys?limit=${limit}`;
      const deploysResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarDeployResponse>
      >(deploysUrl, "get-deployments");

      if (deploysResponse.err !== 0) {
        const errorMessage =
          deploysResponse.message ||
          `Unknown error (code: ${deploysResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const deployments = deploysResponse.result;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(deployments),
          },
        ],
      };
    },
  );
}
