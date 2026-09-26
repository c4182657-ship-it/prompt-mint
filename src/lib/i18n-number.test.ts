/**
 * Tests for i18n-aware XLM/stroop/USD formatting utilities.
 *
 * All pure (non-hook) helpers are tested here with explicit locale args so
 * output is deterministic regardless of the test runner's system locale.
 * React hooks (useXlmFormatter, useStroopsFormatter, useUsdFormatter) are
 * integration-tested via CurrencyPrice.test.tsx.
 */
import { describe, it, expect } from "vitest";
import {
  formatXlmLocale,
  formatStroopsLocale,
  formatUsdLocale,
} from "./i18n-number";

const EN = "en-US";
const DE = "de-DE";
const JA = "ja-JP";
const FR = "fr-FR";

describe("formatXlmLocale", () => {
  describe("stroops → XLM conversion", () => {
    it("converts 10,000,000 stroops to 1.00 XLM (en-US)", () => {
      expect(formatXlmLocale(10_000_000n, "stroops", EN)).toBe("1.00 XLM");
    });

    it("converts bigint stroops with correct decimals", () => {
      expect(formatXlmLocale(25_000_000n, "stroops", EN)).toBe("2.50 XLM");
    });

    it("converts numeric stroops", () => {
      expect(formatXlmLocale(50_000_000, "stroops", EN)).toBe("5.00 XLM");
    });

    it("converts string stroops", () => {
      expect(formatXlmLocale("10000000", "stroops", EN)).toBe("1.00 XLM");
    });

    it("formats 0 stroops as 0.00 XLM", () => {
      expect(formatXlmLocale(0n, "stroops", EN)).toBe("0.00 XLM");
    });
  });

  describe("xlm unit passthrough", () => {
    it("uses value directly when unit=xlm", () => {
      expect(formatXlmLocale(1.5, "xlm", EN)).toBe("1.50 XLM");
    });

    it("formats string XLM value", () => {
      expect(formatXlmLocale("2.75", "xlm", EN)).toBe("2.75 XLM");
    });
  });

  describe("locale-aware separators", () => {
    it("uses comma decimal separator in de-DE", () => {
      const result = formatXlmLocale(15_000_000n, "stroops", DE);
      // 1.5 XLM in de-DE → "1,50 XLM"
      expect(result).toContain(",");
      expect(result).toContain("XLM");
    });

    it("groups thousands correctly in en-US", () => {
      // 10,000 XLM = 100,000,000,000 stroops
      const result = formatXlmLocale(100_000_000_000n, "stroops", EN);
      expect(result).toBe("10,000.00 XLM");
    });

    it("groups thousands in fr-FR", () => {
      const result = formatXlmLocale(100_000_000_000n, "stroops", FR);
      // fr-FR uses narrow no-break space as thousands separator
      expect(result).toContain("XLM");
      expect(result.replace(/\s/g, "")).toContain("10000");
    });

    it("formats correctly for ja-JP", () => {
      const result = formatXlmLocale(10_000_000n, "stroops", JA);
      expect(result).toContain("XLM");
    });
  });

  describe("showUnit flag", () => {
    it("omits XLM suffix when showUnit=false", () => {
      const result = formatXlmLocale(10_000_000n, "stroops", EN, 2, false);
      expect(result).toBe("1.00");
      expect(result).not.toContain("XLM");
    });
  });

  describe("decimals option", () => {
    it("shows 7 decimal places when requested", () => {
      const result = formatXlmLocale(10_000_001n, "stroops", EN, 7);
      expect(result).toContain("1.0000001");
      expect(result).toContain("XLM");
    });

    it("shows 0 decimal places when requested", () => {
      const result = formatXlmLocale(10_000_000n, "stroops", EN, 0);
      expect(result).toBe("1 XLM");
    });
  });

  describe("edge cases and fallback", () => {
    it("returns '-' for null", () => {
      expect(formatXlmLocale(null, "stroops", EN)).toBe("-");
    });

    it("returns '-' for undefined", () => {
      expect(formatXlmLocale(undefined, "stroops", EN)).toBe("-");
    });

    it("returns '-' for empty string", () => {
      expect(formatXlmLocale("", "stroops", EN)).toBe("-");
    });

    it("returns '-' for non-numeric string", () => {
      expect(formatXlmLocale("abc", "stroops", EN)).toBe("-");
    });
  });
});

describe("formatStroopsLocale", () => {
  it("formats stroops as XLM decimal string (en-US)", () => {
    expect(formatStroopsLocale(10_000_000n, EN)).toBe("1.00");
  });

  it("formats bigint with 7 fraction digits when needed", () => {
    expect(formatStroopsLocale(10_000_001n, EN)).toBe("1.0000001");
  });

  it("formats numeric stroops", () => {
    expect(formatStroopsLocale(5_000_000, EN)).toBe("0.50");
  });

  it("formats 0 correctly", () => {
    expect(formatStroopsLocale(0n, EN)).toBe("0.00");
  });

  it("returns '-' for null", () => {
    expect(formatStroopsLocale(null, EN)).toBe("-");
  });

  it("returns '-' for undefined", () => {
    expect(formatStroopsLocale(undefined, EN)).toBe("-");
  });

  it("uses comma decimal in de-DE", () => {
    const result = formatStroopsLocale(15_000_000n, DE);
    expect(result).toContain(",");
  });
});

describe("formatUsdLocale", () => {
  it("formats USD with dollar symbol (en-US)", () => {
    expect(formatUsdLocale(49.99, EN)).toBe("$49.99");
  });

  it("formats USD with euro symbol for de-DE", () => {
    // de-DE shows USD as something like "49,99 $" or "49,99 US$"
    const result = formatUsdLocale(49.99, DE);
    expect(result).toContain("49");
  });

  it("formats large amounts with grouping", () => {
    const result = formatUsdLocale(1_234_567.89, EN);
    expect(result).toBe("$1,234,567.89");
  });

  it("returns '-' for null", () => {
    expect(formatUsdLocale(null, EN)).toBe("-");
  });

  it("returns '-' for undefined", () => {
    expect(formatUsdLocale(undefined, EN)).toBe("-");
  });

  it("returns '-' for NaN", () => {
    expect(formatUsdLocale(NaN, EN)).toBe("-");
  });

  it("returns '-' for Infinity", () => {
    expect(formatUsdLocale(Infinity, EN)).toBe("-");
  });
});
