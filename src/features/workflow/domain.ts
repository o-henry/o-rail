import type { GraphNode } from "./types";
import { t } from "../../i18n";
import type { TurnContextBudget } from "./turnExecutionTuning";

export type TurnExecutor =
  | "codex"
  | "via_flow"
  | "web_gemini"
  | "web_gpt"
  | "web_grok"
  | "web_perplexity"
  | "web_claude"
  | "ollama";

export type PresetKind =
  | "validation"
  | "development"
  | "research"
  | "expert"
  | "unityCiDoctor"
  | "unityTestsmith"
  | "unityBuildWatcher"
  | "unityLocalizationQa"
  | "unityAddressablesDiet"
  | "unityGame"
  | "fullstack"
  | "creative"
  | "newsTrend";

export type CostPreset = "conservative" | "balanced" | "aggressive";
export type WebAutomationMode = "bridgeAssisted" | "auto" | "manualPasteJson" | "manualPasteText";
export type WebResultMode = WebAutomationMode;
export type WebProvider = "gemini" | "gpt" | "grok" | "perplexity" | "claude";

export type QualityProfileId =
  | "code_implementation"
  | "research_evidence"
  | "design_planning"
  | "synthesis_final"
  | "generic";

export type ArtifactType =
  | "none"
  | "RequirementArtifact"
  | "DesignArtifact"
  | "TaskPlanArtifact"
  | "ChangePlanArtifact"
  | "EvidenceArtifact";

export type TurnConfig = {
  executor?: TurnExecutor;
  model?: string;
  reasoningLevel?: string;
  temperature?: number;
  contextBudget?: TurnContextBudget;
  maxInputChars?: number;
  role?: string;
  cwd?: string;
  promptTemplate?: string;
  outputSchemaJson?: string;
  knowledgeEnabled?: boolean;
  webResultMode?: WebResultMode;
  webTimeoutMs?: number;
  ollamaModel?: string;
  qualityProfile?: QualityProfileId;
  qualityThreshold?: number;
  qualityCommandEnabled?: boolean;
  qualityCommands?: string;
  artifactType?: ArtifactType;
  viaFlowId?: string;
  viaSourceTypeHint?: string;
  viaTemplateLabel?: string;
  viaCustomKeywords?: string;
  viaCustomCountries?: string;
  viaCustomSites?: string;
  viaCustomMaxItems?: number;
};

export const TURN_EXECUTOR_OPTIONS = [
  "codex",
  "via_flow",
  "web_gemini",
  "web_gpt",
  "web_grok",
  "web_perplexity",
  "web_claude",
  "ollama",
] as const;

export const TURN_EXECUTOR_LABELS: Record<TurnExecutor, string> = {
  codex: "Codex",
  via_flow: "RAG",
  web_gemini: "WEB / GEMINI",
  web_gpt: "WEB / GPT",
  web_grok: "WEB / GROK",
  web_perplexity: "WEB / PERPLEXITY",
  web_claude: "WEB / CLAUDE",
  ollama: "Ollama",
};

export const WEB_PROVIDER_OPTIONS: ReadonlyArray<WebProvider> = [
  "gemini",
  "gpt",
  "grok",
  "perplexity",
  "claude",
];

export const TURN_MODEL_OPTIONS = [
  "GPT-5.4",
  "GPT-5.3-Codex",
  "GPT-5.3-Codex-Spark",
  "GPT-5.2-Codex",
  "GPT-5.1-Codex-Max",
  "GPT-5.2",
  "GPT-5.1-Codex-Mini",
] as const;

export const DEFAULT_TURN_MODEL = TURN_MODEL_OPTIONS[0];

export const COST_PRESET_DEFAULT_MODEL: Record<CostPreset, (typeof TURN_MODEL_OPTIONS)[number]> = {
  conservative: "GPT-5.3-Codex",
  balanced: "GPT-5.2-Codex",
  aggressive: "GPT-5.1-Codex-Mini",
};

export const TURN_MODEL_CANONICAL_PAIRS: Array<{ display: string; engine: string }> = [
  { display: "GPT-5.4", engine: "gpt-5.4" },
  { display: "GPT-5.3-Codex", engine: "gpt-5.3-codex" },
  { display: "GPT-5.3-Codex-Spark", engine: "gpt-5.3-codex-spark" },
  { display: "GPT-5.2-Codex", engine: "gpt-5.2-codex" },
  { display: "GPT-5.1-Codex-Max", engine: "gpt-5.1-codex-max" },
  { display: "GPT-5.2", engine: "gpt-5.2" },
  { display: "GPT-5.1-Codex-Mini", engine: "gpt-5.1-codex-mini" },
];

export function toTurnModelDisplayName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_TURN_MODEL;
  }
  const matched = TURN_MODEL_CANONICAL_PAIRS.find(
    (item) => item.display.toLowerCase() === normalized || item.engine.toLowerCase() === normalized,
  );
  return matched?.display ?? value.trim();
}

export function toTurnModelEngineId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return TURN_MODEL_CANONICAL_PAIRS[0].engine;
  }
  const matched = TURN_MODEL_CANONICAL_PAIRS.find(
    (item) => item.display.toLowerCase() === normalized || item.engine.toLowerCase() === normalized,
  );
  return matched?.engine ?? value.trim();
}

