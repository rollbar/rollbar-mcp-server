import { describe, expect, it } from "vitest";
import {
  escapeMetricsKey,
  groupTopkCounts,
  topkParameters,
} from "../../../src/utils/metrics.js";

describe("topkParameters", () => {
  it.each([
    ["nothing", undefined, ["10", "3", "counts"]],
    ["an empty list", [], ["10", "3", "counts"]],
    ["a count", ["5"], ["5", "3", "counts"]],
    ["a count and load factor", ["5", "10"], ["5", "10", "counts"]],
    ["counts already present", ["5", "3", "counts"], ["5", "3", "counts"]],
    ["counts out of place", ["counts", "5"], ["5", "3", "counts"]],
  ])("always asks for counts given %s", (_label, parameters, expected) => {
    expect(topkParameters(parameters)).toEqual(expected);
  });

  it.each([
    ["three numbers", ["5", "3", "1"]],
    ["a decimal", ["5.5"]],
    ["zero", ["0"]],
    ["a negative number", ["-5"]],
    ["text", ["five"]],
  ])("rejects %s", (_label, parameters) => {
    expect(() => topkParameters(parameters)).toThrow(
      /topk takes how many values to return/,
    );
  });
});

describe("groupTopkCounts", () => {
  it("regroups flat (value, count, error) triples in order", () => {
    expect(
      groupTopkCounts(["['message', 'level']", "6178", "0", "b", "12", "3"]),
    ).toEqual([
      { value: "['message', 'level']", count: 6178, count_error: 0 },
      { value: "b", count: 12, count_error: 3 },
    ]);
  });

  it("returns an empty list for no values", () => {
    expect(groupTopkCounts([])).toEqual([]);
  });

  it.each([
    ["a list that isn't triples", ["a", "b"]],
    ["triples with a non-numeric count", ["a", "b", "c"]],
    ["a non-list", "a"],
    ["null", null],
  ])("passes %s through unchanged", (_label, value) => {
    expect(groupTopkCounts(value)).toEqual(value);
  });
});

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

  it("drops a leading '$.' from the path, which the API adds itself", () => {
    expect(escapeMetricsKey("timings", "$.execution_duration")).toBe(
      "timings.execution_duration",
    );
  });
});
