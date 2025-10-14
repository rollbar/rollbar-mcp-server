import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildReplayResourceUri,
  cacheReplayData,
  fetchReplayData,
} from "../resources/index.js";

function buildResourceLinkDescription(
  environment: string,
  sessionId: string,
  replayId: string,
) {
  return `Session replay payload for session ${sessionId} (${environment}) replay ${replayId}.`;
}

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
      const replayData = await fetchReplayData(
        environment,
        sessionId,
        replayId,
      );

      const resourceUri = buildReplayResourceUri(
        environment,
        sessionId,
        replayId,
      );

      cacheReplayData(resourceUri, replayData);

      return {
        content: [
          {
            type: "text",
            text: `Replay ${replayId} for session ${sessionId} in ${environment} is available as ${resourceUri}. Use read-resource to download the JSON payload.`,
          },
          {
            type: "resource_link",
            name: resourceUri,
            title: `Replay ${replayId}`,
            uri: resourceUri,
            description: buildResourceLinkDescription(
              environment,
              sessionId,
              replayId,
            ),
            mimeType: "application/json",
          },
        ],
      };
    },
  );
}
