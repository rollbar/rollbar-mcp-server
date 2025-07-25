import { ROLLBAR_ACCESS_TOKEN, USER_AGENT } from "../config.js";

// Helper function for making Rollbar API requests
export async function makeRollbarRequest<T>(url: string): Promise<T> {
  if (!ROLLBAR_ACCESS_TOKEN) {
    throw new Error("ROLLBAR_ACCESS_TOKEN environment variable is not set");
  }

  const headers = {
    "User-Agent": USER_AGENT,
    "X-Rollbar-Access-Token": ROLLBAR_ACCESS_TOKEN,
    Accept: "application/json",
  };

  const response = await fetch(url, { headers });

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
