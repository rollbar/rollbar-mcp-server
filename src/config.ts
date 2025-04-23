import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

export const ROLLBAR_API_BASE = "https://api.rollbar.com/api/1";
export const USER_AGENT = "rollbar-mcp-server/0.0.1";
export const ROLLBAR_ACCESS_TOKEN = process.env.ROLLBAR_ACCESS_TOKEN;

if (!ROLLBAR_ACCESS_TOKEN) {
  console.error(
    "Error: ROLLBAR_ACCESS_TOKEN is not set in env var or .env file",
  );
  process.exit(1);
}
