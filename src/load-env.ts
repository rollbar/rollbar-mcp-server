import dotenv from "dotenv";

// Keep dotenv quiet so MCP stdio stays clean for clients.
dotenv.config({ quiet: true } as Parameters<typeof dotenv.config>[0]);
