import dotenv from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import packageJson from "../package.json" with { type: "json" };
import { z } from "zod";

// Load environment variables from .env file
// `quiet: true` to prevent logging to stdio which disrupts some mcp clients
dotenv.config({ quiet: true } as Parameters<typeof dotenv.config>[0]);

const DEFAULT_ROLLBAR_API_BASE = "https://api.rollbar.com/api/1";

const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  token: z.string().min(1),
  apiBase: z.string().url().optional(),
});

const RollbarMcpConfigSchema = z.object({
  projects: z.array(ProjectConfigSchema).min(1),
});

// Single project shorthand (no name, no projects array)
const RollbarMcpConfigShorthandSchema = z.object({
  token: z.string().min(1),
  apiBase: z.string().url().optional(),
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
  const sanitized = value.replace(/\/+$/, "");
  if (sanitized.length === 0) {
    return DEFAULT_ROLLBAR_API_BASE;
  }
  try {
    const parsedUrl = new URL(sanitized);
    if (!["https:", "http:"].includes(parsedUrl.protocol)) {
      return DEFAULT_ROLLBAR_API_BASE;
    }
    return sanitized;
  } catch {
    return DEFAULT_ROLLBAR_API_BASE;
  }
}

function loadProjectsFromFile(filePath: string): ProjectConfig[] | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw) as unknown;

    // Try shorthand first
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

    const multi = RollbarMcpConfigSchema.safeParse(json);
    if (multi.success) {
      return multi.data.projects.map((p) => ({
        name: p.name,
        token: p.token,
        apiBase: normalizeApiBase(p.apiBase),
      }));
    }
  } catch {
    // Invalid JSON or read error
  }
  return null;
}

function loadConfig(): ProjectConfig[] {
  // 1. ROLLBAR_CONFIG_FILE env var
  const configFileEnv = process.env.ROLLBAR_CONFIG_FILE?.trim();
  if (configFileEnv) {
    const resolved = path.isAbsolute(configFileEnv)
      ? configFileEnv
      : path.resolve(process.cwd(), configFileEnv);
    const projects = loadProjectsFromFile(resolved);
    if (projects) {
      return projects;
    }
    console.error(
      `Error: ROLLBAR_CONFIG_FILE="${configFileEnv}" not found or invalid`,
    );
    process.exit(1);
  }

  // 2. .rollbar-mcp.json in process.cwd()
  const cwdPath = path.join(process.cwd(), ".rollbar-mcp.json");
  const fromCwd = loadProjectsFromFile(cwdPath);
  if (fromCwd) return fromCwd;

  // 3. ~/.rollbar-mcp.json
  const homePath = path.join(homedir(), ".rollbar-mcp.json");
  const fromHome = loadProjectsFromFile(homePath);
  if (fromHome) return fromHome;

  // 4. ROLLBAR_ACCESS_TOKEN env var — synthesize single project
  const token = process.env.ROLLBAR_ACCESS_TOKEN?.trim();
  if (token && token.length > 0) {
    const apiBase = resolveApiBaseFromEnv();
    if (apiBase === null) {
      console.error(
        "Error: ROLLBAR_API_BASE must be a valid HTTP(S) URL when using ROLLBAR_ACCESS_TOKEN.",
      );
      process.exit(1);
    }
    return [
      {
        name: "default",
        token,
        apiBase,
      },
    ];
  }

  console.error(
    "Error: No Rollbar configuration found. Set ROLLBAR_ACCESS_TOKEN, or create .rollbar-mcp.json (in cwd or home), or set ROLLBAR_CONFIG_FILE.",
  );
  process.exit(1);
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
