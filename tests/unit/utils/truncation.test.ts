import { describe, it, expect, vi, beforeEach } from "vitest";
import { truncateOccurrence } from "../../../src/utils/truncation.js";

describe("truncation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

      const lenBefore = JSON.stringify(occurrence).length;
      const result = truncateOccurrence(occurrence, 100);
      const lenAfter = JSON.stringify(result).length;

      expect(result.id).toBe(456);
      expect(lenAfter).toBeLessThan(lenBefore);
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
    });

    it("should handle different token to byte conversions", () => {
      const occurrence = {
        id: 456,
        data: { body: { message: "Test message" } },
      };
      
      // Test with small token limit - should trigger truncation
      const result1 = truncateOccurrence(occurrence, 10);
      expect(result1).toBeDefined();
      
      // Test with larger token limit - should not truncate
      const result2 = truncateOccurrence(occurrence, 50000);
      expect(result2).toBeDefined();
    });

    it("should parse the truncated result correctly", () => {
      const occurrence = {
        id: 789,
        data: { body: { message: "Message" } },
      };
      
      const result = truncateOccurrence(occurrence, 100);
      expect(result).toBeDefined();
      expect(result.id).toBe(789);
    });

    it("should handle empty occurrences", () => {
      const occurrence = {};
      
      const result = truncateOccurrence(occurrence, 100);
      expect(result).toBeDefined();
    });

    it("should handle null values in occurrence", () => {
      const occurrence = {
        id: null,
        data: {
          body: null,
          level: "error",
        },
      };
      
      const result = truncateOccurrence(occurrence, 100);
      expect(result).toBeDefined();
    });

    it("should handle very large max token values", () => {
      const occurrence = {
        id: 999,
        data: { body: { message: "Test" } },
      };
      
      const result = truncateOccurrence(occurrence, Number.MAX_SAFE_INTEGER);
      expect(result).toBeDefined();
    });

    it("should handle occurrences with special characters", () => {
      const occurrence = {
        id: 333,
        data: {
          body: {
            message: "Special chars: 🚀 \n\t\r \u0000 <script>alert('xss')</script>",
          },
        },
      };
      
      const result = truncateOccurrence(occurrence, 100);
      expect(result).toBeDefined();
    });

    it("should handle array data in occurrence", () => {
      const occurrence = {
        id: 444,
        data: {
          body: {
            messages: ["msg1", "msg2", "msg3"],
            errors: Array(100).fill("error"),
          },
        },
      };

      
      const result = truncateOccurrence(occurrence, 50);
      expect(result).toBeDefined();
      expect(result.data.body.errors[0]).toBeDefined();
      expect(result.id).toBe(444);
    });
  });
});
