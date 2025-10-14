import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  McpServer,
  ReadResourceTemplateCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { RollbarApiResponse } from "../types/index.js";

const REPLAY_URI_TEMPLATE =
  "rollbar://replay/{environment}/{sessionId}/{replayId}";
const REPLAY_RESOURCE_NAME = "rollbar-session-replay";
const REPLAY_RESOURCE_TITLE = "Rollbar Session Replay";
const REPLAY_MIME_TYPE = "application/json";
const CACHE_TTL_MS = 5 * 60 * 1000;

type ReplayCacheEntry = {
  data: unknown;
  expiresAt: number;
};

const replayCache = new Map<string, ReplayCacheEntry>();
const registeredServers = new WeakSet<McpServer>();

function normalizeTemplateVariable(
  value: string | string[] | undefined,
): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function buildReplayApiUrl(
  environment: string,
  sessionId: string,
  replayId: string,
): string {
  return `${ROLLBAR_API_BASE}/environment/${encodeURIComponent(
    environment,
  )}/session/${encodeURIComponent(sessionId)}/replay/${encodeURIComponent(
    replayId,
  )}`;
}

export function buildReplayResourceUri(
  environment: string,
  sessionId: string,
  replayId: string,
): string {
  return `rollbar://replay/${encodeURIComponent(
    environment,
  )}/${encodeURIComponent(sessionId)}/${encodeURIComponent(replayId)}`;
}

export function cacheReplayData(uri: string, data: unknown) {
  replayCache.set(uri, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function getCachedReplayData(uri: string) {
  const cached = replayCache.get(uri);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt < Date.now()) {
    replayCache.delete(uri);
    return undefined;
  }

  return cached.data;
}

export async function fetchReplayData(
  environment: string,
  sessionId: string,
  replayId: string,
): Promise<unknown> {
  const replayUrl = buildReplayApiUrl(environment, sessionId, replayId);

  const replayResponse = await makeRollbarRequest<RollbarApiResponse<unknown>>(
    replayUrl,
    "get-replay",
  );

  if (replayResponse.err !== 0) {
    const errorMessage =
      replayResponse.message || `Unknown error (code: ${replayResponse.err})`;
    throw new Error(`Rollbar API returned error: ${errorMessage}`);
  }

  return replayResponse.result;
}

const readReplayResource: ReadResourceTemplateCallback = async (
  uri,
  variables,
) => {
  const environmentValue = normalizeTemplateVariable(variables.environment);
  const sessionValue = normalizeTemplateVariable(variables.sessionId);
  const replayValue = normalizeTemplateVariable(variables.replayId);

  const environment = environmentValue
    ? decodeURIComponent(environmentValue)
    : "";
  const sessionId = sessionValue ? decodeURIComponent(sessionValue) : "";
  const replayId = replayValue ? decodeURIComponent(replayValue) : "";

  if (!environment || !sessionId || !replayId) {
    throw new Error("Invalid replay resource URI");
  }

  const resourceUri = buildReplayResourceUri(environment, sessionId, replayId);
  const cached = getCachedReplayData(resourceUri);

  const replayData =
    cached !== undefined
      ? cached
      : await fetchReplayData(environment, sessionId, replayId);

  if (cached === undefined) {
    cacheReplayData(resourceUri, replayData);
  }

  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: REPLAY_MIME_TYPE,
        text: JSON.stringify(replayData),
      },
    ],
  };
};

export function registerReplayResource(server: McpServer) {
  if (registeredServers.has(server)) {
    return;
  }

  const template = new ResourceTemplate(REPLAY_URI_TEMPLATE, {
    list: () => ({ resources: [] }),
  });

  server.resource(
    REPLAY_RESOURCE_NAME,
    template,
    {
      title: REPLAY_RESOURCE_TITLE,
      description:
        "Session replay payloads returned from the Rollbar Replay API.",
      mimeType: REPLAY_MIME_TYPE,
    },
    readReplayResource,
  );

  registeredServers.add(server);
}
