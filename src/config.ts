import "./load-env.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import packageJson from "../package.json" with { type: "json" };
import { z } from "zod";
import { getProjects, resolveProjectId } from "./utils/projects-cache.js";

const DEFAULT_ROLLBAR_API_BASE = "https://api.rollbar.com/api/1";

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsedUrl = new URL(value);
      return ["https:", "http:"].includes(parsedUrl.protocol);
    } catch {
      return false;
    }
  }, "Must be a valid HTTP(S) URL");

const ProjectConfigSchema = z
  .object({
    name: z.string().min(1),
    token: z.string().min(1),
  })
  .passthrough();

const RollbarMcpConfigSchema = z
  .object({
    projects: z.array(ProjectConfigSchema).min(1),
    apiBase: HttpUrlSchema.optional(),
    accountToken: z.string().min(1).optional(),
  })
  .passthrough()
  .refine((value) => !("token" in value), {
    message: 'Top-level "token" is not allowed when "projects" is present.',
  });

// Single project shorthand (no name, no projects array)
const RollbarMcpConfigShorthandSchema = z
  .object({
    token: z.string().min(1),
    apiBase: HttpUrlSchema.optional(),
    accountToken: z.string().min(1).optional(),
  })
  .passthrough()
  .refine((value) => !("projects" in value), {
    message: '"projects" is not allowed in single-project shorthand config.',
  });

// Account-token-only config (no project-token entries at all): just
// `{ "accountToken": "..." }`, optionally with `apiBase`. Neither the
// multi-project nor the shorthand schema matches this shape since both
// require a project token.
const RollbarMcpConfigAccountOnlySchema = z
  .object({
    accountToken: z.string().min(1),
    apiBase: HttpUrlSchema.optional(),
  })
  .passthrough()
  .refine((value) => !("projects" in value) && !("token" in value), {
    message:
      '"projects"/"token" are not allowed in an account-token-only config.',
  });

export interface ProjectConfig {
  name: string;
  token: string;
  apiBase: string;
}

export type AuthTokenType = "project" | "account";

export interface AuthContext {
  token: string;
  tokenType: AuthTokenType;
  projectId?: number;
  apiBase: string;
}

function resolveApiBaseFromEnv(): string | null {
  const envValue = process.env.ROLLBAR_API_BASE?.trim();
  if (!envValue || envValue.length === 0) {
    return DEFAULT_ROLLBAR_API_BASE;
  }
  const sanitizedValue = envValue.replace(/\/+$/, "");
  if (sanitizedValue.length === 0) {
    return null;
  }
  try {
    const parsedUrl = new URL(sanitizedValue);
    if (!["https:", "http:"].includes(parsedUrl.protocol)) {
      return null;
    }
    return sanitizedValue;
  } catch {
    return null;
  }
}

function normalizeApiBase(value: string | undefined): string {
  if (!value || value.length === 0) {
    return DEFAULT_ROLLBAR_API_BASE;
  }
  return value.replace(/\/+$/, "");
}

interface LoadedFileConfig {
  projects: ProjectConfig[];
  accountToken?: string;
  apiBase: string;
}

