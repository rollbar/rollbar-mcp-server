import { z } from "zod";

/** Identify exactly one RCA source; Mox selects the latest occurrence for an item. */
export const startRcaParamsSchema = z
  .object({
    source_occurrence_id: z
      .string()
      .refine((id) => id.trim().length > 0, "Occurrence ID must not be blank")
      .optional()
      .describe(
        "Occurrence ID as a string, not an item ID or counter. Pass decimal or hexadecimal IDs unchanged; never convert to a number. Supply this OR project_slug and item_counter.",
      ),
    project_slug: z
      .string()
      .refine(
        (slug) => slug.trim().length > 0,
        "Project slug must not be blank",
      )
      .optional()
      .describe(
        "Project slug from the item URL. Requires item_counter; cannot be combined with source_occurrence_id.",
      ),
    item_counter: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Positive item number shown within the project, not the global item ID. Requires project_slug; cannot be combined with source_occurrence_id.",
      ),
    continue_with_resolve: z
      .boolean()
      .default(false)
      .describe("Request Resolve after RCA completes. Defaults to false."),
  })
  .refine(
    ({ source_occurrence_id, project_slug, item_counter }) =>
      source_occurrence_id !== undefined
        ? project_slug === undefined && item_counter === undefined
        : project_slug !== undefined && item_counter !== undefined,
    "Provide either source_occurrence_id or both project_slug and item_counter, never both forms",
  );

export type StartRcaParams = z.infer<typeof startRcaParamsSchema>;

/** Opaque run IDs used as a URL path segment by the agent-task tools. */
export const taskSessionIdSchema = z
  .string()
  .refine(
    (id) => id.trim().length > 0 && id !== "." && id !== "..",
    "Task session ID must not be blank or a dot-only path segment",
  );
