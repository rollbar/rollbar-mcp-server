import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { RollbarApiResponse } from "../types/index.js";

export function registerGetReplayTool(server: McpServer) {
  server.tool(
    "get-replay",
    "Get replay data for a specific session replay in Rollbar",
    {
      environment: z
        .string()
        .min(1)
        .describe("Environment name (e.g., production)"),
      sessionId: z
        .string()
        .min(1)
        .describe("Session identifier that owns the replay"),
      replayId: z.string().min(1).describe("Replay identifier to retrieve"),
    },
    async ({ environment, sessionId, replayId }) => {
      const replayUrl = `${ROLLBAR_API_BASE}/environment/${encodeURIComponent(
        environment,
      )}/session/${encodeURIComponent(sessionId)}/replay/${encodeURIComponent(
        replayId,
      )}`;

      const replayResponse = await makeRollbarRequest<
        RollbarApiResponse<unknown>
      >(replayUrl, "get-replay");

      if (replayResponse.err !== 0) {
        const errorMessage =
          replayResponse.message ||
          `Unknown error (code: ${replayResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(replayResponse.result),
          },
        ],
      };
    },
  );
}
