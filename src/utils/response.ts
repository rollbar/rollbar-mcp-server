import type { RollbarApiResponse } from "../types/index.js";

export function getRollbarResult<T>(
  response: RollbarApiResponse<T>,
  resource: string,
): T {
  if (!response || typeof response !== "object") {
    throw new Error(
      `Invalid Rollbar API response: missing ${resource} response`,
    );
  }
  if (response.err !== 0) {
    throw new Error(
      `Rollbar API returned error: ${response.message || `Unknown error (code: ${response.err})`}`,
    );
  }
  if (response.result === undefined || response.result === null) {
    throw new Error(`Invalid Rollbar API response: missing ${resource} result`);
  }
  return response.result;
}
