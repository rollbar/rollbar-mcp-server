import truncation from "rollbar/src/truncation";

// Type definition for the result returned by stringify function in rollbar/src/utility
interface StringifyResult {
  error?: Error;
  value: string;
}

// Type definition for the module rollbar/src/truncation
interface TruncationModule {
  truncate: (
    payload: any,
    jsonBackup: typeof JSON.stringify,
    maxSize: number,
  ) => StringifyResult;
}

const typedTruncation = truncation as TruncationModule;

const CHARS_PER_TOKEN = 4; // Rough estimate: 1 token = 4 characters

/**
 * Truncates an occurrence to fit within token limit
 * @param occurrence - The occurrence to truncate (like a 'payload' in rollbar.js; has a top-level 'data' key)
 * @param maxTokens - Maximum allowed tokens (default: 25000)
 * @returns Truncated data as a json object
 */
export function truncateOccurrence(
  occurrence: any,
  maxTokens: number = 25000,
): unknown {
  // Convert token limit to approximate byte size for rollbar truncation
  const maxBytes = maxTokens * CHARS_PER_TOKEN;

  // rollbar.js's truncate() mutates its `payload` argument in place as it
  // walks strategies (e.g. `body.trace.frames = frames`), so callers must
  // only ever pass in a copy they own, never a live API response object.
  const result = typedTruncation.truncate(occurrence, JSON.stringify, maxBytes);
  const truncatedPayload: unknown = JSON.parse(result.value);
  return truncatedPayload;
}

// Representation tiers, from richest to smallest. Every occurrence in a
// response is rendered at exactly one tier; the allocator below starts
// everyone at ID_ONLY and upgrades tiers as budget allows, so occurrences
// are degraded/upgraded as a whole step, never dropped outright (see
// ROL-1092 Problem 1: dropping breaks cursor/page pagination continuity).
//
// "full" and "compact" can be a large size gap for a heavily-oversized
// occurrence (a compact summary is ~200-500 chars; the full payload can be
// tens of thousands). Left as only two tiers, the allocator would have no
// way to spend leftover budget between those two sizes and would strand
// most of it unused (ROL-1092 Problem 2). The partial_* tiers below (see
// PARTIAL_TIER_FRACTIONS) are a ladder of intermediate representations — the
// full occurrence re-truncated via truncateOccurrence() at progressively
// larger token budgets — so the allocator has a smooth gradient of sizes to
// climb between compact and full, and can actually use the budget a caller
// provided.

export const REPRESENTATION_TIERS = [
  "full",
  "partial_75",
  "partial_50",
  "partial_25",
  "partial_10",
  "compact",
  "id_timestamp",
  "id_only",
] as const;
export type RepresentationTier = (typeof REPRESENTATION_TIERS)[number];

function getExceptionInfo(
  data: Record<string, unknown> | undefined,
): { class?: string; message?: string } | undefined {
  if (!data) {
    return undefined;
  }
  // RollbarOccurrenceResponse carries exception info either as a top-level
  // data.exception (class/message/description) or nested under
  // data.body.trace(.exception) / data.body.trace_chain[].exception,
  // depending on payload shape. Check both without retaining anything else
  // from data.body (frames, request/response bodies, custom blobs).
  const topLevel = data.exception as
    | { class?: string; message?: string }
    | undefined;
  if (topLevel && (topLevel.class || topLevel.message)) {
    return { class: topLevel.class, message: topLevel.message };
  }

  const body = data.body as Record<string, unknown> | undefined;
  if (body) {
    const trace = body.trace as Record<string, unknown> | undefined;
    const traceException = trace?.exception as
      | { class?: string; message?: string }
      | undefined;
    if (traceException && (traceException.class || traceException.message)) {
      return { class: traceException.class, message: traceException.message };
    }
    const traceChain = body.trace_chain as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(traceChain) && traceChain.length > 0) {
      const first = traceChain[0];
      const chainException = first?.exception as
        | { class?: string; message?: string }
        | undefined;
      if (chainException && (chainException.class || chainException.message)) {
        return {
          class: chainException.class,
          message: chainException.message,
        };
      }
    }
    // Message-based occurrences (no exception) still carry a human-readable
    // body under data.body.message.body.
    const message = body.message as Record<string, unknown> | undefined;
    if (message && typeof message.body === "string") {
      return { message: message.body };
    }
  }
  return undefined;
}

