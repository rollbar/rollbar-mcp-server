// Request and response helpers for the Metrics API's tables (POST
// /metrics/occurrences and POST /metrics/traces), used by get-metrics.

// ClickHouse's topK defaults: how many values to return, and the load factor
// that sizes its sketch (count × load factor cells). The API quotes "counts"
// into topK's third argument, which makes ClickHouse return (value, count,
// error) tuples instead of bare values.
const TOPK_DEFAULT_COUNT = "10";
const TOPK_DEFAULT_LOAD_FACTOR = "3";
const TOPK_COUNTS = "counts";

/**
 * Builds the `key` the Metrics API expects for a key/value column. The
 * backend splits a key on its first unescaped dot and reads the rest as a
 * JSONPath into the value, so an attribute name such as `rollbar.replay.id`
 * would silently match nothing unless its dots are escaped as `\.`. Dots that
 * are already escaped are left alone, so an escaped key passes through
 * unchanged. `path`, when given, is appended as the JSONPath.
 */
export function escapeMetricsKey(key: string, path?: string): string {
  const escaped = key.replace(/(?<!\\)\./g, "\\.");
  if (path === undefined) {
    return escaped;
  }
  // The backend adds the "$." itself, so a path written as a full JSONPath
  // would otherwise become "$.$.user.id", which it rejects.
  return `${escaped}.${path.replace(/^\$\./, "")}`;
}

/**
 * Builds topk's parameters so the API always returns counts: [count, load
 * factor, "counts"]. Takes [], [count] or [count, load factor], with or
 * without "counts", and fills in ClickHouse's defaults. Anything but a
 * positive integer is rejected here so the caller gets a clear error instead
 * of a ClickHouse one. This isn't a security boundary: the API checks every
 * aggregate parameter against its own allowlist before building the SQL.
 */
export function topkParameters(parameters: string[] = []): string[] {
  const args = parameters.filter((parameter) => parameter !== TOPK_COUNTS);
  if (args.length > 2 || !args.every((arg) => /^[1-9]\d*$/.test(arg))) {
    throw new Error(
      "topk takes how many values to return and an optional load factor, both positive integers, such as ['5'] or ['5', '10'].",
    );
  }
  const [count = TOPK_DEFAULT_COUNT, loadFactor = TOPK_DEFAULT_LOAD_FACTOR] =
    args;
  return [count, loadFactor, TOPK_COUNTS];
}

export interface TopkEntry {
  value: unknown;
  count: number;
  // How far count may overstate the true count; 0 when it's exact.
  count_error: number;
}

/**
 * The API flattens topK's (value, count, error) tuples into one list:
 * [value1, count1, error1, value2, ...], most frequent first. This regroups it
 * into one object per value, in the same order. A value of any other shape
 * passes through unchanged.
 */
export function groupTopkCounts(value: unknown): unknown {
  if (!Array.isArray(value) || value.length % 3 !== 0) {
    return value;
  }
  const entries: TopkEntry[] = [];
  for (let i = 0; i < value.length; i += 3) {
    const count = Number(value[i + 1]);
    const countError = Number(value[i + 2]);
    if (Number.isNaN(count) || Number.isNaN(countError)) {
      return value;
    }
    entries.push({ value: value[i], count, count_error: countError });
  }
  return entries;
}
