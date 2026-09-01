import { RollbarApiResponse } from "../types/index.js";

// Validates the standard Rollbar API envelope ({err, result, message?}) and
// returns the unwrapped result. Distinct messages per failure mode: a
// non-object body is a transport-level problem, a missing result is a
// malformed success envelope. Kept separate from api.ts so tool tests can
// mock makeRollbarRequest while exercising the real validation logic.
export function validateRollbarResponse<T>(
  response: RollbarApiResponse<T> | null | undefined,
  url: string,
  missingLabel: string,
): T {
  if (!response || typeof response !== "object") {
    throw new Error(`Invalid API response from ${url}: non-object response`);
  }

  if (response.err !== 0) {
    const errorMessage =
      response.message || `Unknown error (code: ${response.err})`;
    throw new Error(`Rollbar API returned error: ${errorMessage}`);
  }

  if (response.result === undefined || response.result === null) {
    throw new Error(
      `Invalid API response from ${url}: missing ${missingLabel}`,
    );
  }

  return response.result;
}
