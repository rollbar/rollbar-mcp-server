import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProject } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { buildProjectParam } from "../utils/project-params.js";
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
      project: buildProjectParam(),
    },
    async ({ limit, project }) => {
      const { token, apiBase } = resolveProject(project);
      const deploysUrl = `${apiBase}/deploys?limit=${limit}`;
      const deploysResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarDeployResponse>
      >(deploysUrl, "get-deployments", token);

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
