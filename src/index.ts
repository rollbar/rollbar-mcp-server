import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const ROLLBAR_API_BASE = "https://api.rollbar.com/api/1";
const USER_AGENT = "rollbar-mcp/0.0.1";
const ROLLBAR_ACCESS_TOKEN = process.env.ROLLBAR_ACCESS_TOKEN;

if (!ROLLBAR_ACCESS_TOKEN) {
  console.error("Error: ROLLBAR_ACCESS_TOKEN is not set in .env file");
  process.exit(1);
}

// Create server instance
const server = new McpServer({
  name: "rollbar",
  version: "0.0.1",
  capabilities: {
    resources: {},
    tools: {
      "get-item-details": {
        description: "Get detailed information about a Rollbar item by its counter",
      },
    },
  },
});


// Helper function for making Rollbar API requests
async function makeRollbarRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    "X-Rollbar-Access-Token": ROLLBAR_ACCESS_TOKEN as string,
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

// Define interfaces for Rollbar API responses
interface RollbarApiResponse<T> {
  err: number;
  result: T;
}

interface RollbarItemByCounterResponse {
  itemId: number;
  message?: string;
}

interface RollbarItemResponse {
  id: number;
  counter: number;
  environment: string;
  framework: string;
  title: string;
  timestamp: number;
  last_occurrence_id: number;
  last_occurrence_timestamp: number;
  level: string;
  project_id: number;
  language: string;
  platform: string;
  hash: string;
  exception?: any;
  request?: any;
  body?: any;
  data: {
    body: any;
    level: string;
    environment: string;
    framework: string;
    language: string;
    timestamp: number;
    platform: string;
    request?: {
      url: string;
      method: string;
    };
    exception?: {
      class: string;
      message: string;
      description: string;
    };
  };
}

interface RollbarOccurrenceResponse {
  id: number;
  item_id: number;
  timestamp: number;
  version: number;
  data: {
    body: any;
    level: string;
    environment: string;
    framework: string;
    language: string;
    timestamp: number;
    platform: string;
    request?: {
      url: string;
      method: string;
    };
    exception?: {
      class: string;
      message: string;
      description: string;
    };
    context?: string;
    code_version?: string;
    stack_trace?: any;
  };
}

// Register tools
server.tool(
  "get-item-details",
  "Get item details for a Rollbar item",
  {
    counter: z.number().int().describe("Rollbar item counter"),
  },
  async ({ counter }) => {
    try {
      // Redirects are followed, so we get an item response from the counter request
      const counterUrl = `${ROLLBAR_API_BASE}/item_by_counter/${counter}`;
      const itemResponse = await makeRollbarRequest<RollbarApiResponse<RollbarItemResponse>>(counterUrl);
      console.error(itemResponse);
      
      if (!itemResponse || itemResponse.err !== 0) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to retrieve item details for counter ${counter}.`,
            },
          ],
        };
      }
      
      const item = itemResponse.result;
      
      // Format the response as JSON string
      const formattedData = {
        id: item.id,
        project_id: item.project_id,
        counter: item.counter,
        title: item.title,
        level: item.level,
        environment: item.environment,
        last_occurrence_timestamp: item.last_occurrence_timestamp,
        last_occurrence_id: item.last_occurrence_id,
        language: item.language,
        platform: item.platform,
        framework: item.framework,
        hash: item.hash,
        exception: item.exception,
        request: item.request,
        body: item.body
      };

      const occurrenceUrl = `${ROLLBAR_API_BASE}/instance/${item.last_occurrence_id}`;
      console.error(`Fetching occurrence details from: ${occurrenceUrl}`);
      const occurrenceResponse = await makeRollbarRequest<RollbarApiResponse<RollbarOccurrenceResponse>>(occurrenceUrl);
      console.error("Occurrence response:", occurrenceResponse);
      
      if (!occurrenceResponse || occurrenceResponse.err !== 0) {
        // We got the item but failed to get occurrence, return just the item data
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(formattedData, null, 2)
            }
          ],
        };
      }
      
      const occurrence = occurrenceResponse.result;
      
      // Combine item and occurrence data
      const responseData = {
        ...formattedData,
        occurrence: occurrence
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData, null, 2)
          }
        ],
      };
    } catch (error) {
      console.error("Error in get-item-details tool:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving item details: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
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
