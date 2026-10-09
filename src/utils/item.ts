import { z } from "zod";
import type { AuthContext } from "../config.js";
import type {
  RollbarApiResponse,
  RollbarItemResponse,
} from "../types/index.js";
import { makeRollbarRequest } from "./api.js";
import { injectProjectIdQueryParam } from "./params.js";
import { getRollbarResult } from "./response.js";

export const itemSelectorParams = {
  item_id: z
    .number()
    .int()
    .positive()
    .safe()
    .optional()
    .describe(
      "Global Rollbar item ID. Provide exactly one of item_id or counter.",
    ),
  counter: z
    .number()
    .int()
    .positive()
    .safe()
    .optional()
    .describe(
      "Project-local item counter shown in Rollbar. Provide exactly one of counter or item_id.",
    ),
};

type ItemSelector = { item_id: number } | { counter: number };

export function parseItemSelector(input: {
  item_id?: number;
  counter?: number;
}): ItemSelector {
  if (input.item_id !== undefined && input.counter === undefined) {
    return { item_id: input.item_id };
  }
  if (input.counter !== undefined && input.item_id === undefined) {
    return { counter: input.counter };
  }
  throw new Error("Provide exactly one of item_id or counter");
}

export async function getItemByCounter(
  counter: number,
  auth: AuthContext,
  toolName: string,
): Promise<RollbarItemResponse> {
  const url = injectProjectIdQueryParam(
    `${auth.apiBase}/item?counter=${counter}`,
    auth,
  );
  const response = await makeRollbarRequest<
    RollbarApiResponse<RollbarItemResponse>
  >(url, toolName, auth.token);
  const item = getRollbarResult(response, "item");
  if (!Number.isSafeInteger(item.id) || item.id <= 0) {
    throw new Error("Invalid Rollbar API response: missing item ID");
  }
  return item;
}

export async function resolveItemId(
  selector: ItemSelector,
  auth: AuthContext,
  toolName: string,
): Promise<number> {
  return "item_id" in selector
    ? selector.item_id
    : (await getItemByCounter(selector.counter, auth, toolName)).id;
}
