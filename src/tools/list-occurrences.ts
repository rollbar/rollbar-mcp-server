import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAuthContext } from "../config.js";
import { makeRollbarRequest } from "../utils/api.js";
import { buildProjectParam } from "../utils/project-params.js";
import { injectProjectIdQueryParam } from "../utils/params.js";
import { getItemByCounter } from "../utils/item.js";
import {
  RollbarApiResponse,
  RollbarListOccurrencesResponse,
  RollbarOccurrenceResponse,
} from "../types/index.js";
import {
  truncateOccurrence,
  allocateResponseBudget,
  InsufficientBudgetError,
} from "../utils/truncation.js";

// GROUP_STATUS.group from Mox's model/constants.py — item.group_status == 2
// means the item is an aggregate/group item. Mox's public GET /item/?counter=
// and GET /item/{id} routes both serialize `group_status` on the raw item
// (see mox/responses/internalapi/items.py:item_for_id), so this is available
// from the item lookup response we already make, at no extra API cost.
const GROUP_STATUS_GROUP = 2;

// Minimum viable max_tokens: enough characters (max_tokens * 4) to fit the
// response wrapper plus at least one id_only instance stub
// (`{"id":N,"_tier":"id_only"}` is well under 100 chars). Below this, no
// amount of tier degradation can produce a non-empty, non-misleading
// response for even a single occurrence, so we reject it up front. Larger
// `limit` values can still exceed the available budget even above this
// floor — that dynamic case is handled by allocateResponseBudget() raising
// InsufficientBudgetError at request time.
const MIN_MAX_TOKENS = 100;