/**
 * Compact diagnostic summary: small, fixed set of fields useful for
 * triage (level/environment/framework/language/platform/context/
 * code_version/version, plus exception class+message) without any of the
 * potentially large or sensitive fields (frames, stack traces, request/
 * response bodies, custom blobs, metadata — metadata is already stripped
 * upstream). See ROL-1092 Problem 2's required-field list.
 */
function toCompactSummary(instance: unknown): Record<string, unknown> {
  const record =
    instance && typeof instance === "object"
      ? (instance as Record<string, unknown>)
      : {};
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : undefined;

  const summary: Record<string, unknown> = {
    id: record.id,
    item_id: record.item_id,
    timestamp: record.timestamp,
    version: record.version,
    _tier: "compact",
  };

  if (data) {
    if (data.level !== undefined) summary.level = data.level;
    if (data.environment !== undefined) summary.environment = data.environment;
    if (data.framework !== undefined) summary.framework = data.framework;
    if (data.language !== undefined) summary.language = data.language;
    if (data.platform !== undefined) summary.platform = data.platform;
    if (data.context !== undefined) summary.context = data.context;
    if (data.code_version !== undefined)
      summary.code_version = data.code_version;

    const exceptionInfo = getExceptionInfo(data);
    if (exceptionInfo) {
      if (exceptionInfo.class !== undefined)
        summary.exception_class = exceptionInfo.class;
      if (exceptionInfo.message !== undefined)
        summary.exception_message = exceptionInfo.message;
    }
  }

  return summary;
}

function toIdTimestamp(instance: unknown): Record<string, unknown> {
  const record =
    instance && typeof instance === "object"
      ? (instance as Record<string, unknown>)
      : {};
  return { id: record.id, timestamp: record.timestamp, _tier: "id_timestamp" };
}

function toIdOnly(instance: unknown): Record<string, unknown> {
  const record =
    instance && typeof instance === "object"
      ? (instance as Record<string, unknown>)
      : {};
  return { id: record.id, _tier: "id_only" };
}

interface TierRepresentation {
  tier: RepresentationTier;
  value: unknown;
  json: string;
}

// Builds one instance's representation for a single tier. Called lazily via
// LazyRepresentations below (not precomputed for every tier up front) so
// that instances which only ever need "compact" or smaller never pay for
// the more expensive partial_* tiers' truncateOccurrence() calls. Each tier,
// once built, is memoized — a fixed number of JSON.stringify/
// truncateOccurrence calls per instance (bounded by REPRESENTATION_TIERS
// .length), same as before, just deferred until actually needed.
//
// `sourceInstance` is the ORIGINAL sanitized (metadata-stripped, but not yet
// truncateOccurrence()-truncated) instance — the partial tiers each call
// truncateOccurrence() themselves at a smaller token budget, since re-
// truncating the ALREADY fully-truncated instance would just repeatedly
// apply the same result. `fullInstance` is the max_tokens-truncated result
// used for the richest ("full") tier.
// Token fraction for each partial tier, indexed to match REPRESENTATION_TIERS
// (index 1..4 are partial_75..partial_10).
const PARTIAL_TIER_FRACTIONS: Record<string, number> = {
  partial_75: 0.75,
  partial_50: 0.5,
  partial_25: 0.25,
  partial_10: 0.1,
};

function buildPartialRepresentation(
  tier: RepresentationTier,
  sourceInstance: unknown,
  fullInstance: unknown,
  maxTokens: number,
): TierRepresentation {
  const fraction = PARTIAL_TIER_FRACTIONS[tier];
  const partialTokens = Math.max(Math.floor(maxTokens * fraction), 1);
  // rollbar.js's truncate() (via minBody) assumes payload.data.body exists
  // and throws a TypeError if it doesn't. Real occurrence payloads always
  // have this shape, but fall back to the full-tier value rather than
  // propagating a crash for any malformed/synthetic input that lacks it.
  let truncated: unknown;
  try {
    truncated = truncateOccurrence(
      structuredClone(sourceInstance),
      partialTokens,
    );
  } catch {
    truncated = fullInstance;
  }
  // Tag with _tier so a per-instance representation tier is always
  // inspectable directly on the instance, not just via the top-level
  // _truncation.tiers summary — matters here specifically because a
  // partial-tier instance can otherwise look identical in shape to a "full"
  // one (both come from truncateOccurrence()).
  const value =
    truncated && typeof truncated === "object"
      ? { ...(truncated as Record<string, unknown>), _tier: tier }
      : truncated;
  return { tier, value, json: JSON.stringify(value) };
}

