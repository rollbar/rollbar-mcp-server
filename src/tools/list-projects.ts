import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PROJECTS, getAccountModeInfo } from "../config.js";
import { getProjects } from "../utils/projects-cache.js";

export function registerListProjectsTool(server: McpServer) {
  server.tool(
    "list-projects",
    "List configured Rollbar projects available to this MCP server",
    {},
    async () => {
      const accountMode = await getAccountModeInfo();

      if (accountMode.active && accountMode.token && accountMode.apiBase) {
        const projects = await getProjects(
          accountMode.token,
          accountMode.apiBase,
        );
        const result = projects.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

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
