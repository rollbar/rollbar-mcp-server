import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAuthContext } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { buildProjectParam } from "../utils/project-params.js";
import { injectProjectIdQueryParam } from "../utils/params.js";
import {
  RollbarApiResponse,
  RollbarItemResponse,
  RollbarOccurrenceResponse,
} from "../types/index.js";
import { truncateOccurrence } from "../utils/truncation.js";

export function registerGetItemDetailsTool(server: McpServer) {
  server.tool(
    "get-item-details",
    "Get item details for a Rollbar item",
    {
      counter: z.number().int().describe("Rollbar item counter"),
      max_tokens: z
        .number()
        .int()
        .optional()
        .default(20000)
        .describe(
          "Maximum tokens for occurrence data in response (default: 20000). Occurrence response will be truncated if it exceeds this limit.",
        ),
      project: buildProjectParam(),
    },
    async ({ counter, max_tokens, project }) => {
      const auth = await resolveAuthContext(project);
      const { token, apiBase } = auth;
      const counterUrl = injectProjectIdQueryParam(
        `${apiBase}/item?counter=${counter}`,
        auth,
      );
      const itemResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarItemResponse>
      >(counterUrl, "get-item-details", token);

      if (itemResponse.err !== 0) {
        const errorMessage =
          itemResponse.message || `Unknown error (code: ${itemResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const item = itemResponse.result;

      const occurrenceUrl = injectProjectIdQueryParam(
        `${apiBase}/instance/${item.last_occurrence_id}`,
        auth,
      );
      const occurrenceResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarOccurrenceResponse>
      >(occurrenceUrl, "get-item-details", token);

      if (occurrenceResponse.err !== 0) {
        // We got the item but failed to get occurrence. Return just the item data.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(item),
            },
          ],
        };
      }

      const occurrence = occurrenceResponse.result;

      // Remove the metadata section from occurrence.data
      if (occurrence.data && occurrence.data.metadata) {
        delete occurrence.data.metadata;
      }

      // Combine item and occurrence data
      const responseData = {
        ...item,
        occurrence: truncateOccurrence(occurrence, max_tokens),
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
