import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetItemDetailsTool } from "./get-item-details.js";
import { registerGetDeploymentsTool } from "./get-deployments.js";
import { registerGetVersionTool } from "./get-version.js";
import { registerGetTopItemsTool } from "./get-top-items.js";
import { registerListItemsTool } from "./list-items.js";
import { registerUpdateItemTool } from "./update-item.js";
import { registerGetReplayTool } from "./get-replay.js";
import { registerListProjectsTool } from "./list-projects.js";
import { registerListOccurrencesTool } from "./list-occurrences.js";
import { registerListItemEventsTool } from "./list-item-events.js";
import { registerPostItemCommentTool } from "./post-item-comment.js";

export function registerAllTools(server: McpServer) {
  registerGetItemDetailsTool(server);
  registerGetDeploymentsTool(server);
  registerGetVersionTool(server);
  registerGetTopItemsTool(server);
  registerListItemsTool(server);
  registerUpdateItemTool(server);
  registerGetReplayTool(server);
  registerListProjectsTool(server);
  registerListOccurrencesTool(server);
  registerListItemEventsTool(server);
  registerPostItemCommentTool(server);
}
