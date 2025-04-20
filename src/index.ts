import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ROLLBAR_API_BASE = "https://api.rollbar.com/api/1";
const USER_AGENT = "rollbar-mcp/0.0.1";

// Create server instance
const server = new McpServer({
  name: "rollbar",
  version: "0.0.1",
  capabilities: {
    resources: {},
    tools: {},
  },
});


// Helper function for making Rollbar API requests
async function makeRollbarRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    "X-Rollbar-Access-Token": "token",
    Accept: "application/json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making Rollbar API request:", error);
    return null;
  }
}

// Register tools
server.tool(
  "get-item-details",
  "Get item details for a Rollbar item",
  {
    counter: z.number().int().describe("Rollbar item counter"),
  },
  async ({ counter }) => {
    const url = `${ROLLBAR_API_BASE}/item_by_counter/${counter}`;
    const data = await makeRollbarRequest<any>(url);

    if (!data) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve item detail data",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: data,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rollbar MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
