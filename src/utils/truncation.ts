import { createRequire } from "module";
import { dirname, join } from "path";

//
// -- Import rollbar's truncation module using CommonJS require --
//
// TODO - remove this workaround once https://github.com/rollbar/rollbar.js/issues/1283 is fixed.
const require = createRequire(import.meta.url);

// Define types for the rollbar truncation module
interface RollbarTruncation {
  truncate: (
    data: any,
    jsonBackup: (obj: any) => string,
    maxBytes: number,
  ) => { value: string };
}

// Type for the loaded module which might be in various formats
interface LoadedModule {
  truncate?: unknown;
  default?: unknown;
  __esModule?: boolean;
  [key: string]: unknown;
}

// Since rollbar 3.0.0-alpha.2 doesn't export the truncation subpath,
// we need to resolve through the main module path
// The main module is at rollbar/src/server/rollbar.js
// So we need to go up to rollbar/src/ and then find truncation.js
const rollbarPath = require.resolve("rollbar");
const rollbarSrcDir = dirname(dirname(rollbarPath)); // Go up from src/server to src
const truncationPath = join(rollbarSrcDir, "truncation.js");

// Use dynamic import to handle the module properly
// This is wrapped in an IIFE to handle the async nature
let truncation: RollbarTruncation = {
  truncate: () => {
    throw new Error("Truncation not yet initialized");
  },
};

// Load the module synchronously using require
const truncationModule = require(truncationPath) as LoadedModule;

// Handle different module formats
// When TypeScript compiles and the output is loaded, we might get:
// 1. Direct CommonJS exports: { truncate: fn, ... }
// 2. Wrapped ES module: { __esModule: true, default: { truncate: fn, ... } }
// 3. Other wrapper: { default: { truncate: fn, ... } }
if (typeof truncationModule.truncate === "function") {
  // Direct CommonJS export
  truncation = truncationModule as RollbarTruncation;
} else if (
  truncationModule.default &&
  typeof (truncationModule.default as LoadedModule).truncate === "function"
) {
  // Wrapped with default export
  truncation = truncationModule.default as RollbarTruncation;
} else if (truncationModule.__esModule && truncationModule.default) {
  // ES module interop
  truncation = truncationModule.default as RollbarTruncation;
} else {
  // Last resort - try to find truncate function anywhere in the module
  for (const key of Object.keys(truncationModule)) {
    const value = truncationModule[key];
    if (
      value &&
      typeof value === "object" &&
      typeof (value as LoadedModule).truncate === "function"
    ) {
      truncation = value as RollbarTruncation;
      break;
    }
  }
}

//
// -- End workaround --
//

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
