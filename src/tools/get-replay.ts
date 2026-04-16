import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PROJECTS, resolveProject } from "../config.js";
import { buildProjectParam } from "../utils/project-params.js";
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

const DELIVERY_MODE = z.enum(["resource", "file"]);
const REPLAY_FILE_DIRECTORY = path.join(tmpdir(), "rollbar-mcp-replays");

function sanitizeForFilename(value: string) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-");
}

async function writeReplayToFile(
  replayData: unknown,
  environment: string,
  sessionId: string,
  replayId: string,
) {
  await mkdir(REPLAY_FILE_DIRECTORY, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const fileName = [
    "replay",
    sanitizeForFilename(environment),
    sanitizeForFilename(sessionId),
    sanitizeForFilename(replayId),
    uniqueSuffix,
  ]
    .filter(Boolean)
    .join("_")
    .replace(/_+/g, "_")
    .concat(".json");

  const filePath = path.join(REPLAY_FILE_DIRECTORY, fileName);
  await writeFile(filePath, JSON.stringify(replayData, null, 2), "utf8");
  return filePath;
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
      delivery: DELIVERY_MODE.optional().describe(
        "How to return the replay payload. Defaults to 'file' (writes JSON to a temp file); 'resource' returns a rollbar:// link.",
      ),
      project: buildProjectParam(),
    },
    async ({ environment, sessionId, replayId, delivery, project }) => {
      const deliveryMode = delivery ?? "file";
      const { token, apiBase } = resolveProject(project);

      if (deliveryMode === "resource" && PROJECTS.length > 1) {
        throw new Error(
          'delivery="resource" is not supported when multiple projects are configured. Use delivery="file" and specify the project parameter instead.',
        );
      }

      const replayData = await fetchReplayData(
        environment,
        sessionId,
        replayId,
        token,
        apiBase,
      );

      const resourceUri = buildReplayResourceUri(
        environment,
        sessionId,
        replayId,
      );

      cacheReplayData(resourceUri, replayData);

      if (deliveryMode === "file") {
        const filePath = await writeReplayToFile(
          replayData,
          environment,
          sessionId,
          replayId,
        );

        return {
          content: [
            {
              type: "text",
              text: `Replay ${replayId} for session ${sessionId} in ${environment} saved to ${filePath}. This file is not automatically deleted—remove it when finished or rerun with delivery="resource" for a rollbar:// link.`,
            },
          ],
        };
      }

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
