import { describe, expect, it } from "vitest";
import {
  stroopsToXlmString,
  xlmToStroops,
  formatPriceLabel,
  formatAddress,
} from "./format";

// Pin locale to "en-US" so all assertions are deterministic across machines.

describe("stellar format helpers", () => {
  describe("xlmToStroops", () => {
    it("converts XLM to stroops", () => {
      expect(xlmToStroops("1")).toBe(10_000_000n);
      expect(xlmToStroops("2.3456789")).toBe(23_456_789n);
    });

    it("handles numeric input", () => {
      expect(xlmToStroops(5)).toBe(50_000_000n);
    });

    it("rounds at 7 decimal places to avoid float error", () => {
      expect(xlmToStroops("0.0000001")).toBe(1n);
    });
  });

  describe("stroopsToXlmString — Intl.NumberFormat", () => {
    it("converts stroops back to XLM string (en-US)", () => {
      expect(stroopsToXlmString(10_000_000n, "en-US")).toBe("1");
      expect(stroopsToXlmString(23_456_789n, "en-US")).toBe("2.3456789");
    });

    it("formats 0 stroops correctly", () => {
      expect(stroopsToXlmString(0n, "en-US")).toBe("0");
    });

    it("groups thousands in en-US for large XLM amounts", () => {
      // 10,000 XLM = 100,000,000,000 stroops
      const result = stroopsToXlmString(100_000_000_000n, "en-US");
      expect(result).toBe("10,000");
    });

    it("uses comma decimal separator for de-DE locale", () => {
      const result = stroopsToXlmString(15_000_000n, "de-DE");
      // 1.5 in de-DE → "1,5"
      expect(result).toContain(",");
    });

    it("defaults to runtime locale when no locale arg given", () => {
      // Just verify it returns a non-empty numeric string
      const result = stroopsToXlmString(10_000_000n);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("formatPriceLabel", () => {
    it("formats bigint stroops with XLM suffix (en-US)", () => {
      expect(formatPriceLabel(10_000_000n, "en-US")).toBe("1 XLM");
    });

    it("formats large amounts with grouping (en-US)", () => {
      // 12,000 XLM
      expect(formatPriceLabel(120_000_000_000n, "en-US")).toBe("12,000 XLM");
    });

    it("formats number value directly", () => {
      expect(formatPriceLabel(2.5, "en-US")).toBe("2.5 XLM");
    });
  });

  describe("formatAddress", () => {
    it("truncates long addresses to prefix...suffix format", () => {
      const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF";
      const result = formatAddress(addr);
      expect(result).toMatch(/^.{8}\.\.\.(.{4})$/);
    });

    it("returns address unchanged when it is short enough", () => {
      expect(formatAddress("SHORT", 8, 4)).toBe("SHORT");
    });

    it("respects custom prefix and suffix lengths", () => {
      const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF";
      const result = formatAddress(addr, 4, 6);
      expect(result.startsWith("GABC")).toBe(true);
      expect(result.endsWith(addr.slice(-6))).toBe(true);
    });
  });
});
