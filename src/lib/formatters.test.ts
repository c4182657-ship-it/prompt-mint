import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatPriceLabel,
  formatXLM,
  formatUSD,
  formatNumber,
  formatCompactNumber,
  formatPercent,
  stroopsToXlmNumber,
} from "./formatters";

// Pin locale to "en-US" throughout so tests are deterministic on any machine.
// The new Intl.NumberFormat-based functions accept an explicit `locale` option.

describe("Currency & Number Formatting Utilities", () => {
  describe("stroopsToXlmNumber", () => {
    it("converts bigint stroops to XLM number accurately", () => {
      expect(stroopsToXlmNumber(10_000_000n)).toBe(1);
      expect(stroopsToXlmNumber(25_000_000n)).toBe(2.5);
    });

    it("converts numeric stroops", () => {
      expect(stroopsToXlmNumber(10_000_000)).toBe(1);
    });

    it("converts string stroops", () => {
      expect(stroopsToXlmNumber("10000000")).toBe(1);
    });

    it("returns null for invalid inputs", () => {
      expect(stroopsToXlmNumber(null)).toBeNull();
      expect(stroopsToXlmNumber(undefined)).toBeNull();
      expect(stroopsToXlmNumber("")).toBeNull();
    });
  });

  describe("formatCurrency — XLM via Intl.NumberFormat", () => {
    it("formats XLM with default symbol using en-US locale", () => {
      expect(formatCurrency(10.5, "XLM", { locale: "en-US" })).toBe(
        "10.50 XLM",
      );
    });

    it("formats XLM without symbol", () => {
      expect(
        formatCurrency(10.5, "XLM", { locale: "en-US", showSymbol: false }),
      ).toBe("10.50");
    });

    it("formats XLM from bigint stroops", () => {
      expect(
        formatCurrency(100_000_000n, "XLM", {
          locale: "en-US",
          inputUnit: "stroops",
        }),
      ).toBe("10.00 XLM");
    });

    it("formats XLM from stroops explicit inputUnit", () => {
      expect(
        formatCurrency("50000000", "XLM", {
          locale: "en-US",
          inputUnit: "stroops",
        }),
      ).toBe("5.00 XLM");
    });

    it("uses locale-aware separators for de-DE", () => {
      // de-DE uses comma as decimal separator: 1.234,56
      const result = formatCurrency(1234.56, "XLM", { locale: "de-DE" });
      // Check that both the comma decimal and dot thousands are present
      expect(result).toContain(",");
      expect(result).toContain("XLM");
    });

    it("formats USD with dollar symbol", () => {
      expect(formatCurrency(49.99, "USD", { locale: "en-US" })).toBe("$49.99");
    });

    it("formats EUR with locale", () => {
      const result = formatCurrency(100, "EUR", { locale: "en-US" });
      expect(result).toContain("100");
    });

    it("handles null, undefined, and NaN with fallback", () => {
      expect(formatCurrency(null)).toBe("-");
      expect(formatCurrency(undefined, "USD", { fallback: "N/A" })).toBe("N/A");
      expect(formatCurrency(NaN, "XLM")).toBe("-");
    });

    it("handles Infinity with fallback", () => {
      expect(formatCurrency(Infinity, "XLM")).toBe("-");
    });

    it("handles empty string with fallback", () => {
      expect(formatCurrency("", "XLM")).toBe("-");
    });
  });

  describe("formatPriceLabel — Intl.NumberFormat", () => {
    it("formats bigint stroops to XLM decimal string (en-US)", () => {
      expect(formatPriceLabel(50_000_000n, "stroops", "en-US")).toBe("5.00");
    });

    it("formats string stroops", () => {
      expect(formatPriceLabel("10000000", "stroops", "en-US")).toBe("1.00");
    });

    it("handles zero", () => {
      expect(formatPriceLabel(0n, "stroops", "en-US")).toBe("0.00");
    });

    it("falls back for empty/null/undefined input", () => {
      expect(formatPriceLabel(null)).toBe("-");
      expect(formatPriceLabel(undefined)).toBe("-");
      expect(formatPriceLabel("")).toBe("-");
    });

    it("formats xlm unit directly", () => {
      expect(formatPriceLabel(1.5, "xlm", "en-US")).toBe("1.50");
    });
  });

  describe("formatXLM", () => {
    it("formats XLM with default unit suffix", () => {
      expect(formatXLM(20_000_000n)).toBe("2.00 XLM");
    });

    it("formats XLM without unit when requested", () => {
      expect(formatXLM(20_000_000n, { showUnit: false })).toBe("2.00");
    });

    it("formats custom decimals", () => {
      expect(formatXLM(10_000_000n, { decimals: 7 })).toBe("1.0000000 XLM");
    });
  });

  describe("formatUSD", () => {
    it("formats USD amount with dollar symbol", () => {
      expect(formatUSD(123.45)).toBe("$123.45");
    });

    it("formats USD without symbol", () => {
      const result = formatUSD(123.45, { showSymbol: false });
      expect(result).toContain("123.45");
    });
  });

  describe("formatNumber — locale-aware", () => {
    it("formats general numbers with locale grouping (en-US)", () => {
      expect(formatNumber(1000000, { locale: "en-US" })).toBe("1,000,000");
    });

    it("returns fallback on invalid number", () => {
      expect(formatNumber(null)).toBe("-");
      expect(formatNumber(undefined)).toBe("-");
      expect(formatNumber(NaN)).toBe("-");
    });

    it("formats with Intl options passed through", () => {
      const result = formatNumber(1234.5678, {
        locale: "en-US",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(result).toBe("1,234.57");
    });
  });

  describe("formatCompactNumber — locale-aware", () => {
    it("formats thousands compactly (en-US)", () => {
      expect(formatCompactNumber(1500, { locale: "en-US" })).toBe("1.5K");
    });

    it("formats millions compactly (en-US)", () => {
      expect(formatCompactNumber(2500000, { locale: "en-US" })).toBe("2.5M");
    });

    it("returns fallback on invalid values", () => {
      expect(formatCompactNumber(undefined)).toBe("-");
      expect(formatCompactNumber(null)).toBe("-");
    });
  });

  describe("formatPercent", () => {
    it("formats numbers as percentage strings", () => {
      expect(formatPercent(12.5)).toBe("12.50%");
    });

    it("converts decimal ratio to percentage", () => {
      expect(formatPercent(0.05, 2, { isDecimalRatio: true })).toBe("5.00%");
    });

    it("returns fallback for invalid input", () => {
      expect(formatPercent(null)).toBe("-");
    });
  });
});
