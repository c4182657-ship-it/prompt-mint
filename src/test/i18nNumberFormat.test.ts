/**
 * i18n number_format locale key coverage tests.
 *
 * Verifies that every supported locale has all required number_format keys
 * and that interpolation works correctly for price_label variants.
 */
import { describe, it, expect, beforeEach } from "vitest";
import i18n from "../i18n";

const LOCALES = ["en", "es", "fr", "zh", "ja"] as const;

const REQUIRED_NUMBER_FORMAT_KEYS = [
  "number_format.xlm_unit",
  "number_format.stroop_unit",
  "number_format.stroop_unit_plural",
  "number_format.stroops_per_xlm",
  "number_format.price_label",
  "number_format.price_label_usd",
] as const;

describe("i18n number_format keys", () => {
  beforeEach(() => {
    i18n.changeLanguage("en");
  });

  describe("English baseline values", () => {
    it("has xlm_unit key", () => {
      expect(i18n.t("number_format.xlm_unit")).toBe("XLM");
    });

    it("has stroop_unit key", () => {
      expect(i18n.t("number_format.stroop_unit")).toBe("stroop");
    });

    it("has stroop_unit_plural key", () => {
      expect(i18n.t("number_format.stroop_unit_plural")).toBe("stroops");
    });

    it("has stroops_per_xlm explanation string", () => {
      const val = i18n.t("number_format.stroops_per_xlm");
      expect(val).toContain("10,000,000");
      expect(val).toContain("XLM");
    });

    it("interpolates amount into price_label", () => {
      expect(i18n.t("number_format.price_label", { amount: "5.00" })).toBe(
        "5.00 XLM"
      );
    });

    it("interpolates amount into price_label_usd", () => {
      expect(i18n.t("number_format.price_label_usd", { amount: "4.99" })).toBe(
        "4.99 USD"
      );
    });
  });

  describe("Japanese locale has stroop transliteration", () => {
    it("has stroop_unit in katakana", () => {
      i18n.changeLanguage("ja");
      const val = i18n.t("number_format.stroop_unit");
      expect(val).toContain("ストループ");
    });
  });

  describe("all locales have all required number_format keys", () => {
    for (const locale of LOCALES) {
      it(`locale '${locale}' has all required keys`, () => {
        i18n.changeLanguage(locale);
        for (const key of REQUIRED_NUMBER_FORMAT_KEYS) {
          const translated = i18n.t(key, { amount: "1.00" });
          // Must be truthy and not fall back to the raw key
          expect(translated, `${locale}: missing key '${key}'`).toBeTruthy();
          expect(translated, `${locale}: key '${key}' returned raw key`).not.toBe(key);
        }
      });
    }
  });

  describe("price_label interpolation across locales", () => {
    for (const locale of LOCALES) {
      it(`locale '${locale}' interpolates price_label correctly`, () => {
        i18n.changeLanguage(locale);
        const result = i18n.t("number_format.price_label", { amount: "3.50" });
        expect(result).toContain("3.50");
        expect(result).toContain("XLM");
      });
    }
  });
});