export function isCostPreset(value: string): value is CostPreset {
  return value === "conservative" || value === "balanced" || value === "aggressive";
}

export function isPresetKind(value: string): value is PresetKind {
  return (
    value === "validation" ||
    value === "development" ||
    value === "research" ||
    value === "expert" ||
    value === "unityCiDoctor" ||
    value === "unityTestsmith" ||
    value === "unityBuildWatcher" ||
    value === "unityLocalizationQa" ||
    value === "unityAddressablesDiet" ||
    value === "unityGame" ||
    value === "fullstack" ||
    value === "creative" ||
    value === "newsTrend"
  );
}

export function costPresetLabel(preset: CostPreset): string {
  if (preset === "conservative") return t("option.cost.conservative");
  if (preset === "aggressive") return t("option.cost.aggressive");
  return t("option.cost.balanced");
}

export function getCostPresetTargetModel(
  preset: CostPreset,
  isCritical: boolean,
): (typeof TURN_MODEL_OPTIONS)[number] {
  if (preset === "aggressive") {
    return isCritical ? "GPT-5.2-Codex" : "GPT-5.1-Codex-Mini";
  }
  if (preset === "conservative") {
    return isCritical ? "GPT-5.3-Codex-Spark" : "GPT-5.3-Codex";
  }
  return isCritical ? "GPT-5.3-Codex" : "GPT-5.2-Codex";
}

export function getTurnExecutor(config: TurnConfig): TurnExecutor {
  const raw = String(config.executor ?? "codex");
  return TURN_EXECUTOR_OPTIONS.includes(raw as TurnExecutor) ? (raw as TurnExecutor) : "codex";
}

export function turnExecutorLabel(executor: TurnExecutor): string {
  if (executor === "ollama") {
    return t("feed.executor.ollama");
  }
  if (executor === "via_flow") {
    return "RAG";
  }
  return TURN_EXECUTOR_LABELS[executor];
}

export function getWebProviderFromExecutor(executor: TurnExecutor): WebProvider | null {
  switch (executor) {
    case "web_gemini":
      return "gemini";
    case "web_gpt":
      return "gpt";
    case "web_grok":
      return "grok";
    case "web_perplexity":
      return "perplexity";
    case "web_claude":
      return "claude";
    default:
      return null;
  }
}

export function webProviderLabel(provider: WebProvider): string {
  switch (provider) {
    case "gemini":
      return "GEMINI";
    case "gpt":
      return "GPT";
    case "grok":
      return "GROK";
    case "perplexity":
      return "PERPLEXITY";
    case "claude":
      return "CLAUDE";
    default:
      return String(provider).toUpperCase();
  }
}

export function webProviderHomeUrl(provider: WebProvider): string {
  switch (provider) {
    case "gemini":
      return "https://gemini.google.com/app";
    case "gpt":
      return "https://chatgpt.com/";
    case "grok":
      return "https://grok.com/";
    case "perplexity":
      return "https://www.perplexity.ai/";
    case "claude":
      return "https://claude.ai/";
    default:
      return "about:blank";
  }
}

export function normalizeWebResultMode(mode: unknown): WebResultMode {
  if (mode === "manualPasteJson" || mode === "manualPasteText") {
    return mode;
  }
  if (mode === "bridgeAssisted" || mode === "auto") {
    return "bridgeAssisted";
  }
  return "bridgeAssisted";
}

export function toQualityProfileId(value: unknown): QualityProfileId | null {
  if (
    value === "code_implementation" ||
    value === "research_evidence" ||
    value === "design_planning" ||
    value === "synthesis_final" ||
    value === "generic"
  ) {
    return value;
  }
  return null;
}

export function inferQualityProfile(node: GraphNode, config: TurnConfig): QualityProfileId {
  const explicit = toQualityProfileId(config.qualityProfile);
  if (explicit) {
    return explicit;
  }

  const executor = getTurnExecutor(config);
  const signal = `${String(config.role ?? "")} ${String(config.promptTemplate ?? "")} ${node.id}`.toLowerCase();
  if (
    executor === "via_flow" ||
    executor === "web_gemini" ||
    executor === "web_gpt" ||
    executor === "web_grok" ||
    executor === "web_perplexity" ||
    executor === "web_claude"
  ) {
    return "research_evidence";
  }
  if (/impl|code|test|lint|build|refactor|fix|bug|개발|구현|코드/.test(signal)) {
    return "code_implementation";
  }
  if (/research|evidence|search|fact|source|검증|자료|근거|조사/.test(signal)) {
    return "research_evidence";
  }
  if (/design|plan|architecture|요구|설계|기획/.test(signal)) {
    return "design_planning";
  }
  if (/final|synth|judge|평가|최종|합성/.test(signal)) {
    return "synthesis_final";
  }
  return "generic";
}

export function toArtifactType(value: unknown): ArtifactType {
  if (
    value === "RequirementArtifact" ||
    value === "DesignArtifact" ||
    value === "TaskPlanArtifact" ||
    value === "ChangePlanArtifact" ||
    value === "EvidenceArtifact"
  ) {
    return value;
  }
  return "none";
}
