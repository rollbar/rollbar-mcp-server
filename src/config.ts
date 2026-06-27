import "./load-env.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import packageJson from "../package.json" assert { type: "json" };
import { z } from "zod";

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
  })
  .passthrough()
  .refine((value) => !("projects" in value), {
    message: '"projects" is not allowed in single-project shorthand config.',
  });

export interface ProjectConfig {
  name: string;
  token: string;
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

function loadProjectsFromFile(filePath: string): ProjectConfig[] | null {
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
    return multi.data.projects.map((p) => ({
      name: p.name,
      token: p.token,
      apiBase: sharedApiBase,
    }));
  }

  const shorthand = RollbarMcpConfigShorthandSchema.safeParse(json);
  if (shorthand.success) {
    const apiBase = normalizeApiBase(shorthand.data.apiBase);
    return [
      {
        name: "default",
        token: shorthand.data.token,
        apiBase,
      },
    ];
  }

  throw new Error(
    `Invalid Rollbar config file "${filePath}": expected either a single-project config like { "token": "..." } or a multi-project config like { "projects": [...] }.`,
  );
}

function throwConfigError(message: string): never {
  console.error(message);
  throw new Error(message);
}

function loadConfig(): ProjectConfig[] {
  // 1. ROLLBAR_CONFIG_FILE env var
  const configFileEnv = process.env.ROLLBAR_CONFIG_FILE?.trim();
  if (configFileEnv) {
    const resolved = path.isAbsolute(configFileEnv)
      ? configFileEnv
      : path.resolve(process.cwd(), configFileEnv);
    try {
      const projects = loadProjectsFromFile(resolved);
      if (projects) {
        return projects;
      }
    } catch (error) {
      return throwConfigError(
        error instanceof Error ? error.message : "Invalid Rollbar config file",
      );
    }
    return throwConfigError(
      `Error: ROLLBAR_CONFIG_FILE="${configFileEnv}" was not found.`,
    );
  }

  // 2. .rollbar-mcp.json in process.cwd()
  const cwdPath = path.join(process.cwd(), ".rollbar-mcp.json");
  try {
    const fromCwd = loadProjectsFromFile(cwdPath);
    if (fromCwd) return fromCwd;
  } catch (error) {
    return throwConfigError(
      error instanceof Error ? error.message : "Invalid Rollbar config file",
    );
  }

  // 3. ~/.rollbar-mcp.json
  const homePath = path.join(homedir(), ".rollbar-mcp.json");
  try {
    const fromHome = loadProjectsFromFile(homePath);
    if (fromHome) return fromHome;
  } catch (error) {
    return throwConfigError(
      error instanceof Error ? error.message : "Invalid Rollbar config file",
    );
  }

  // 4. ROLLBAR_ACCESS_TOKEN env var — synthesize single project
  const token = process.env.ROLLBAR_ACCESS_TOKEN?.trim();
  if (token && token.length > 0) {
    const apiBase = resolveApiBaseFromEnv();
    if (apiBase === null) {
      return throwConfigError(
        "Error: ROLLBAR_API_BASE must be a valid HTTP(S) URL when using ROLLBAR_ACCESS_TOKEN.",
      );
    }
    return [
      {
        name: "default",
        token,
        apiBase,
      },
    ];
  }

  return throwConfigError(
    "Error: No Rollbar configuration found. Set ROLLBAR_ACCESS_TOKEN, or create .rollbar-mcp.json (in cwd or home), or set ROLLBAR_CONFIG_FILE.",
  );
}

export const PROJECTS: ProjectConfig[] = loadConfig();

export function resolveProject(name: string | undefined): ProjectConfig {
  if (PROJECTS.length === 1 && name === undefined) {
    return PROJECTS[0];
  }
  if (name === undefined) {
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

export function getUserAgent(toolName: string): string {
  return `rollbar-mcp-server/${packageJson.version} (tool: ${toolName})`;
}
