import { describe, expect, it } from "vitest";
import { getPresetTemplateMeta, getPresetTemplateOptions, presetTemplateLabel } from "./runtimeOptionHelpers";

describe("runtime preset template options", () => {
  it("includes Unity CI Doctor in preset metadata and selectable options", () => {
    const meta = getPresetTemplateMeta("ko");
    const options = getPresetTemplateOptions("ko");

    expect(meta.some((row) => row.key === "unityCiDoctor" && row.label.includes("CI"))).toBe(true);
    expect(meta.some((row) => row.key === "unityTestsmith" && row.label.includes("Testsmith"))).toBe(true);
    expect(meta.some((row) => row.key === "unityBuildWatcher" && row.label.includes("Build"))).toBe(true);
    expect(meta.some((row) => row.key === "unityLocalizationQa" && row.label.includes("Localization"))).toBe(true);
    expect(meta.some((row) => row.key === "unityAddressablesDiet" && row.label.includes("Addressables"))).toBe(true);
    expect(options.some((row) => row.value === "unityCiDoctor")).toBe(true);
    expect(presetTemplateLabel("unityCiDoctor", "en")).toContain("Unity CI Doctor");
    expect(presetTemplateLabel("unityTestsmith", "en")).toContain("Testsmith");
  });
});
