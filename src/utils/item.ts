import { AuthContext } from "../config.js";
import { RollbarApiResponse, RollbarItemResponse } from "../types/index.js";
import { makeRollbarRequest } from "./api.js";
import { validateRollbarResponse } from "./response.js";
import { injectProjectIdQueryParam } from "./params.js";

/** Resolve a project-local item counter to the item's global numeric id. */
export async function getItemByCounter(
  counter: number,
  auth: AuthContext,
  toolName: string,
): Promise<RollbarItemResponse> {
  const params = new URLSearchParams({ counter: counter.toString() });
  const itemUrl = injectProjectIdQueryParam(
    `${auth.apiBase}/item/?${params.toString()}`,
    auth,
  );
  const response = await makeRollbarRequest<
    RollbarApiResponse<RollbarItemResponse>
  >(itemUrl, toolName, auth.token);

  const item = validateRollbarResponse(response, itemUrl, "item");
  if (typeof item.id !== "number") {
    throw new Error(`Invalid API response from ${itemUrl}: missing item id`);
  }

  return item;
}
