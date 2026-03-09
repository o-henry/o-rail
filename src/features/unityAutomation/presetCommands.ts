import type { UnityAutomationPresetKind, UnityBatchAction } from "./types";

export type UnityBatchActionOption = {
  action: UnityBatchAction;
  label: string;
};

const UNITY_PRESET_ACTIONS: Record<UnityAutomationPresetKind, UnityBatchActionOption[]> = {
  unityCiDoctor: [
    { action: "build", label: "빌드 미리보기" },
    { action: "tests_edit", label: "EditMode 테스트" },
    { action: "tests_play", label: "PlayMode 테스트" },
  ],
  unityTestsmith: [
    { action: "tests_edit", label: "EditMode 테스트" },
    { action: "tests_play", label: "PlayMode 테스트" },
  ],
  unityBuildWatcher: [{ action: "build", label: "빌드 미리보기" }],
  unityLocalizationQa: [{ action: "build", label: "로컬라이즈 검증 빌드" }],
  unityAddressablesDiet: [{ action: "build", label: "Addressables 빌드" }],
};

export function batchActionsForUnityPreset(kind: string): UnityBatchActionOption[] {
  if (!(kind in UNITY_PRESET_ACTIONS)) {
    return [];
  }
  return UNITY_PRESET_ACTIONS[kind as UnityAutomationPresetKind];
}
