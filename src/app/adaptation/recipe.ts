import type { GraphData } from "../../features/workflow/types";
import type { ArtifactType, PresetKind } from "../../features/workflow/domain";
import type { StudioRoleId } from "../../features/studio/handoffTypes";
import { collectAdaptiveTurnNodes, buildGraphShapeHash, buildPromptPackHash, buildTuningBundleHash, hashAdaptiveText } from "./graphShape";
import { resolveAdaptiveFamilyBucket } from "./families";
import { normalizeAdaptiveWorkspaceKey } from "./workspace";
import type { AdaptiveFamilyKey, AdaptiveRecipeSnapshot } from "./types";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function cloneGraph(graph: GraphData): GraphData {
  return JSON.parse(JSON.stringify(graph)) as GraphData;
}

export function extractPrimaryRoleIds(graph: GraphData): StudioRoleId[] {
  return graph.nodes
    .filter((node) => {
      const config = (node.config ?? {}) as Record<string, unknown>;
      return (
        node.type === "turn" &&
        clean(config.sourceKind).toLowerCase() === "handoff" &&
        !clean(config.internalParentNodeId) &&
        (!clean(config.roleMode) || clean(config.roleMode) === "primary")
      );
    })
    .map((node) => clean((node.config as Record<string, unknown>).handoffRoleId) as StudioRoleId)
    .filter(Boolean)
    .filter((roleId, index, rows) => rows.indexOf(roleId) === index);
}

function resolveRoleTemplateNodeId(graph: GraphData, roleId: StudioRoleId): string | undefined {
  return graph.nodes.find((node) => {
    const config = (node.config ?? {}) as Record<string, unknown>;
    return (
      node.type === "turn" &&
      clean(config.sourceKind).toLowerCase() === "handoff" &&
      !clean(config.internalParentNodeId) &&
      clean(config.handoffRoleId) === roleId &&
      (!clean(config.roleMode) || clean(config.roleMode) === "primary")
    );
  })?.id;
}

function isStrictRoleGraph(graph: GraphData, roleIds: StudioRoleId[]): roleIds is [StudioRoleId] {
  if (roleIds.length !== 1) {
    return false;
  }
  const roleNodeId = resolveRoleTemplateNodeId(graph, roleIds[0]);
  if (!roleNodeId) {
    return false;
  }
  return graph.nodes.every((node) => {
    if (node.id === roleNodeId) {
      return true;
    }
    const config = (node.config ?? {}) as Record<string, unknown>;
    return clean(config.internalParentNodeId) === roleNodeId;
  });
}

function resolveFamilyKey(params: {
  graph: GraphData;
  graphShapeHash: string;
  workflowPresetKind?: PresetKind;
  presetHint?: PresetKind;
}): {
  family: AdaptiveFamilyKey;
  primaryRoleIds: StudioRoleId[];
  templateRoleNodeId?: string;
} {
  const primaryRoleIds = extractPrimaryRoleIds(params.graph);
  const presetKind = params.workflowPresetKind ?? params.presetHint;
  if (presetKind) {
    return {
      family: `preset:${presetKind}`,
      primaryRoleIds,
    };
  }
  if (isStrictRoleGraph(params.graph, primaryRoleIds)) {
    return {
      family: `role:${primaryRoleIds[0]}`,
      primaryRoleIds,
      templateRoleNodeId: resolveRoleTemplateNodeId(params.graph, primaryRoleIds[0]),
    };
  }
  return {
    family: `custom:${params.graphShapeHash}`,
    primaryRoleIds,
  };
}

function summarizeGraph(graph: GraphData, primaryRoleIds: StudioRoleId[]): string {
  const turnCount = graph.nodes.filter((node) => node.type === "turn").length;
  const roles = primaryRoleIds.length > 0 ? primaryRoleIds.join(", ") : "none";
  return `nodes ${graph.nodes.length} / edges ${graph.edges.length} / turns ${turnCount} / roles ${roles}`;
}

function summarizePromptPack(promptHash: string, turnCount: number): string {
  return `turn prompts ${turnCount} / pack ${promptHash}`;
}

function summarizeTuning(turnNodes: ReturnType<typeof collectAdaptiveTurnNodes>, tuningHash: string): string {
  const tuned = turnNodes.filter((node) => node.type === "turn");
  if (tuned.length === 0) {
    return `bundle ${tuningHash}`;
  }
  const avgTemperature = tuned.reduce((sum, node) => sum + Number(node.temperature ?? 0), 0) / tuned.length;
  const maxInputChars = Math.max(...tuned.map((node) => Number(node.maxInputChars ?? 0)));
  return `avg temp ${avgTemperature.toFixed(2)} / max input ${Math.round(maxInputChars)} / bundle ${tuningHash}`;
}

function collectArtifactTypes(turnNodes: ReturnType<typeof collectAdaptiveTurnNodes>): ArtifactType[] {
  return [...new Set(turnNodes.map((node) => node.artifactType).filter(Boolean))] as ArtifactType[];
}

export function buildAdaptiveRecipeSnapshot(params: {
  cwd: string;
  graph: GraphData;
  workflowPresetKind?: PresetKind;
  presetHint?: PresetKind;
  createdAt?: string;
}): AdaptiveRecipeSnapshot {
  const workspace = normalizeAdaptiveWorkspaceKey(params.cwd);
  const turnNodes = collectAdaptiveTurnNodes(params.graph);
  const graphShapeHash = buildGraphShapeHash(params.graph);
  const promptPackHash = buildPromptPackHash(turnNodes);
  const tuningBundleHash = buildTuningBundleHash(turnNodes);
  const familyMeta = resolveFamilyKey({
    graph: params.graph,
    graphShapeHash,
    workflowPresetKind: params.workflowPresetKind,
    presetHint: params.presetHint,
  });
  const createdAt = params.createdAt ?? new Date().toISOString();
  const id = hashAdaptiveText(
    `${familyMeta.family}|${graphShapeHash}|${promptPackHash}|${tuningBundleHash}`,
  );
  return {
    id,
    workspace,
    family: familyMeta.family,
    familyBucket: resolveAdaptiveFamilyBucket(familyMeta.family),
    graphShapeHash,
    promptPackHash,
    tuningBundleHash,
    presetKind: params.workflowPresetKind ?? params.presetHint,
    primaryRoleIds: familyMeta.primaryRoleIds,
    artifactTypes: collectArtifactTypes(turnNodes),
    graphSummary: summarizeGraph(params.graph, familyMeta.primaryRoleIds),
    promptSummary: summarizePromptPack(promptPackHash, turnNodes.filter((node) => node.type === "turn").length),
    tuningSummary: summarizeTuning(turnNodes, tuningBundleHash),
    candidateKind: "current",
    createdAt,
    turnNodes,
    graphTemplate:
      familyMeta.family.startsWith("preset:") || familyMeta.family.startsWith("role:")
        ? cloneGraph(params.graph)
        : undefined,
    templateRoleNodeId: familyMeta.templateRoleNodeId,
  };
}