// Builds a single tier's representation on demand. The allocator below only
// ever needs a handful of tiers per instance in practice (most occurrences
// settle at "compact" or smaller), so computing all 8 tiers up front for
// every instance — as an earlier version of this function did — did real,
// unnecessary work: 4 full truncateOccurrence() passes per instance whether
// or not the allocator ever attempts those tiers. At limit=100 with large
// payloads that eager pass was the dominant cost and could push single test
// runs past a 5s timeout under coverage instrumentation. Building lazily
// keeps the same tiers/values/ordering, just deferred until first use.
function buildTierRepresentation(
  tier: RepresentationTier,
  sourceInstance: unknown,
  fullInstance: unknown,
  maxTokens: number,
): TierRepresentation {
  switch (tier) {
    case "full":
      return {
        tier: "full",
        value: fullInstance,
        json: JSON.stringify(fullInstance),
      };
    case "partial_75":
    case "partial_50":
    case "partial_25":
    case "partial_10":
      return buildPartialRepresentation(
        tier,
        sourceInstance,
        fullInstance,
        maxTokens,
      );
    case "compact": {
      const compact = toCompactSummary(fullInstance);
      return { tier: "compact", value: compact, json: JSON.stringify(compact) };
    }
    case "id_timestamp": {
      const idTimestamp = toIdTimestamp(fullInstance);
      return {
        tier: "id_timestamp",
        value: idTimestamp,
        json: JSON.stringify(idTimestamp),
      };
    }
    case "id_only": {
      const idOnly = toIdOnly(fullInstance);
      return { tier: "id_only", value: idOnly, json: JSON.stringify(idOnly) };
    }
  }
}

// Lazily computes and memoizes each tier's representation for one instance,
// indexed to match REPRESENTATION_TIERS (0 = "full" .. 7 = "id_only") so the
// allocator's tierIndex[i] lookups are unchanged.
class LazyRepresentations {
  private cache: (TierRepresentation | undefined)[] = new Array<
    TierRepresentation | undefined
  >(REPRESENTATION_TIERS.length);

  constructor(
    private sourceInstance: unknown,
    private fullInstance: unknown,
    private maxTokens: number,
  ) {}

  get(tierIndex: number): TierRepresentation {
    const cached = this.cache[tierIndex];
    if (cached) {
      return cached;
    }
    const built = buildTierRepresentation(
      REPRESENTATION_TIERS[tierIndex],
      this.sourceInstance,
      this.fullInstance,
      this.maxTokens,
    );
    this.cache[tierIndex] = built;
    return built;
  }
}

export interface AllocationResult {
  instances: unknown[];
  tiers: RepresentationTier[];
  truncated: boolean;
}

export class InsufficientBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientBudgetError";
  }
}

// Fixed allowance for the response wrapper around the instances array
// itself: `{"page":N,"instances":[]}` plus the top-level truncation
// metadata field this module adds when any instance is degraded below
// "full". Generous on purpose — the guarantee below is "within budget plus
// a small, explicitly tested margin", not byte-exact.
const RESPONSE_WRAPPER_ALLOWANCE_CHARS = 96;

// Comma separators between array elements: (n - 1) commas for n instances.
function separatorChars(count: number): number {
  return Math.max(count - 1, 0);
}

