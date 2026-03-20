import type { FancySelectOption } from "../../components/FancySelect";
import type { AppLocale } from "../../i18n";

const DEFAULT_LOCALE_ORDER: AppLocale[] = ["ko", "en"];

export function detectPreferredLocale(input: string | readonly string[] | null | undefined): AppLocale {
  const values = Array.isArray(input) ? input : [input ?? ""];
  for (const value of values) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (normalized.startsWith("ko")) {
      return "ko";
    }
    if (normalized.startsWith("en")) {
      return "en";
    }
    if (normalized.startsWith("ja") || normalized.startsWith("jp")) {
      return "jp";
    }
    if (normalized.startsWith("zh")) {
      return "zh";
    }
  }
  return "en";
}

export function orderLocalesByPreference(preferred: AppLocale): AppLocale[] {
  const normalizedPreferred = preferred === "ko" ? "ko" : "en";
  return [normalizedPreferred, ...DEFAULT_LOCALE_ORDER.filter((locale) => locale !== normalizedPreferred)];
}

export function buildSettingsLocaleOptions(
  preferred: AppLocale,
  labelForLocale: (locale: AppLocale) => string,
): FancySelectOption[] {
  return orderLocalesByPreference(preferred).map((locale) => ({
    value: locale,
    label: labelForLocale(locale),
  }));
}
