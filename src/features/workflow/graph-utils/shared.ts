import {
  DEFAULT_TURN_MODEL,
  getTurnExecutor,
  toTurnModelDisplayName,
  turnExecutorLabel,
  type TurnConfig,
} from "../domain";
import { t } from "../../../i18n";
import { DEFAULT_TURN_REASONING_LEVEL } from "../reasoningLevels";
import type {
  GateConfig,
  GraphNode,
  NodeAnchorSide,
  NodeType,
  TransformConfig,
} from "../types";

export type LogicalPoint = {
  x: number;
  y: number;
};

export type NodeVisualSize = {
  width: number;
  height: number;
};

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 168;
export const NODE_ANCHOR_OFFSET = 15;
export const QUALITY_DEFAULT_THRESHOLD = 70;
export const SIMPLE_WORKFLOW_UI = true;
export const AUTO_LAYOUT_START_X = 40;
export const AUTO_LAYOUT_START_Y = 40;
export const AUTO_LAYOUT_COLUMN_GAP = 320;
export const AUTO_LAYOUT_ROW_GAP = 184;
export const AUTO_EDGE_STRAIGHTEN_THRESHOLD = 72;

export function makeNodeId(type: NodeType): string {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${type}-${suffix}`;
}

export function defaultNodeConfig(type: NodeType): Record<string, unknown> {
  if (type === "turn") {
    return {
      executor: "codex",
      model: DEFAULT_TURN_MODEL,
      reasoningLevel: DEFAULT_TURN_REASONING_LEVEL,
      role: "",
      cwd: ".",
      promptTemplate: "{{input}}",
      outputSchemaJson: "",
      knowledgeEnabled: true,
      qualityThreshold: QUALITY_DEFAULT_THRESHOLD,
      artifactType: "none",
      qualityCommandEnabled: false,
      qualityCommands: "npm run build",
    };
  }

  if (type === "transform") {
    return {
      mode: "pick",
      pickPath: "text",
      mergeJson: "{}",
      template: "{{input}}",
    };
  }

  return {
    decisionPath: "DECISION",
    passNodeId: "",
    rejectNodeId: "",
    schemaJson: "",
  };
}

export function nodeCardSummary(node: GraphNode): string {
  if (node.type === "turn") {
    return "";
  }
  if (SIMPLE_WORKFLOW_UI) {
    return "";
  }
  if (node.type === "transform") {
    const config = node.config as TransformConfig;
    const mode = String(config.mode ?? "pick");
    if (mode === "merge") {
      return `${t("workflow.inspector.transform.mode")}: ${t("transform.mode.merge")}`;
    }
    if (mode === "template") {
      return `${t("workflow.inspector.transform.mode")}: ${t("transform.mode.template")}`;
    }
    return `${t("workflow.inspector.transform.mode")}: ${t("transform.mode.pick")}`;
  }
  const config = node.config as GateConfig;
  const path = String(config.decisionPath ?? "DECISION");
  return `${t("workflow.inspector.gate.decisionPath")}: ${path === "decision" ? "DECISION" : path}`;
}

export function turnModelLabel(node: GraphNode): string {
  const config = node.config as TurnConfig;
  const executor = getTurnExecutor(config);
  if (executor === "ollama") {
    return `Ollama · ${String(config.ollamaModel ?? "llama3.1:8b")}`;
  }
  if (executor !== "codex") {
    return turnExecutorLabel(executor);
  }
  return toTurnModelDisplayName(String(config.model ?? DEFAULT_TURN_MODEL));
}

export type { NodeAnchorSide };
