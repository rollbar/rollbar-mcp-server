import { describe, expect, it } from "vitest";
import { escapeMetricsKey } from "../../../src/utils/table-metrics.js";

describe("escapeMetricsKey", () => {
  it.each([
    ["a key without dots", "User-Agent", "User-Agent"],
    [
      "every dot in an attribute name",
      "rollbar.replay.id",
      "rollbar\\.replay\\.id",
    ],
    ["a trailing dot", "a.", "a\\."],
  ])("escapes %s", (_label, key, expected) => {
    expect(escapeMetricsKey(key)).toBe(expected);
  });

  it("leaves an already-escaped key unchanged", () => {
    expect(escapeMetricsKey("rollbar\\.replay\\.id")).toBe(
      "rollbar\\.replay\\.id",
    );
  });

  it("escapes only the dots that aren't escaped yet", () => {
    expect(escapeMetricsKey("rollbar\\.replay.id")).toBe(
      "rollbar\\.replay\\.id",
    );
  });

  it("appends a path after the escaped key, leaving the path's dots as separators", () => {
    expect(
      escapeMetricsKey("rollbar.replay.trigger.context", "rule.type"),
    ).toBe("rollbar\\.replay\\.trigger\\.context.rule.type");
  });
});
