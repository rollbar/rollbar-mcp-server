import { getUserAgent } from "../config.js";

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

    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}
