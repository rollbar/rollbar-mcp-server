import dotenv from "dotenv";
import packageJson from "../package.json" with { type: "json" };

// Load environment variables from .env file
// `quiet: true` to prevent logging to stdio which disrupts some mcp clients
dotenv.config({ quiet: true });

export const ROLLBAR_API_BASE = "https://api.rollbar.com/api/1";
export const USER_AGENT = `rollbar-mcp-server/${packageJson.version}`;
export const ROLLBAR_ACCESS_TOKEN = process.env.ROLLBAR_ACCESS_TOKEN;

if (!ROLLBAR_ACCESS_TOKEN) {
  console.error(
    "Error: ROLLBAR_ACCESS_TOKEN is not set in env var or .env file",
  );
  process.exit(1);
}
