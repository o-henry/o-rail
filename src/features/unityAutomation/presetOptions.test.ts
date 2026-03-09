import { describe, expect, it } from "vitest";
import {
  filterUnityAutomationPresetOptions,
  unityAutomationPresetLabel,
  VISIBLE_UNITY_AUTOMATION_PRESET_KINDS,
} from "./presetOptions";

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

  it("rewrites Unity automation labels into compact Korean names", () => {
    const filtered = filterUnityAutomationPresetOptions([
      { value: "unityCiDoctor", label: "Unity CI Doctor Template" },
      { value: "unityAddressablesDiet", label: "Unity Addressables / Asset Diet Template" },
    ]);

    expect(filtered.map((row) => row.label)).toEqual([
      unityAutomationPresetLabel("unityCiDoctor"),
      unityAutomationPresetLabel("unityAddressablesDiet"),
    ]);
  });
});
