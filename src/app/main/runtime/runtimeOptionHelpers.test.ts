import { describe, expect, it } from "vitest";
import { getPresetTemplateMeta, getPresetTemplateOptions, presetTemplateLabel } from "./runtimeOptionHelpers";

describe("runtime preset template options", () => {
  it("includes Unity CI Doctor in preset metadata and selectable options", () => {
    const meta = getPresetTemplateMeta("ko");
    const options = getPresetTemplateOptions("ko");

    expect(meta.some((row) => row.key === "unityCiDoctor" && row.label.includes("CI"))).toBe(true);
    expect(options.some((row) => row.value === "unityCiDoctor")).toBe(true);
    expect(presetTemplateLabel("unityCiDoctor", "en")).toContain("Unity CI Doctor");
  });
});
