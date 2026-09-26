/**
 * Currency and Number Formatting Utilities
 *
 * Provides safe, locale-aware formatting for XLM, USD, percentages,
 * compact numbers, and general numeric values with complete edge-case handling.
 *
 * All XLM/stroop display uses Intl.NumberFormat so the output respects the
 * active browser locale. Pass an explicit `locale` option to pin the locale
 * (useful in tests or SSR contexts where navigator.language is unavailable).
 */

export interface FormatCurrencyOptions {
  decimals?: number;
  showSymbol?: boolean;
  fallback?: string;
  inputUnit?: "stroops" | "xlm";
  /** BCP 47 locale tag, e.g. "en-US", "de-DE". Defaults to the runtime locale. */
  locale?: string;
}

export interface FormatNumberOptions extends Intl.NumberFormatOptions {
  fallback?: string;
  /** BCP 47 locale tag. Defaults to the runtime locale. */
  locale?: string;
}

export interface FormatCompactOptions {
  decimals?: number;
  fallback?: string;
  /** BCP 47 locale tag. Defaults to the runtime locale. */
  locale?: string;
}

const STROOPS_PER_XLM = 10_000_000n;

/**
 * Safely converts string, number, or bigint to a number or bigint value.
 */
function parseNumericValue(
  value: number | bigint | string | null | undefined,
): { num: number | null; isBigInt: boolean; rawBigInt?: bigint } {
  if (value === null || value === undefined || value === "") {
    return { num: null, isBigInt: false };
  }

  if (typeof value === "bigint") {
    return { num: Number(value), isBigInt: true, rawBigInt: value };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { num: null, isBigInt: false };
    }
    return { num: value, isBigInt: false };
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return { num: null, isBigInt: false };
  }

  // Try parsing integer for bigint representation if needed
  try {
    const parsedNum = Number(trimmed);
    if (!Number.isFinite(parsedNum)) {
      return { num: null, isBigInt: false };
    }
    return { num: parsedNum, isBigInt: false };
  } catch {
    return { num: null, isBigInt: false };
  }
}

/**
 * Converts stroops (bigint/number/string) to XLM number
 */
export function stroopsToXlmNumber(
  stroops: bigint | number | string | null | undefined,
): number | null {
  if (stroops === null || stroops === undefined || stroops === "") {
    return null;
  }

  if (typeof stroops === "bigint") {
    return Number(stroops) / Number(STROOPS_PER_XLM);
  }

  const parsed = parseNumericValue(stroops);
  if (parsed.num === null) return null;
  return parsed.num / Number(STROOPS_PER_XLM);
}

/**
 * Formats a value as a currency string (default XLM).
 */
export function formatCurrency(
  amount: number | bigint | string | null | undefined,
  currency = "XLM",
  options: FormatCurrencyOptions = {},
): string {
  const {
    decimals = 2,
    showSymbol = true,
    fallback = "-",
    inputUnit,
    locale,
  } = options;

  if (currency.toUpperCase() === "XLM") {
    let xlmVal: number | null = null;
    if (inputUnit === "stroops" || typeof amount === "bigint") {
      xlmVal = stroopsToXlmNumber(amount);
    } else {
      const parsed = parseNumericValue(amount);
      xlmVal = parsed.num;
    }

    if (xlmVal === null || isNaN(xlmVal)) return fallback;

    // Use Intl.NumberFormat so decimal/grouping separators respect the active
    // browser locale (e.g. "1.234,56" in de-DE vs "1,234.56" in en-US).
    // `locale` is undefined by default, which lets the runtime pick the locale
    // from navigator.language — matching how the rest of the UI is localised.
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(xlmVal);

    return showSymbol ? `${formatted} XLM` : formatted;
  }

  // Standard ISO currencies (USD, EUR, GBP, etc.)
  const parsed = parseNumericValue(amount);
  if (parsed.num === null || isNaN(parsed.num)) return fallback;

  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: showSymbol ? "currency" : "decimal",
      currency: currency.toUpperCase(),
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return formatter.format(parsed.num);
  } catch {
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(parsed.num);
    return showSymbol ? `${currency.toUpperCase()} ${formatted}` : formatted;
  }
}

/**
 * Formats a prompt price (in stroops or XLM) into a clean string label for UI elements.
 */
export function formatPriceLabel(
  stroopsOrXlm: bigint | number | string | null | undefined,
  unit: "stroops" | "xlm" = "stroops",
  locale?: string,
): string {
  if (
    stroopsOrXlm === null ||
    stroopsOrXlm === undefined ||
    stroopsOrXlm === ""
  ) {
    return "-";
  }

  let xlmValue: number | null = null;
  if (unit === "stroops" || typeof stroopsOrXlm === "bigint") {
    xlmValue = stroopsToXlmNumber(stroopsOrXlm);
  } else {
    const parsed = parseNumericValue(stroopsOrXlm);
    xlmValue = parsed.num;
  }

  if (xlmValue === null || isNaN(xlmValue)) return "-";

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  }).format(xlmValue);
}

/**
 * Formats XLM amount with optional unit suffix.
 */
export function formatXLM(
  amount: bigint | number | string | null | undefined,
  options: {
    showUnit?: boolean;
    decimals?: number;
    inputUnit?: "stroops" | "xlm";
  } = {},
): string {
  const { showUnit = true, decimals = 2, inputUnit = "stroops" } = options;
  return formatCurrency(amount, "XLM", {
    decimals,
    showSymbol: showUnit,
    inputUnit,
  });
}

/**
 * Formats USD amount with dollar symbol.
 */
export function formatUSD(
  amount: number | string | null | undefined,
  options: { showSymbol?: boolean; decimals?: number } = {},
): string {
  const { showSymbol = true, decimals = 2 } = options;
  return formatCurrency(amount, "USD", {
    decimals,
    showSymbol,
  });
}

/**
 * General number formatter with Intl.NumberFormat and safe fallback.
 */
export function formatNumber(
  value: number | bigint | string | null | undefined,
  options: FormatNumberOptions = {},
): string {
  const { fallback = "-", locale, ...intlOptions } = options;
  const parsed = parseNumericValue(value);
  if (parsed.num === null || isNaN(parsed.num)) return fallback;

  try {
    return new Intl.NumberFormat(locale, intlOptions).format(parsed.num);
  } catch {
    return parsed.num.toString();
  }
}

/**
 * Formats large numbers compactly (e.g. 1.2K, 3.4M).
 */
export function formatCompactNumber(
  value: number | bigint | string | null | undefined,
  options: FormatCompactOptions = {},
): string {
  const { decimals = 1, fallback = "-", locale } = options;
  const parsed = parseNumericValue(value);
  if (parsed.num === null || isNaN(parsed.num)) return fallback;

  try {
    return new Intl.NumberFormat(locale, {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: decimals,
    }).format(parsed.num);
  } catch {
    return parsed.num.toString();
  }
}

/**
 * Formats a percentage value (e.g. 0.05 -> "5.00%" or 12.5 -> "12.50%").
 */
export function formatPercent(
  value: number | string | null | undefined,
  decimals = 2,
  options: { fallback?: string; isDecimalRatio?: boolean } = {},
): string {
  const { fallback = "-", isDecimalRatio = false } = options;
  const parsed = parseNumericValue(value);
  if (parsed.num === null || isNaN(parsed.num)) return fallback;

  const pctValue = isDecimalRatio ? parsed.num * 100 : parsed.num;
  return `${pctValue.toFixed(decimals)}%`;
}
