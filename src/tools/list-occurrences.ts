import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProject } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { buildProjectParam } from "../utils/project-params.js";
import {
  RollbarApiResponse,
  RollbarItemResponse,
  RollbarListOccurrencesResponse,
} from "../types/index.js";

export function registerListOccurrencesTool(server: McpServer) {
  server.tool(
    "list-occurrences",
    "List all occurrences for a Rollbar item",
    {
      counter: z
        .number()
        .int()
        .min(1)
        .describe("Rollbar item counter (must be >= 1)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(3)
        .describe(
          "Number of occurrences to return (default: 3, max: 100)",
        ),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Page number for pagination (default: 1)"),
      // Preferred API param name
      last_id: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "ID of last occurrence from previous page. Use for reliable pagination. Overrides page if both provided.",
        ),
      // Backward-compatible alias (deprecated) — will be ignored if last_id is provided
      lastId: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Deprecated: use last_id instead. If both last_id and lastId are provided, last_id takes precedence.",
        ),
      project: buildProjectParam(),
    },
    async ({ counter, limit, page, last_id, lastId, project }) => {
      const { token, apiBase } = resolveProject(project);

      const counterUrl = `${apiBase}/item_by_counter/${counter}`;
      const itemResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarItemResponse>
      >(counterUrl, "list-occurrences", token);

      if (
        !itemResponse ||
        typeof itemResponse !== "object" ||
        typeof (itemResponse as RollbarApiResponse<RollbarItemResponse>).err !==
          "number"
      ) {
        throw new Error(
          `Invalid API response while fetching item: ${counterUrl}`,
        );
      }

      if (itemResponse.err !== 0) {
        const errorMessage =
          itemResponse.message || `Unknown error (code: ${itemResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const item = itemResponse.result;
      if (!item || typeof item !== "object" || typeof item.id !== "number") {
        throw new Error(`Invalid API response from ${counterUrl}: missing item`);
      }

      const params = new URLSearchParams();
      params.set("limit", String(limit));
      const effectiveLastId = last_id ?? lastId;
      if (effectiveLastId !== undefined) {
        params.set("last_id", String(effectiveLastId));
      } else {
        params.set("page", String(page));
      }
      const occurrencesUrl = `${apiBase}/item/${item.id}/instances?${params.toString()}`;
      const occurrencesResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarListOccurrencesResponse>
      >(occurrencesUrl, "list-occurrences", token);

      if (
        !occurrencesResponse ||
        typeof occurrencesResponse !== "object" ||
        typeof (
          occurrencesResponse as RollbarApiResponse<RollbarListOccurrencesResponse>
        ).err !== "number"
      ) {
        throw new Error(
          `Invalid API response while listing occurrences: ${occurrencesUrl}`,
        );
      }

      if (occurrencesResponse.err !== 0) {
        const errorMessage =
          occurrencesResponse.message ||
          `Unknown error (code: ${occurrencesResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const occurrences = occurrencesResponse.result;
      if (
        !occurrences ||
        typeof occurrences !== "object" ||
        !Array.isArray(occurrences.instances)
      ) {
        throw new Error(
          `Invalid API response from ${occurrencesUrl}: missing instances`,
        );
      }

      const responseData = {
        page: occurrences.page,
        instances: occurrences.instances,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData),
          },
        ],
      };
    },
  );
}
