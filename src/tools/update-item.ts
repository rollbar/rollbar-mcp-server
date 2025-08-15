import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ROLLBAR_API_BASE } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { RollbarApiResponse } from "../types/index.js";

export function registerUpdateItemTool(server: McpServer) {
  server.tool(
    "update-item",
    "Update an item in Rollbar (status, level, title, assignment, etc.)",
    {
      itemId: z.number().int().describe("The ID of the item to update"),
      status: z
        .enum(["active", "resolved", "muted", "archived"])
        .optional()
        .describe("The new status for the item"),
      level: z
        .enum(["debug", "info", "warning", "error", "critical"])
        .optional()
        .describe("The new level for the item"),
      title: z.string().optional().describe("The new title for the item"),
      assignedUserId: z
        .number()
        .int()
        .optional()
        .describe("The ID of the user to assign the item to"),
      resolvedInVersion: z
        .string()
        .optional()
        .describe("The version in which the item was resolved"),
      snoozed: z
        .boolean()
        .optional()
        .describe("Whether the item should be snoozed (paid accounts only)"),
      teamId: z
        .number()
        .int()
        .optional()
        .describe(
          "The ID of the team to assign as owner (Advanced/Enterprise accounts only)",
        ),
    },
    async ({
      itemId,
      status,
      level,
      title,
      assignedUserId,
      resolvedInVersion,
      snoozed,
      teamId,
    }) => {
      const updateData: Record<string, unknown> = {};

      if (status !== undefined) updateData.status = status;
      if (level !== undefined) updateData.level = level;
      if (title !== undefined) updateData.title = title;
      if (assignedUserId !== undefined)
        updateData.assigned_user_id = assignedUserId;
      if (resolvedInVersion !== undefined)
        updateData.resolved_in_version = resolvedInVersion;
      if (snoozed !== undefined) updateData.snoozed = snoozed;
      if (teamId !== undefined) updateData.team_id = teamId;

      if (Object.keys(updateData).length === 0) {
        throw new Error("At least one field must be provided to update");
      }

      const url = `${ROLLBAR_API_BASE}/item/${itemId}`;
      const response = await makeRollbarRequest<RollbarApiResponse<unknown>>(
        url,
        "update-item",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updateData),
        },
      );

      if (response.err !== 0) {
        const errorMessage =
          response.message || `Unknown error (code: ${response.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.result, null, 2),
          },
        ],
      };
    },
  );
}
