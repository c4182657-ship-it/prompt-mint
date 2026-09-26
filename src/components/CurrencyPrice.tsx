import { useTranslation } from "react-i18next";
import { stroopsToXlmString } from "@/lib/stellar/format";
import { useCurrency } from "@/providers/CurrencyProvider";

/**
 * Renders a stroop amount as a locale-aware XLM or USD string.
 *
 * The active i18n language drives the Intl.NumberFormat locale so decimal
 * and grouping separators match the user's selected language automatically.
 */
export function CurrencyPrice({ stroops }: { stroops: bigint }) {
  const { currency, xlmUsdRate } = useCurrency();
  const { i18n } = useTranslation();
  const locale = i18n.language || undefined;

  if (currency === "USD" && xlmUsdRate) {
    const xlmNum = Number(stroops) / 10_000_000;
    return (
      <>
        {new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
        }).format(xlmNum * xlmUsdRate)}
      </>
    );
  }

  return <>{stroopsToXlmString(stroops, locale)} XLM</>;
}
