import {
  formatCurrency,
  formatXLM,
  formatUSD,
  formatNumber,
  formatCompactNumber,
  formatPercent,
  stroopsToXlmNumber,
} from "../formatters";

/**
 * Converts stroops (smallest unit) to an XLM string using Intl.NumberFormat.
 * 1 XLM = 10,000,000 stroops.
 *
 * @param stroops  Amount in stroops (bigint)
 * @param locale   BCP 47 locale tag (e.g. "en-US", "de-DE"). Defaults to the
 *                 runtime locale so the decimal separator matches the user's OS.
 */
export function stroopsToXlmString(stroops: bigint, locale?: string): string {
  const xlm = Number(stroops) / 10_000_000;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 7 }).format(
    xlm,
  );
}

export function formatPriceLabel(
  value: bigint | number,
  locale?: string,
): string {
  const xlm =
    typeof value === "bigint"
      ? stroopsToXlmString(value, locale)
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 7 }).format(
          value,
        );
  return `${xlm} XLM`;
}

/**
 * Converts an XLM decimal value to stroops without floating-point rounding.
 */
export function xlmToStroops(xlm: number | string): bigint {
  return BigInt(Math.round(Number(xlm) * 10_000_000));
}

/**
 * Formats an address for display (truncated)
 */
export function formatAddress(
  address: string,
  prefixLength = 8,
  suffixLength = 4,
): string {
  if (address.length <= prefixLength + suffixLength) {
    return address;
  }
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

export {
  formatCurrency,
  formatXLM,
  formatUSD,
  formatNumber,
  formatCompactNumber,
  formatPercent,
  stroopsToXlmNumber,
};
