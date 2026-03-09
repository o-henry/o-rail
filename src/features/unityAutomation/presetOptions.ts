import type { UnityAutomationPresetKind } from "./types";

export const VISIBLE_UNITY_AUTOMATION_PRESET_KINDS: ReadonlyArray<UnityAutomationPresetKind> = [
  "unityCiDoctor",
  "unityTestsmith",
  "unityBuildWatcher",
  "unityLocalizationQa",
  "unityAddressablesDiet",
];

export function filterUnityAutomationPresetOptions<T extends { value: string }>(options: ReadonlyArray<T>): T[] {
  return options.filter((option) =>
    VISIBLE_UNITY_AUTOMATION_PRESET_KINDS.includes(option.value as UnityAutomationPresetKind),
  );
}
