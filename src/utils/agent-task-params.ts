import { z } from "zod";

/** Identify an item using the project and item number visible in its URL. */
export const listAgentTasksParamsSchema = z.object({
  project_slug: z
    .string()
    .refine((slug) => slug.trim().length > 0, "Project slug must not be blank")
    .describe("Project slug from the item URL."),
  item_counter: z
    .number()
    .int()
    .min(1)
    .max(4294967295)
    .describe(
      "Positive item number shown within the project, not the global item ID.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Maximum candidate runs per page (1–100; default 50). Permissions may reduce the returned count.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .max(4294967295)
    .optional()
    .describe(
      "Pagination offset (default 0). Use next_offset from the previous response, even when its tasks array is empty.",
    ),
});

export type ListAgentTasksParams = z.infer<typeof listAgentTasksParamsSchema>;

/** Opaque run IDs used as a URL path segment by the agent-task tools. */
export const taskSessionIdSchema = z
  .string()
  .refine(
    (id) => id.trim().length > 0 && id !== "." && id !== "..",
    "Task session ID must not be blank or a dot-only path segment",
  );
