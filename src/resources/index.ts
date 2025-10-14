import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReplayResource } from "./replay-resource.js";

export function registerAllResources(server: McpServer) {
  registerReplayResource(server);
}

export {
  buildReplayResourceUri,
  cacheReplayData,
  fetchReplayData,
} from "./replay-resource.js";

