import { z } from "zod";
import { HAS_ACCOUNT_TOKEN, PROJECTS } from "../config.js";

export function buildProjectParam() {
  if (PROJECTS.length === 0 || HAS_ACCOUNT_TOKEN) {
    // Account-token mode (no project-token entries configured, or a hybrid
    // config combining explicit project tokens with an account token): the
    // set of valid project names/ids is dynamic (resolved from the account
    // token's GET /projects at call time) and/or includes projects beyond
    // whatever is explicitly listed, so it can't be constrained to a static
    // zod enum of just the configured names. Accept any string (name or
    // numeric id) and let resolveAuthContext()/resolveProjectId() validate
    // and report available names on a miss.
    return z
      .string()
      .optional()
      .describe(
        "Project name or numeric id (optional when the account has exactly one enabled project)",
      );
  }
  if (PROJECTS.length === 1) {
    return z
      .string()
      .optional()
      .describe("Project name (optional when only one project is configured)");
  }
  const names = PROJECTS.map((p) => p.name) as [string, ...string[]];
  return z.enum(names).describe(`Project name. One of: ${names.join(", ")}`);
}
