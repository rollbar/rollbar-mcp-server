import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PROJECTS } from "../config.js";

export function registerListProjectsTool(server: McpServer) {
  server.tool(
    "list-projects",
    "List configured Rollbar projects available to this MCP server",
    {},
    () => {
      const projects = PROJECTS.map((p) => ({
        name: p.name,
        apiBase: p.apiBase,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(projects) }],
      };
    },
  );
}
