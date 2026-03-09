import type { UnityAutomationPresetKind, UnityBatchAction } from "./types";

export type UnityBatchActionOption = {
  action: UnityBatchAction;
  label: string;
};

const UNITY_PRESET_ACTIONS: Record<UnityAutomationPresetKind, UnityBatchActionOption[]> = {
  unityCiDoctor: [
    { action: "build", label: "빌드" },
    { action: "tests_edit", label: "EditMode" },
    { action: "tests_play", label: "PlayMode" },
  ],
  unityTestsmith: [
    { action: "tests_edit", label: "EditMode" },
    { action: "tests_play", label: "PlayMode" },
  ],
  unityBuildWatcher: [{ action: "build", label: "빌드" }],
  unityLocalizationQa: [{ action: "build", label: "검증 빌드" }],
  unityAddressablesDiet: [{ action: "build", label: "Addr 빌드" }],
};

export function batchActionsForUnityPreset(kind: string): UnityBatchActionOption[] {
  if (!(kind in UNITY_PRESET_ACTIONS)) {
    return [];
  }
  return UNITY_PRESET_ACTIONS[kind as UnityAutomationPresetKind];
}
