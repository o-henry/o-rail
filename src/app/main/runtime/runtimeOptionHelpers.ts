import type { FancySelectOption } from "../../../components/FancySelect";
import { type PresetKind, type TurnConfig } from "../../../features/workflow/domain";
import { graphEquals } from "../../../features/workflow/graph-utils";
import {
  QUALITY_THRESHOLD_MAX,
  QUALITY_THRESHOLD_MIN,
  QUALITY_THRESHOLD_STEP,
  normalizeQualityScore,
  normalizeQualityThreshold,
} from "../../../features/workflow/quality";
import type {
  GraphData,
  GraphNode,
  NodeAnchorSide,
} from "../../../features/workflow/types";
import { t, tp } from "../../../i18n";
import type { AppLocale } from "../../../i18n";

export function getCodexMultiAgentModeOptions(locale?: AppLocale): ReadonlyArray<FancySelectOption> {
  return [
    { value: "off", label: t("option.multi.off", undefined, locale) },
    { value: "balanced", label: t("option.multi.balanced", undefined, locale) },
    { value: "max", label: t("option.multi.max", undefined, locale) },
  ];
}

export function getCostPresetOptions(locale?: AppLocale): FancySelectOption[] {
  return [
    { value: "conservative", label: t("option.cost.conservative", undefined, locale) },
    { value: "balanced", label: t("option.cost.balanced", undefined, locale) },
    { value: "aggressive", label: t("option.cost.aggressive", undefined, locale) },
  ];
}

export const NODE_ANCHOR_SIDES: NodeAnchorSide[] = ["top", "right", "bottom", "left"];

export function getQualityProfileOptions(locale?: AppLocale): FancySelectOption[] {
  return [
    { value: "code_implementation", label: t("option.quality.code_implementation", undefined, locale) },
    { value: "research_evidence", label: t("option.quality.research_evidence", undefined, locale) },
    { value: "design_planning", label: t("option.quality.design_planning", undefined, locale) },
    { value: "synthesis_final", label: t("option.quality.synthesis_final", undefined, locale) },
    { value: "generic", label: t("option.quality.generic", undefined, locale) },
  ];
}

export function getQualityThresholdOptions(locale?: AppLocale): FancySelectOption[] {
  return Array.from(
    { length: (QUALITY_THRESHOLD_MAX - QUALITY_THRESHOLD_MIN) / QUALITY_THRESHOLD_STEP + 1 },
    (_, index) => {
      const score = QUALITY_THRESHOLD_MIN + index * QUALITY_THRESHOLD_STEP;
      return { value: String(score), label: tp(`${score}점`, undefined, locale) };
    },
  );
}

export { normalizeQualityScore, normalizeQualityThreshold };

export function getArtifactTypeOptions(locale?: AppLocale): FancySelectOption[] {
  return [
    { value: "none", label: t("option.artifact.none", undefined, locale) },
    { value: "RequirementArtifact", label: t("option.artifact.requirement", undefined, locale) },
    { value: "DesignArtifact", label: t("option.artifact.design", undefined, locale) },
    { value: "TaskPlanArtifact", label: t("option.artifact.taskPlan", undefined, locale) },
    { value: "ChangePlanArtifact", label: t("option.artifact.changePlan", undefined, locale) },
    { value: "EvidenceArtifact", label: t("option.artifact.evidence", undefined, locale) },
  ];
}

const PRESET_TEMPLATE_META_KEYS: ReadonlyArray<{
  key: PresetKind;
  labelKey: string;
  statusLabelKey: string;
}> = [
  { key: "validation", labelKey: "preset.validation", statusLabelKey: "preset.validation" },
  { key: "development", labelKey: "preset.development", statusLabelKey: "preset.development" },
  { key: "research", labelKey: "preset.research", statusLabelKey: "preset.research" },
  { key: "expert", labelKey: "preset.expert", statusLabelKey: "preset.expert" },
  { key: "unityCiDoctor", labelKey: "preset.unityCiDoctor", statusLabelKey: "preset.unityCiDoctor" },
  { key: "unityTestsmith", labelKey: "preset.unityTestsmith", statusLabelKey: "preset.unityTestsmith" },
  { key: "unityBuildWatcher", labelKey: "preset.unityBuildWatcher", statusLabelKey: "preset.unityBuildWatcher" },
  { key: "unityLocalizationQa", labelKey: "preset.unityLocalizationQa", statusLabelKey: "preset.unityLocalizationQa" },
  { key: "unityAddressablesDiet", labelKey: "preset.unityAddressablesDiet", statusLabelKey: "preset.unityAddressablesDiet" },
  { key: "unityGame", labelKey: "preset.unityGame", statusLabelKey: "preset.unityGame" },
  { key: "fullstack", labelKey: "preset.fullstack", statusLabelKey: "preset.fullstack" },
  { key: "creative", labelKey: "preset.creative", statusLabelKey: "preset.creative" },
  { key: "newsTrend", labelKey: "preset.newsTrend", statusLabelKey: "preset.newsTrend" },
];

export function getPresetTemplateMeta(
  locale?: AppLocale,
): ReadonlyArray<{ key: PresetKind; label: string; statusLabel: string }> {
  return PRESET_TEMPLATE_META_KEYS.map((row) => ({
    key: row.key,
    label: t(row.labelKey, undefined, locale),
    statusLabel: t(row.statusLabelKey, undefined, locale),
  }));
}

export function getPresetTemplateOptions(locale?: AppLocale): FancySelectOption[] {
  return getPresetTemplateMeta(locale)
    .filter((row) => row.key !== "development")
    .map((row) => ({
      value: row.key,
      label: row.label,
    }));
}

export function presetTemplateLabel(kind: PresetKind, locale?: AppLocale): string {
  const row = getPresetTemplateMeta(locale).find((meta) => meta.key === kind);
  return row ? row.label : t("workflow.template", undefined, locale);
}

export function inferRunGroupMeta(
  currentGraph: GraphData,
  lastPreset: { kind: PresetKind; graph: GraphData } | null,
  locale?: AppLocale,
): { name: string; kind: "template" | "custom"; presetKind?: PresetKind } {
  if (lastPreset && graphEquals(lastPreset.graph, currentGraph)) {
    return {
      name: presetTemplateLabel(lastPreset.kind, locale),
      kind: "template",
      presetKind: lastPreset.kind,
    };
  }
  return {
    name: t("group.custom", undefined, locale),
    kind: "custom",
  };
}

export function isCriticalTurnNode(node: GraphNode): boolean {
  if (node.type !== "turn") {
    return false;
  }
  const config = node.config as TurnConfig;
  const signal = `${node.id} ${String(config.role ?? "")} ${String(config.promptTemplate ?? "")}`.toLowerCase();
  return /final|synth|judge|evaluat|quality|verif|검증|평가|판정|최종|합성/.test(signal);
}
