import { createRequire } from "module";
import { dirname, join } from "path";

// Import rollbar's truncation module using CommonJS require
const require = createRequire(import.meta.url);

// Define types for the rollbar truncation module
interface RollbarTruncation {
  truncate: (
    data: any,
    jsonBackup: (obj: any) => string,
    maxBytes: number,
  ) => { value: string };
}

// Load rollbar/src/truncation using require.
// TODO - remove this workaround once https://github.com/rollbar/rollbar.js/issues/1283 is fixed.
let truncation: RollbarTruncation;
try {
  // First try the direct import (works when running from source)
  truncation = require("rollbar/src/truncation") as RollbarTruncation;
} catch {
  // If that fails, resolve through the main module path
  // The main module is at rollbar/src/server/rollbar.js
  // So we need to go up to rollbar/src/ and then find truncation.js
  const rollbarPath = require.resolve("rollbar");
  const rollbarSrcDir = dirname(dirname(rollbarPath)); // Go up from src/server to src
  const truncationPath = join(rollbarSrcDir, "truncation.js");
  truncation = require(truncationPath) as RollbarTruncation;
}

// Token estimation constants
const CHARS_PER_TOKEN = 4; // Rough estimate: 1 token ≈ 4 characters

/**
 * Truncates an occurrence to fit within token limit
 * @param occurrence - The occurrence to truncate (like a 'payload' in rollbar.js; has a top-level 'data' key)
 * @param maxTokens - Maximum allowed tokens (default: 25000)
 * @returns Truncated data as a json object
 */
export function truncateOccurrence(
  occurrence: any,
  maxTokens: number = 25000,
): unknown {
  // Convert token limit to approximate byte size for rollbar truncation
  const maxBytes = maxTokens * CHARS_PER_TOKEN;

  // Use rollbar.js truncation with our calculated max size
  const result = truncation.truncate(occurrence, JSON.stringify, maxBytes);
  const truncatedPayload: unknown = JSON.parse(result.value);
  return truncatedPayload;
}
