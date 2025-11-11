import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import {
  RollbarApiResponse,
  RollbarListItemsResponse,
} from "../types/index.js";

export function registerListItemsTool(server: McpServer) {
  server.tool(
    "list-items",
    "List all items in the Rollbar project with optional search and filtering",
    {
      status: z
        .string()
        .optional()
        .default("active")
        .describe(
          "Filter by item status (e.g., 'active', 'resolved', 'muted') (default: 'active')",
        ),
      level: z
        .array(z.string())
        .optional()
        .describe(
          "Filter by severity levels (e.g., ['error', 'critical', 'warning'])",
        ),
      environment: z
        .string()
        .optional()
        .default("production")
        .describe(
          "Filter by environment (e.g., 'production', 'staging') (default: 'production')",
        ),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe("Page number for pagination (default: 1)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .optional()
        .default(20)
        .describe("Number of items per page (default: 20, max: 5000)"),
      query: z
        .string()
        .optional()
        .describe("Search query to filter items by title or content"),
    },
    async ({
      status,
      level,
      environment,
      page,
      limit,
      query,
    }: {
      status?: string;
      level?: string[];
      environment?: string;
      page?: number;
      limit?: number;
      query?: string;
    }) => {
      // Build query parameters
      const params = new URLSearchParams();

      if (status) {
        params.append("status", status);
      }

      if (level && level.length > 0) {
        level.forEach((l) => params.append("level", l));
      }

      if (environment) {
        params.append("environment", environment);
      }

      if (page && page > 1) {
        params.append("page", page.toString());
      }

      if (limit) {
        params.append("limit", limit.toString());
      }

      if (query) {
        params.append("q", query);
      }

      const listUrl = `${ROLLBAR_API_BASE}/items/?${params.toString()}`;

      const listResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarListItemsResponse>
      >(listUrl, "list-items");

      if (listResponse.err !== 0) {
        const errorMessage =
          listResponse.message || `Unknown error (code: ${listResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const itemsData = listResponse.result;

      // Format the response to include pagination info and items
      const formattedResponse = {
        items: itemsData.items,
        pagination: {
          page: itemsData.page,
          total_count: itemsData.total_count,
          items_on_page: itemsData.items.length,
        },
        filters_applied: {
          status: status || null,
          level: level || null,
          environment: environment || null,
          query: query || null,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formattedResponse),
          },
        ],
      };
    },
  );
}
