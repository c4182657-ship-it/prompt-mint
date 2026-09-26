/**
 * i18n-aware number and currency formatting helpers (#i18n-scaffold)
 *
 * These helpers bridge react-i18next's active language with Intl.NumberFormat
 * so that number display (grouping separators, decimal marks, currency symbols)
 * automatically tracks the language the user has selected in the UI.
 *
 * Usage (inside a React component):
 *
 *   import { useXlmFormatter, useUsdFormatter } from "@/lib/i18n-number";
 *
 *   const formatXlm = useXlmFormatter();
 *   const formatUsd = useUsdFormatter();
 *
 *   // stroops bigint → locale-aware string, e.g. "1,234.57 XLM" or "1.234,57 XLM"
 *   formatXlm(12_345_678_900n, "stroops")   // → "1,234.57 XLM"
 *
 * Usage outside React (e.g. scripts, server utilities):
 *
 *   import { formatXlmLocale } from "@/lib/i18n-number";
 *   formatXlmLocale(12_345_678_900n, "stroops", "de-DE")  // → "1.234,57 XLM"
 *
 * Adding a new locale:
 *   1. Add the locale JSON file to src/i18n/locales/<code>.json
 *   2. Import and register it in src/i18n/index.ts
 *   3. Add the entry to SUPPORTED_LANGUAGES in src/i18n/index.ts
 *   No changes are needed here — Intl.NumberFormat supports all IETF BCP 47
 *   locale tags natively in modern browsers and Node 18+.
 */

import { useTranslation } from "react-i18next";

/** Stroops per XLM (Stellar network constant). */
const STROOPS_PER_XLM = 10_000_000;

// ---------------------------------------------------------------------------
// Pure (non-React) helpers — safe to call in scripts and SSR contexts
// ---------------------------------------------------------------------------

/**
 * Format an XLM value (from stroops or XLM float) as a locale-aware string.
 *
 * @param amount   Stroop count (bigint/number) or XLM decimal (number/string)
 * @param unit     "stroops" converts to XLM first; "xlm" uses the value as-is
 * @param locale   BCP 47 locale tag (e.g. "en-US"). Pass `undefined` to use
 *                 the runtime default.
 * @param decimals Fraction digits shown (default 2; max 7 for stroop precision)
 * @param showUnit Whether to append " XLM" (default true)
 */
export function formatXlmLocale(
  amount: bigint | number | string | null | undefined,
  unit: "stroops" | "xlm" = "stroops",
  locale?: string,
  decimals = 2,
  showUnit = true,
): string {
  if (amount === null || amount === undefined || amount === "") return "-";

  let xlmValue: number;
  if (unit === "stroops" || typeof amount === "bigint") {
    xlmValue = Number(amount) / STROOPS_PER_XLM;
  } else {
    xlmValue = Number(amount);
  }

  if (!Number.isFinite(xlmValue)) return "-";

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: Math.max(decimals, 7),
  }).format(xlmValue);

  return showUnit ? `${formatted} XLM` : formatted;
}

/**
 * Format a stroop count as a locale-aware 7-decimal string without the unit
 * suffix. Useful for input field display where the "XLM" label is separate.
 */
export function formatStroopsLocale(
  stroops: bigint | number | null | undefined,
  locale?: string,
): string {
  if (stroops === null || stroops === undefined) return "-";
  const xlm = Number(stroops) / STROOPS_PER_XLM;
  if (!Number.isFinite(xlm)) return "-";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  }).format(xlm);
}

/**
 * Format a USD amount as a locale-aware currency string.
 */
export function formatUsdLocale(
  amount: number | null | undefined,
  locale?: string,
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "-";
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// ---------------------------------------------------------------------------
// React hooks — read the active i18next language automatically
// ---------------------------------------------------------------------------

/**
 * Returns a locale-aware XLM formatter bound to the currently active i18n
 * language. Re-renders when the language changes.
 *
 * @example
 *   const fmt = useXlmFormatter();
 *   fmt(50_000_000n)                    // "5.00 XLM"  (en-US)
 *   fmt(50_000_000n, "stroops", 7)      // "5.0000000 XLM"
 *   fmt(5.5, "xlm")                     // "5.50 XLM"
 */
export function useXlmFormatter() {
  const { i18n } = useTranslation();
  const locale = i18n.language || undefined;

  return (
    amount: bigint | number | string | null | undefined,
    unit: "stroops" | "xlm" = "stroops",
    decimals = 2,
    showUnit = true,
  ) => formatXlmLocale(amount, unit, locale, decimals, showUnit);
}

/**
 * Returns a locale-aware stroop formatter bound to the current i18n language.
 * Outputs XLM decimal with up to 7 fraction digits, no unit suffix.
 */
export function useStroopsFormatter() {
  const { i18n } = useTranslation();
  const locale = i18n.language || undefined;
  return (stroops: bigint | number | null | undefined) =>
    formatStroopsLocale(stroops, locale);
}

/**
 * Returns a locale-aware USD formatter bound to the current i18n language.
 */
export function useUsdFormatter() {
  const { i18n } = useTranslation();
  const locale = i18n.language || undefined;
  return (amount: number | null | undefined) => formatUsdLocale(amount, locale);
}
