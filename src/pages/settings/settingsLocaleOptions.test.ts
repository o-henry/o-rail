import { describe, expect, it } from "vitest";
import { buildSettingsLocaleOptions, detectPreferredLocale, orderLocalesByPreference } from "./settingsLocaleOptions";

describe("settingsLocaleOptions", () => {
  it("detects the preferred locale from browser language tags", () => {
    expect(detectPreferredLocale(["ko-KR", "en-US"])).toBe("ko");
    expect(detectPreferredLocale("ja-JP")).toBe("jp");
    expect(detectPreferredLocale("zh-CN")).toBe("zh");
    expect(detectPreferredLocale("en-US")).toBe("en");
  });

  it("puts the preferred locale first while preserving the remaining order", () => {
    expect(orderLocalesByPreference("en")).toEqual(["en", "ko"]);
    expect(orderLocalesByPreference("zh")).toEqual(["en", "ko"]);
    expect(orderLocalesByPreference("ko")).toEqual(["ko", "en"]);
  });

  it("builds locale options in preferred order", () => {
    const options = buildSettingsLocaleOptions("jp", (locale) => locale.toUpperCase());
    expect(options.map((option) => option.value)).toEqual(["en", "ko"]);
    expect(options[0]?.label).toBe("EN");
  });
});
