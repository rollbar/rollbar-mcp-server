import dotenv from "dotenv";
import packageJson from "../package.json" with { type: "json" };

// Load environment variables from .env file
// `quiet: true` to prevent logging to stdio which disrupts some mcp clients
dotenv.config({ quiet: true });

const DEFAULT_ROLLBAR_API_BASE = "https://api.rollbar.com/api/1";

export const ROLLBAR_API_BASE = resolveRollbarApiBase();
export function getUserAgent(toolName: string): string {
  return `rollbar-mcp-server/${packageJson.version} (tool: ${toolName})`;
}
export const ROLLBAR_ACCESS_TOKEN = process.env.ROLLBAR_ACCESS_TOKEN;

if (!ROLLBAR_ACCESS_TOKEN) {
  console.error(
    "Error: ROLLBAR_ACCESS_TOKEN is not set in env var or .env file",
  );
  process.exit(1);
}

function resolveRollbarApiBase(): string {
  const envValue = process.env.ROLLBAR_API_BASE?.trim();
  if (!envValue || envValue.length === 0) {
    return DEFAULT_ROLLBAR_API_BASE;
  }

  const sanitizedValue = envValue.replace(/\/+$/, "");

  if (sanitizedValue.length === 0) {
    console.error("Error: ROLLBAR_API_BASE must be a non-empty URL");
    process.exit(1);
  }

  try {
    const parsedUrl = new URL(sanitizedValue);
    if (!["https:", "http:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid protocol");
    }
    return sanitizedValue;
  } catch {
    console.error(
      `Error: ROLLBAR_API_BASE must be a valid HTTP(S) URL. Received "${envValue}".`,
    );
    process.exit(1);
  }
}
