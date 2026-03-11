import type {
  ArtifactType,
  QualityProfileId,
} from "../domain";
import type { GraphNode, KnowledgeConfig, NodeType } from "../types";
import {
  DEFAULT_TURN_CONTEXT_BUDGET,
  DEFAULT_TURN_TEMPERATURE,
  TURN_CONTEXT_BUDGET_MAX_INPUT_CHARS,
  type TurnContextBudget,
} from "../turnExecutionTuning";

export const GRAPH_SCHEMA_VERSION = 3;
const KNOWLEDGE_DEFAULT_TOP_K = 0;
const KNOWLEDGE_DEFAULT_MAX_CHARS = 2800;
export const QUALITY_DEFAULT_THRESHOLD = 70;
const QUALITY_THRESHOLD_MIN = 10;
const QUALITY_THRESHOLD_MAX = 100;
const QUALITY_THRESHOLD_STEP = 10;
export const PREPROCESS_NODE_SHIFT_X = 300;
export const PREPROCESS_NODE_X = 120;

export function defaultKnowledgeConfig(): KnowledgeConfig {
  return {
    files: [],
    topK: KNOWLEDGE_DEFAULT_TOP_K,
    maxChars: KNOWLEDGE_DEFAULT_MAX_CHARS,
  };
}

export function normalizeQualityThreshold(value: unknown): number {
  const parsed = Number(value);
  const fallback = QUALITY_DEFAULT_THRESHOLD;
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  const clamped = Math.max(QUALITY_THRESHOLD_MIN, Math.min(QUALITY_THRESHOLD_MAX, safe));
  return Math.round(clamped / QUALITY_THRESHOLD_STEP) * QUALITY_THRESHOLD_STEP;
}
export function makePresetNode(
  id: string,
  type: NodeType,
  x: number,
  y: number,
  config: Record<string, unknown>,
): GraphNode {
  return {
    id,
    type,
    position: { x, y },
    config,
  };
}

export type PresetTurnPolicy = {
  profile: QualityProfileId;
  threshold: number;
  qualityCommandEnabled: boolean;
  qualityCommands: string;
  artifactType: ArtifactType;
  temperature: number;
  contextBudget: TurnContextBudget;
  maxInputChars: number;
};

export const DEFAULT_PRESET_TURN_POLICY: PresetTurnPolicy = {
  profile: "generic",
  threshold: QUALITY_DEFAULT_THRESHOLD,
  qualityCommandEnabled: false,
  qualityCommands: "npm run build",
  artifactType: "none",
  temperature: DEFAULT_TURN_TEMPERATURE,
  contextBudget: DEFAULT_TURN_CONTEXT_BUDGET,
  maxInputChars: TURN_CONTEXT_BUDGET_MAX_INPUT_CHARS[DEFAULT_TURN_CONTEXT_BUDGET],
};
