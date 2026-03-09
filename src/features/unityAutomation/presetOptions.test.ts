import { describe, expect, it } from "vitest";
import { filterUnityAutomationPresetOptions, VISIBLE_UNITY_AUTOMATION_PRESET_KINDS } from "./presetOptions";

describe("unity automation preset options", () => {
  it("keeps only the five Unity automation presets visible", () => {
    const filtered = filterUnityAutomationPresetOptions([
      { value: "validation", label: "Validation" },
      { value: "unityCiDoctor", label: "CI Doctor" },
      { value: "unityTestsmith", label: "Testsmith" },
      { value: "unityBuildWatcher", label: "Build Watcher" },
      { value: "unityLocalizationQa", label: "Localization QA" },
      { value: "unityAddressablesDiet", label: "Asset Diet" },
      { value: "unityGame", label: "Unity Game" },
    ]);

    expect(filtered.map((row) => row.value)).toEqual(VISIBLE_UNITY_AUTOMATION_PRESET_KINDS);
  });
});
