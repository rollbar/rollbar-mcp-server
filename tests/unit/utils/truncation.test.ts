import { describe, it, expect, vi } from "vitest";
import { truncateOccurrence } from "../../../src/utils/truncation.js";

// Mock the rollbar module
vi.mock("module", () => ({
  createRequire: () => () => ({
    truncate: vi.fn((payload, jsonBackup, maxBytes) => {
      // Simple mock truncation that returns data if under limit
      const dataStr = JSON.stringify(payload);
      if (dataStr.length <= maxBytes) {
        return { value: dataStr };
      }
      // Return truncated version - simulate rollbar truncation
      const truncated = {
        ...payload,
        data: {
          ...payload.data,
          _truncated: true,
        },
      };
      return { value: JSON.stringify(truncated) };
    }),
  }),
}));

describe("truncation", () => {
  describe("truncateOccurrence", () => {
    it("should not truncate small occurrences", () => {
      const occurrence = {
        id: 123,
        data: {
          body: { message: "Small message" },
          level: "error",
        },
      };
      
      const result = truncateOccurrence(occurrence, 10000);
      expect(result).toEqual(occurrence);
      expect(result.data._truncated).toBeUndefined();
    });

    it("should truncate large occurrences", () => {
      const occurrence = {
        id: 456,
        data: {
          body: {
            trace: {
              frames: Array(1000).fill({
                filename: "/very/long/path/to/file.py",
                lineno: 123,
                method: "some_method",
              }),
            },
          },
          level: "error",
        },
      };
      
      const result = truncateOccurrence(occurrence, 100);
      expect(result.data._truncated).toBe(true);
    });

    it("should use default max tokens when not specified", () => {
      const occurrence = {
        id: 789,
        data: { body: { message: "Test" } },
      };
      
      const result = truncateOccurrence(occurrence);
      expect(result).toBeDefined();
      expect(result.id).toBe(789);
    });

    it("should handle occurrences with complex nested structures", () => {
      const occurrence = {
        id: 999,
        data: {
          body: {
            trace_chain: [
              {
                frames: Array(50).fill({ frame: "data" }),
                exception: { class: "Error", message: "Test error" },
              },
              {
                frames: Array(50).fill({ frame: "data" }),
                exception: { class: "ValueError", message: "Another error" },
              },
            ],
          },
          request: {
            url: "https://example.com",
            headers: { "Content-Type": "application/json" },
          },
        },
      };
      
      const result = truncateOccurrence(occurrence, 500);
      expect(result).toBeDefined();
      expect(result.id).toBe(999);
    });

    it("should preserve occurrence structure after truncation", () => {
      const occurrence = {
        id: 111,
        project_id: 222,
        timestamp: 1234567890,
        data: {
          body: {
            message: "x".repeat(10000),
          },
          level: "warning",
          environment: "production",
        },
      };
      
      const result = truncateOccurrence(occurrence, 50);
      expect(result.id).toBe(111);
      expect(result.data).toBeDefined();
      expect(result.data._truncated).toBe(true);
    });
  });
});