export function registerListOccurrencesTool(server: McpServer) {
  server.tool(
    "list-occurrences",
    "List occurrences (instances) for a Rollbar item by counter",
    {
      counter: z.number().int().min(1).describe("Rollbar item counter"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(3)
        .describe("Number of occurrences to return (default: 3, max: 100)"),
      page: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Page number for pagination (default: 1)"),
      last_id: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "id of the last occurrence from a previous page, for cursor-based pagination. Takes precedence over page when both are provided.",
        ),
      max_tokens: z
        .number()
        .int()
        .min(MIN_MAX_TOKENS)
        .optional()
        .default(20000)
        .describe(
          `Target budget for the complete response, in tokens (default: 20000, minimum: ${MIN_MAX_TOKENS}; approx. max_tokens*4 characters). Every occurrence selected by the backend for this page is always represented, in backend order — never dropped. Each occurrence is rendered at one of four tiers depending on available budget: "full" (complete/lightly-truncated occurrence), "compact" (small diagnostic summary: level, environment, framework, language, platform, context, code_version, version, exception class/message), "id_timestamp" (id + timestamp only), or "id_only" (id only). The allocator fills the budget by upgrading occurrences tier-by-tier rather than splitting it evenly up front, so several occurrences can retain real diagnostic detail instead of all being collapsed to bare stubs. The response includes a top-level "_truncation" field describing what happened when any occurrence is below "full". The final response is bounded at max_tokens*4 characters plus a small, fixed overhead margin — never a hard byte-exact cap, but drops are never used to enforce it. If even the id_only representation cannot fit every occurrence in "limit", the call fails with an actionable error asking you to lower limit or raise max_tokens, rather than returning a silently partial page.`,
        ),
      project: buildProjectParam(),
    },
    async ({ counter, limit, page, last_id, max_tokens, project }) => {
      const auth = await resolveAuthContext(project);
      const { token, apiBase } = auth;

      const item = await getItemByCounter(counter, auth, "list-occurrences");

      // Mox's public GET /item/{id}/instances filters item_occurrence by
      // item_occurrence.item_id = this item's id. For a GROUP item, real
      // occurrences are recorded against the group's CONSTITUENT item ids,
      // not the group item's own id, so this endpoint always returns an
      // empty (or incomplete) instances array for group items — identical
      // in shape to a genuinely occurrence-free item. Mox has a group-aware
      // internal search (ItemOccurrencesSearch, which resolves
      // item.group_item_id or item.id) but it is only exposed via the
      // internal `internalapi/fuji` routes, not any public moxapi route, so
      // it cannot be used here. Fanning this tool's request out to each
      // constituent item's /instances is also unsafe: Mox's
      // fetch_constituents() has no LIMIT, so a group can have an unbounded
      // number of constituents. Rather than silently return an empty
      // instances array that looks identical to "no occurrences", surface
      // the limitation explicitly.
      if (item.group_status === GROUP_STATUS_GROUP) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "group_item_not_supported",
                message:
                  "This item is a group item (an aggregate of multiple constituent items). " +
                  "Occurrence listing for grouped items is not currently supported by the public Rollbar API: " +
                  "occurrences are associated with the group's constituent item ids, not the group item id, " +
                  "and no public, group-aware occurrence-listing endpoint currently exists. " +
                  "This is not the same as the item having zero occurrences.",
                counter,
                item_id: item.id,
              }),
            },
          ],
        };
      }

      const params = new URLSearchParams();
      params.append("limit", limit.toString());
      if (last_id !== undefined) {
        // `last_id` is the confirmed, documented cursor param name for this
        // endpoint. Send only this — no `lastId` alias — so the code itself
        // is the source of truth for anyone (human or agent) reading it.
        params.append("last_id", last_id.toString());
      } else {
        params.append("page", page.toString());
      }

      const instancesUrl = injectProjectIdQueryParam(
        `${apiBase}/item/${item.id}/instances?${params.toString()}`,
        auth,
      );
      const instancesResponse = await makeRollbarRequest<
        RollbarApiResponse<RollbarListOccurrencesResponse>
      >(instancesUrl, "list-occurrences", token);

      if (!instancesResponse || typeof instancesResponse !== "object") {
        throw new Error(
          `Invalid API response from ${instancesUrl}: missing instances`,
        );
      }

      if (instancesResponse.err !== 0) {
        const errorMessage =
          instancesResponse.message ||
          `Unknown error (code: ${instancesResponse.err})`;
        throw new Error(`Rollbar API returned error: ${errorMessage}`);
      }

      const instancesResult = instancesResponse.result;
      if (!instancesResult || !Array.isArray(instancesResult.instances)) {
        throw new Error(
          `Invalid API response from ${instancesUrl}: missing instances`,
        );
      }

      // Mox's own query orders by timestamp DESC, raw_item_id DESC, but a
      // later re-sort step in its raw-item fetch path re-sorts by timestamp
      // only, so occurrences sharing a timestamp can arrive out of ID order.
      // Re-sort here so the last instance in the page is reliably the one
      // with the lowest id at that timestamp — otherwise passing its id as
      // last_id for the next page can repeat rows.
      const orderedInstances = [...instancesResult.instances].sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        return b.id - a.id;
      });

      // Deep-clone every instance before sanitizing/truncating: a shallow
      // copy of `data` is not enough, because truncateOccurrence() mutates
      // NESTED fields in place (rollbar.js's truncate() walks and reassigns
      // things like data.body.trace.frames), and a shallow `{ ...data }`
      // still shares those nested objects with the original API response.
      // structuredClone() is available in Node 17+ (well within this
      // project's supported Node 20/22 range).
      const sanitizedInstances: RollbarOccurrenceResponse[] =
        orderedInstances.map((instance) => {
          const cloned = structuredClone(instance);
          if (cloned.data && "metadata" in cloned.data) {
            delete cloned.data.metadata;
          }
          return cloned;
        });

      // Run truncateOccurrence() per instance first: it applies rollbar.js's
      // own strategies (frame trimming, string-length caps, minBody) using
      // the full max_tokens as an upper bound, which is the richest "full"
      // tier the response-level allocator below is allowed to hand out.
      // The allocator, not this per-instance pass, is what actually keeps
      // the COMPLETE response within budget.
      const truncatedInstances = sanitizedInstances.map((instance) =>
        truncateOccurrence(instance, max_tokens),
      );

      let allocation;
      try {
        allocation = allocateResponseBudget(
          truncatedInstances,
          max_tokens,
          sanitizedInstances,
        );
      } catch (err) {
        if (err instanceof InsufficientBudgetError) {
          throw new Error(err.message);
        }
        throw err;
      }

      const responseData: {
        page: number;
        instances: unknown[];
        _truncation?: {
          applied: boolean;
          tiers: Record<string, number>;
          message: string;
        };
      } = {
        page: instancesResult.page,
        instances: allocation.instances,
      };

      if (allocation.truncated) {
        // Single top-level explanation of what happened, rather than
        // repeating a long string inside every degraded instance (ROL-1092
        // Problem 1). tiers is a count-by-tier summary so callers can tell
        // at a glance how much detail survived without walking every
        // instance.
        const tierCounts: Record<string, number> = {};
        for (const tier of allocation.tiers) {
          tierCounts[tier] = (tierCounts[tier] || 0) + 1;
        }
        responseData._truncation = {
          applied: true,
          tiers: tierCounts,
          message:
            "Some occurrences were rendered at a reduced representation tier " +
            "(compact, id_timestamp, or id_only) to fit within max_tokens. " +
            "Every occurrence for this page is still present and in order; " +
            "raise max_tokens for more complete detail.",
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData),
          },
        ],
      };
    },
  );
}
