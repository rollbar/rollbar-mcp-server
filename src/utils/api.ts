import { getUserAgent } from "../config.js";

// Builds a short, actionable hint appended to 401/403 error messages,
// naming the most likely cause instead of leaving the caller with a bare
// "Unauthorized"/"Forbidden". This is best-effort guidance based on the
// endpoint and tool involved — it never changes the underlying error.
function buildAuthErrorHint(
  status: number,
  url: string,
  toolName: string,
): string {
  const isProjectsEndpoint = /\/projects(\?|$)/.test(url);

  if (status === 403 && isProjectsEndpoint) {
    return "This endpoint requires an account access token (GET /projects is account-token-only; a project token returns 403 here). Set ROLLBAR_ACCOUNT_ACCESS_TOKEN or the accountToken config key to use account mode.";
  }

  if (status === 401) {
    return "The Rollbar access token appears to be invalid or expired. Check ROLLBAR_ACCESS_TOKEN / ROLLBAR_ACCOUNT_ACCESS_TOKEN (or the token in your .rollbar-mcp.json config).";
  }

  if (status === 403) {
    if (toolName === "update-item") {
      return "The token does not have sufficient privileges for this write operation. update-item requires a token (project or account) with write scope — read-only tokens will get a 403 here.";
    }
    return "The token does not have sufficient privileges for this request. Check that it has the required scope (read, or write for update-item) for this project/account.";
  }

  return "";
}

// Helper function for making Rollbar API requests
export async function makeRollbarRequest<T>(
  url: string,
  toolName: string,
  token: string,
  options?: RequestInit,
): Promise<T> {
  const headers = {
    "User-Agent": getUserAgent(toolName),
    "X-Rollbar-Access-Token": token,
    Accept: "application/json",
    ...options?.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Rollbar API error: ${response.status} ${response.statusText}`;

    // Try to parse error message from response
    try {
      const errorJson = JSON.parse(errorText) as { message?: string };
      if (errorJson.message) {
        errorMessage = `Rollbar API error: ${errorJson.message}`;
      }
    } catch {
      // If not JSON, include the raw text if it's short
      if (errorText && errorText.length < 200) {
        errorMessage += ` - ${errorText}`;
      }
    }

    if (response.status === 401 || response.status === 403) {
      const hint = buildAuthErrorHint(response.status, url, toolName);
      if (hint) {
        errorMessage += ` (${hint})`;
      }
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}
