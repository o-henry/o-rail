import type { UnityAutomationPresetKind } from "./types";

export const VISIBLE_UNITY_AUTOMATION_PRESET_KINDS: ReadonlyArray<UnityAutomationPresetKind> = [
  "unityCiDoctor",
  "unityTestsmith",
  "unityBuildWatcher",
  "unityLocalizationQa",
  "unityAddressablesDiet",
];

const UNITY_AUTOMATION_PRESET_LABELS: Record<UnityAutomationPresetKind, string> = {
  unityCiDoctor: "유니티 CI 닥터",
  unityTestsmith: "유니티 테스트스미스",
  unityBuildWatcher: "빌드/용량 감시",
  unityLocalizationQa: "로컬라이제이션 QA",
  unityAddressablesDiet: "Addressables / 에셋 다이어트",
};

export function unityAutomationPresetLabel(value: UnityAutomationPresetKind): string {
  return UNITY_AUTOMATION_PRESET_LABELS[value];
}

export function filterUnityAutomationPresetOptions<T extends { value: string; label: string }>(
  options: ReadonlyArray<T>,
): T[] {
  return options
    .filter((option) => VISIBLE_UNITY_AUTOMATION_PRESET_KINDS.includes(option.value as UnityAutomationPresetKind))
    .map((option) => ({
      ...option,
      label: unityAutomationPresetLabel(option.value as UnityAutomationPresetKind),
    }));
}
