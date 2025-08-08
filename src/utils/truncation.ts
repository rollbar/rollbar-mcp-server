import truncation from "rollbar/src/truncation";

// Type definition for the result returned by stringify function in rollbar/src/utility
interface StringifyResult {
  error?: Error;
  value: string;
}

// Type definition for the module rollbar/src/truncation
interface TruncationModule {
  truncate: (
    payload: any,
    jsonBackup: typeof JSON.stringify,
    maxSize: number,
  ) => StringifyResult;
}

const typedTruncation = truncation as TruncationModule;

const CHARS_PER_TOKEN = 4; // Rough estimate: 1 token = 4 characters

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
  const result = typedTruncation.truncate(occurrence, JSON.stringify, maxBytes);
  const truncatedPayload: unknown = JSON.parse(result.value);
  return truncatedPayload;
}
