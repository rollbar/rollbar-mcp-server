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
    return "Project discovery requires an account or user token with read scope and access to the account. Configure accountToken / ROLLBAR_ACCOUNT_ACCESS_TOKEN or userToken / ROLLBAR_USER_ACCESS_TOKEN; project tokens cannot list account projects.";
  }

  if (status === 401) {
    return "The Rollbar access token appears to be invalid or expired. Check ROLLBAR_ACCESS_TOKEN / ROLLBAR_ACCOUNT_ACCESS_TOKEN / ROLLBAR_USER_ACCESS_TOKEN (or the token in your .rollbar-mcp.json config).";
  }

  if (status === 403) {
    if (toolName === "post-item-comment") {
      return "Posting requires a user-scoped account token with read and write scope and comment permission on the selected project. Configure userToken / ROLLBAR_USER_ACCESS_TOKEN; project and account-wide tokens cannot post comments.";
    }
    if (toolName === "update-item") {
      return "The token does not have sufficient privileges for this write operation. update-item requires a token (project or account) with write scope — read-only tokens will get a 403 here.";
    }
    return "The token does not have sufficient privileges for this request. Check its scope and the user's project permissions; requested features such as snooze history may also require account access.";
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
