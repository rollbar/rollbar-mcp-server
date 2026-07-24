import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAuthContext } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { buildProjectParam } from "../utils/project-params.js";
import { injectProjectIdQueryParam } from "../utils/params.js";
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
      const auth = await resolveAuthContext(project);
      const { token, apiBase } = auth;
      const deploysUrl = injectProjectIdQueryParam(
        `${apiBase}/deploys?limit=${limit}`,
        auth,
      );
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
