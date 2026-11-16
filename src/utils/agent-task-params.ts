import { z } from "zod";

/** Opaque run IDs used as a URL path segment by the agent-task tools. */
export const taskSessionIdSchema = z
  .string()
  .refine(
    (id) => id.trim().length > 0 && id !== "." && id !== "..",
    "Task session ID must not be blank or a dot-only path segment",
  );