function loadProjectsFromFile(filePath: string): LoadedFileConfig | null {
  if (!existsSync(filePath)) {
    return null;
  }

  let json: unknown;

  try {
    const raw = readFileSync(filePath, "utf-8");
    json = JSON.parse(raw) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Invalid Rollbar config file "${filePath}": ${message}`);
  }

  const multi = RollbarMcpConfigSchema.safeParse(json);
  if (multi.success) {
    const sharedApiBase = normalizeApiBase(multi.data.apiBase);
    return {
      projects: multi.data.projects.map((p) => ({
        name: p.name,
        token: p.token,
        apiBase: sharedApiBase,
      })),
      accountToken: multi.data.accountToken,
      apiBase: sharedApiBase,
    };
  }

  const shorthand = RollbarMcpConfigShorthandSchema.safeParse(json);
  if (shorthand.success) {
    const apiBase = normalizeApiBase(shorthand.data.apiBase);
    return {
      projects: [
        {
          name: "default",
          token: shorthand.data.token,
          apiBase,
        },
      ],
      accountToken: shorthand.data.accountToken,
      apiBase,
    };
  }

  const accountOnly = RollbarMcpConfigAccountOnlySchema.safeParse(json);
  if (accountOnly.success) {
    return {
      projects: [],
      accountToken: accountOnly.data.accountToken,
      apiBase: normalizeApiBase(accountOnly.data.apiBase),
    };
  }

  throw new Error(
    `Invalid Rollbar config file "${filePath}": expected an account-only config like { "accountToken": "..." }, a single-project config like { "token": "..." }, or a multi-project config like { "projects": [...] }.`,
  );
}

function exitWithError(message: string): never {
  console.error(message);
  process.exit(1);
  return undefined as never;
}

function resolveAccountTokenFromEnv(): string | undefined {
  const envValue = process.env.ROLLBAR_ACCOUNT_ACCESS_TOKEN?.trim();
  return envValue && envValue.length > 0 ? envValue : undefined;
}

interface ResolvedConfig {
  projects: ProjectConfig[];
  accountToken?: string;
  apiBase: string;
  // True only when the single project in `projects` came from the legacy
  // ROLLBAR_ACCESS_TOKEN env var (loadConfig() step 4), as opposed to a
  // single-project config file/shorthand config. Only that legacy path
  // should ever trigger the lazy GET /projects probe — a single-project
  // config file is unambiguously project-token-only and must never make an
  // unsolicited network call.
  isLegacyEnvToken?: boolean;
}

function loadConfig(): ResolvedConfig {
  // 1. ROLLBAR_CONFIG_FILE env var
  const configFileEnv = process.env.ROLLBAR_CONFIG_FILE?.trim();
  if (configFileEnv) {
    const resolved = path.isAbsolute(configFileEnv)
      ? configFileEnv
      : path.resolve(process.cwd(), configFileEnv);
    try {
      const loaded = loadProjectsFromFile(resolved);
      if (loaded) {
        return {
          projects: loaded.projects,
          accountToken: loaded.accountToken ?? resolveAccountTokenFromEnv(),
          apiBase: loaded.apiBase,
        };
      }
    } catch (error) {
      return exitWithError(
        error instanceof Error ? error.message : "Invalid Rollbar config file",
      );
    }
    return exitWithError(
      `Error: ROLLBAR_CONFIG_FILE="${configFileEnv}" was not found.`,
    );
  }

  // 2. .rollbar-mcp.json in process.cwd()
  const cwdPath = path.join(process.cwd(), ".rollbar-mcp.json");
  try {
    const fromCwd = loadProjectsFromFile(cwdPath);
    if (fromCwd) {
      return {
        projects: fromCwd.projects,
        accountToken: fromCwd.accountToken ?? resolveAccountTokenFromEnv(),
        apiBase: fromCwd.apiBase,
      };
    }
  } catch (error) {
    return exitWithError(
      error instanceof Error ? error.message : "Invalid Rollbar config file",
    );
  }

  // 3. ~/.rollbar-mcp.json
  const homePath = path.join(homedir(), ".rollbar-mcp.json");
  try {
    const fromHome = loadProjectsFromFile(homePath);
    if (fromHome) {
      return {
        projects: fromHome.projects,
        accountToken: fromHome.accountToken ?? resolveAccountTokenFromEnv(),
        apiBase: fromHome.apiBase,
      };
    }
  } catch (error) {
    return exitWithError(
      error instanceof Error ? error.message : "Invalid Rollbar config file",
    );
  }

  // 4. ROLLBAR_ACCESS_TOKEN / ROLLBAR_ACCOUNT_ACCESS_TOKEN env vars
  const token = process.env.ROLLBAR_ACCESS_TOKEN?.trim();
  const accountToken = resolveAccountTokenFromEnv();

  if ((token && token.length > 0) || accountToken) {
    const apiBase = resolveApiBaseFromEnv();
    if (apiBase === null) {
      return exitWithError(
        "Error: ROLLBAR_API_BASE must be a valid HTTP(S) URL when using ROLLBAR_ACCESS_TOKEN.",
      );
    }

    // If only an account token is present (no project token), synthesize an
    // empty project list — resolveProject()'s account-mode path takes over.
    const projects: ProjectConfig[] =
      token && token.length > 0
        ? [
            {
              name: "default",
              token,
              apiBase,
            },
          ]
        : [];

    return {
      projects,
      accountToken,
      apiBase,
      isLegacyEnvToken: token !== undefined && token.length > 0,
    };
  }

  return exitWithError(
    "Error: No Rollbar configuration found. Set ROLLBAR_ACCESS_TOKEN or ROLLBAR_ACCOUNT_ACCESS_TOKEN, or create .rollbar-mcp.json (in cwd or home), or set ROLLBAR_CONFIG_FILE.",
  );
}

// exitWithError() calls process.exit(1), which in tests is mocked to be a
// no-op so execution can fall through; guard with a safe default so that
// case doesn't crash while process.exit is unwinding.
const resolvedConfig: ResolvedConfig = loadConfig() ?? {
  projects: [],
  apiBase: DEFAULT_ROLLBAR_API_BASE,
};

export const PROJECTS: ProjectConfig[] = resolvedConfig.projects;

const ACCOUNT_TOKEN: string | undefined = resolvedConfig.accountToken;

// Whether an explicit account token (env var or config file key) is
// configured. Used by buildProjectParam() to decide the `project` param's
// schema — a hybrid config (explicit project tokens + an account token) must
// not restrict `project` to just the explicitly-listed names, since the
// account token can also reach any other project on the account.
export const HAS_ACCOUNT_TOKEN: boolean = Boolean(ACCOUNT_TOKEN);

const DEFAULT_API_BASE: string = resolvedConfig.apiBase;
const IS_LEGACY_ENV_TOKEN: boolean = resolvedConfig.isLegacyEnvToken ?? false;

// Lazy probe-fallback state for the legacy ROLLBAR_ACCESS_TOKEN-only path.
// Determines, on first use, whether that single token is actually an
// account token (masquerading as a project token) by calling GET /projects.
// The result is cached for the process lifetime so we never probe twice.
type ProbeResult = "account" | "project";
let probePromise: Promise<ProbeResult> | undefined;

async function probeTokenType(
  token: string,
  apiBase: string,
): Promise<ProbeResult> {
  try {
    const response = await fetch(`${apiBase}/projects`, {
      headers: {
        "X-Rollbar-Access-Token": token,
        Accept: "application/json",
      },
    });
    if (response.ok) {
      return "account";
    }
    return "project";
  } catch (error) {
    console.error(
      `Warning: failed to probe Rollbar token type (${
        error instanceof Error ? error.message : "unknown network error"
      }). Falling back to project-token behavior.`,
    );
    return "project";
  }
}

/**
 * Resolves the single legacy-token project's auth context, lazily probing
 * GET /projects the first time it's needed to determine whether that token
 * is actually an account token. Only called when PROJECTS has exactly one
 * entry AND that entry came from the legacy ROLLBAR_ACCESS_TOKEN env var
 * (IS_LEGACY_ENV_TOKEN) — a single project from a config file/shorthand
 * config is unambiguously project-token-only and must never reach here.
 */
async function resolveLegacyTokenContext(
  legacyProject: ProjectConfig,
): Promise<AuthContext> {
  if (!probePromise) {
    probePromise = probeTokenType(legacyProject.token, legacyProject.apiBase);
  }
  const result = await probePromise;
  if (result === "account") {
    return {
      token: legacyProject.token,
      tokenType: "account",
      apiBase: legacyProject.apiBase,
    };
  }
  return {
    token: legacyProject.token,
    tokenType: "project",
    apiBase: legacyProject.apiBase,
  };
}

export function resolveProject(name: string | undefined): ProjectConfig {
  if (PROJECTS.length === 1 && name === undefined) {
    return PROJECTS[0];
  }
  if (name === undefined) {
    if (PROJECTS.length === 0) {
      throw new Error(
        "No project-token projects configured. This server is running in account-token mode; use resolveAuthContext() instead of resolveProject().",
      );
    }
    throw new Error(
      `Multiple projects configured. Specify a project name. Available: ${PROJECTS.map((p) => p.name).join(", ")}`,
    );
  }
  const found = PROJECTS.find((p) => p.name === name);
  if (!found) {
    throw new Error(
      `Unknown project "${name}". Available: ${PROJECTS.map((p) => p.name).join(", ")}`,
    );
  }
  return found;
}

/**
 * Resolves the auth context (token + tokenType + resolved projectId) for a
 * given `project` request parameter. This is the account-token-aware
 * counterpart to resolveProject(): callers that want project_id injection
 * support should use this instead.
 *
 * Precedence:
 *   a. An explicitly configured project with its own token, matching by
 *      name — unchanged from today's project-token behavior. Always wins.
 *   b. An account token (config `accountToken` or ROLLBAR_ACCOUNT_ACCESS_TOKEN)
 *      — resolves `project` (name or numeric id) against the projects cache.
 *   c. The legacy ROLLBAR_ACCESS_TOKEN-only path — lazily probes GET /projects
 *      once to determine whether it's actually an account token.
 */
export async function resolveAuthContext(
  project: string | undefined,
): Promise<AuthContext> {
  // (a) Explicit project-token config always wins for a named project.
  if (project !== undefined) {
    const explicit = PROJECTS.find((p) => p.name === project);
    if (explicit) {
      return {
        token: explicit.token,
        tokenType: "project",
        apiBase: explicit.apiBase,
      };
    }
  }

  // (b) Explicit account token present (env or config file key).
  if (ACCOUNT_TOKEN) {
    const projectId = await resolveProjectId(
      ACCOUNT_TOKEN,
      DEFAULT_API_BASE,
      project,
    );
    return {
      token: ACCOUNT_TOKEN,
      tokenType: "account",
      projectId,
      apiBase: DEFAULT_API_BASE,
    };
  }

  // (c) Legacy single ROLLBAR_ACCESS_TOKEN path — lazy probe fallback. Only
  // applies when the single project actually came from that env var; a
  // single-project config file/shorthand config is unambiguously
  // project-token-only and must never trigger the probe's network call.
  if (PROJECTS.length === 1 && IS_LEGACY_ENV_TOKEN) {
    const legacyContext = await resolveLegacyTokenContext(PROJECTS[0]);
    if (legacyContext.tokenType === "account") {
      const projectId = await resolveProjectId(
        legacyContext.token,
        legacyContext.apiBase,
        project,
      );
      return { ...legacyContext, projectId };
    }
    // Probed as a plain project token: route through resolveProject() so an
    // unknown/mismatched `project` name is rejected the same way it always
    // has been, instead of silently serving the one configured token
    // regardless of what project was actually requested.
    const validated = resolveProject(project);
    return {
      token: validated.token,
      tokenType: "project",
      apiBase: validated.apiBase,
    };
  }

  // Multiple project-token configs, no account token: fall back to the
  // existing named-project resolution (will throw a helpful error if the
  // name is missing/unknown, same as resolveProject()).
  const fallback = resolveProject(project);
  return {
    token: fallback.token,
    tokenType: "project",
    apiBase: fallback.apiBase,
  };
}

export interface AccountModeInfo {
  active: boolean;
  token?: string;
  apiBase?: string;
  /**
   * Number of enabled projects visible to the account token, fetched (and
   * cached) from GET /projects. Only present when `active` is true — undefined
   * otherwise. Callers that need to know "does this account resolve to
   * exactly one project" (e.g. the replay resource's single-vs-multi-project
   * guard) should use this instead of PROJECTS.length, which is always 0 in
   * account-token-only mode regardless of how many real projects exist.
   */
  enabledProjectCount?: number;
}

/**
 * Reports whether the server is currently operating in account-token mode
 * (an explicit accountToken/ROLLBAR_ACCOUNT_ACCESS_TOKEN, or a legacy
 * ROLLBAR_ACCESS_TOKEN that the lazy probe determined is actually an
 * account token) — used by tools/resources that need to branch on "am I
 * addressing one project or a whole account" without needing to resolve a
 * specific project id (e.g. list-projects, the replay resource's
 * single-vs-multi-project guard).
 */
export async function getAccountModeInfo(): Promise<AccountModeInfo> {
  if (ACCOUNT_TOKEN) {
    const projects = await getProjects(ACCOUNT_TOKEN, DEFAULT_API_BASE);
    return {
      active: true,
      token: ACCOUNT_TOKEN,
      apiBase: DEFAULT_API_BASE,
      enabledProjectCount: projects.length,
    };
  }

  if (PROJECTS.length === 1 && IS_LEGACY_ENV_TOKEN) {
    const legacyContext = await resolveLegacyTokenContext(PROJECTS[0]);
    if (legacyContext.tokenType === "account") {
      const projects = await getProjects(
        legacyContext.token,
        legacyContext.apiBase,
      );
      return {
        active: true,
        token: legacyContext.token,
        apiBase: legacyContext.apiBase,
        enabledProjectCount: projects.length,
      };
    }
  }

  return { active: false };
}

export function getUserAgent(toolName: string): string {
  return `rollbar-mcp-server/${packageJson.version} (tool: ${toolName})`;
}
