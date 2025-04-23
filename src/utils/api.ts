import { ROLLBAR_ACCESS_TOKEN, USER_AGENT } from "../config.js";

// Helper function for making Rollbar API requests
export async function makeRollbarRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    "X-Rollbar-Access-Token": ROLLBAR_ACCESS_TOKEN as string,
    Accept: "application/json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making Rollbar API request:", error);
    return null;
  }
}