/**
 * Response-level allocator (ROL-1092 Problems 1 & 2).
 *
 * Every occurrence supplied is ALWAYS represented in the returned array, in
 * the same order — never dropped — because dropping breaks both
 * page-number and cursor (`last_id`) pagination continuity. Instead, each
 * occurrence is rendered at one of REPRESENTATION_TIERS (full -> partial_75
 * -> partial_50 -> partial_25 -> partial_10 -> compact -> id_timestamp ->
 * id_only), and the algorithm below decides, per occurrence, which tier to
 * use so that the COMPLETE serialized response (wrapper + page field +
 * every instance + top-level truncation metadata) fits within
 * `maxTokens * 4` chars, while using as much of that budget as practical
 * instead of leaving it mostly unused. The partial_* tiers exist so there
 * is always a smooth gradient of sizes between the small "compact" summary
 * and the (potentially much larger) "full" payload — without them, budget
 * left over after every occurrence reaches "compact" has nowhere useful to
 * go, which was the root cause of Problem 2's ~6% utilization bug.
 *
 * `sourceInstances` are the sanitized-but-not-yet-truncated instances (used
 * to derive partial tiers at smaller token budgets); `fullInstances` are
 * those same instances already run through truncateOccurrence() at the
 * full max_tokens budget (the richest tier this function can hand out).
 *
 * Algorithm:
 *   1. Baseline every occurrence at id_only (the smallest tier). If even
 *      this doesn't fit, the request is infeasible at this limit/max_tokens
 *      combination — throw InsufficientBudgetError with actionable
 *      guidance rather than silently returning a partial page.
 *   2. Greedily upgrade occurrences one tier at a time, in backend
 *      (already sorted) order, looping over the whole set repeatedly:
 *      each pass gives every occurrence still below "full" a chance to
 *      move up one tier if doing so fits in the remaining budget. Looping
 *      by pass (rather than fully upgrading occurrence 0 before ever
 *      looking at occurrence 1) spreads limited budget across MULTIPLE
 *      occurrences instead of exhausting it on the first few — satisfying
 *      "preserve useful diagnostics for at least some occurrences" even
 *      when there isn't room to fully upgrade everyone.
 *   3. Running total is tracked incrementally (add/subtract the delta of
 *      each upgrade) rather than re-serializing the whole response on every
 *      attempt, so this stays O(n * tiers) — not O(n^2) — even at n=100.
 *
 * Determinism: iteration is by fixed array index only; no reliance on
 * object key order, Date.now(), or Math.random().
 */
export function allocateResponseBudget(
  fullInstances: unknown[],
  maxTokens: number,
  sourceInstances: unknown[] = fullInstances,
): AllocationResult {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  if (fullInstances.length === 0) {
    return { instances: [], tiers: [], truncated: false };
  }

  const allRepresentations = fullInstances.map(
    (fullInstance, i) =>
      new LazyRepresentations(sourceInstances[i], fullInstance, maxTokens),
  );

  // tierIndex[i] into REPRESENTATION_TIERS for occurrence i. Start at the
  // smallest (last) tier as the baseline feasibility check.
  const smallestTierIndex = REPRESENTATION_TIERS.length - 1;
  const tierIndex: number[] = new Array<number>(fullInstances.length).fill(
    smallestTierIndex,
  );

  const fixedOverhead =
    RESPONSE_WRAPPER_ALLOWANCE_CHARS + separatorChars(fullInstances.length);
  const budgetForInstances = maxChars - fixedOverhead;

  let total = 0;
  for (let i = 0; i < allRepresentations.length; i++) {
    total += allRepresentations[i].get(tierIndex[i]).json.length;
  }

  if (total > budgetForInstances) {
    throw new InsufficientBudgetError(
      `Cannot fit ${fullInstances.length} occurrence(s) within max_tokens=${maxTokens} ` +
        `(~${maxChars} chars) even using the smallest identity-only representation for each. ` +
        `Lower "limit" or raise "max_tokens" and try again.`,
    );
  }

  // Greedy multi-pass upgrade: repeatedly sweep occurrences in backend
  // order, upgrading each one tier at a time whenever it fits in the
  // remaining budget, until a full sweep makes no further progress. This
  // distributes leftover budget fairly across occurrences (round-robin by
  // tier level) rather than fully upgrading the first occurrence before
  // ever considering the second.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let i = 0; i < allRepresentations.length; i++) {
      if (tierIndex[i] === 0) {
        continue; // already at "full", nothing higher to try
      }
      const current = allRepresentations[i].get(tierIndex[i]);
      const next = allRepresentations[i].get(tierIndex[i] - 1);
      const delta = next.json.length - current.json.length;
      if (total + delta <= budgetForInstances) {
        tierIndex[i] -= 1;
        total += delta;
        progressed = true;
      }
    }
  }

  const instances = allRepresentations.map(
    (reps, i) => reps.get(tierIndex[i]).value,
  );
  const tiers = tierIndex.map((idx) => REPRESENTATION_TIERS[idx]);
  const truncated = tiers.some((tier) => tier !== "full");

  return { instances, tiers, truncated };
}
