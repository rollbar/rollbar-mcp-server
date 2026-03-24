import { z } from "zod";
import { PROJECTS } from "../config.js";

export function buildProjectParam() {
  if (PROJECTS.length === 1) {
    return z
      .string()
      .optional()
      .describe("Project name (optional when only one project is configured)");
  }
  const names = PROJECTS.map((p) => p.name) as [string, ...string[]];
  return z.enum(names).describe(`Project name. One of: ${names.join(", ")}`);
}
