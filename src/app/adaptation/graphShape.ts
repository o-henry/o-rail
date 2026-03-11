import type { GraphData } from "../../features/workflow/types";
import type { AdaptiveRecipeTurnNode } from "./types";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function hashAdaptiveText(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function buildNodeSignature(node: GraphData["nodes"][number]): string {
  const config = (node.config ?? {}) as Record<string, unknown>;
  return [
    node.type,
    clean(config.role),
    clean(config.sourceKind),
    clean(config.handoffRoleId),
    clean(config.roleMode),
    clean(config.internalNodeKind),
    clean(config.pmPlanningMode),
  ].join("|");
}

function buildCanonicalNodeMap(graph: GraphData): Map<string, string> {
  const sorted = [...graph.nodes]
    .map((node) => ({ id: node.id, signature: buildNodeSignature(node) }))
    .sort((left, right) => left.signature.localeCompare(right.signature) || left.id.localeCompare(right.id));
  const counts = new Map<string, number>();
  const map = new Map<string, string>();
  for (const row of sorted) {
    const next = (counts.get(row.signature) ?? 0) + 1;
    counts.set(row.signature, next);
    map.set(row.id, `${row.signature}#${next}`);
  }
  return map;
}

export function buildGraphShapeHash(graph: GraphData): string {
  const nodeMap = buildCanonicalNodeMap(graph);
  const nodeRows = [...graph.nodes]
    .map((node) => nodeMap.get(node.id) ?? buildNodeSignature(node))
    .sort();
  const edgeRows = [...graph.edges]
    .map((edge) =>
      [
        nodeMap.get(edge.from.nodeId) ?? edge.from.nodeId,
        edge.from.port,
        clean(edge.from.side),
        nodeMap.get(edge.to.nodeId) ?? edge.to.nodeId,
        edge.to.port,
        clean(edge.to.side),
      ].join("->"),
    )
    .sort();
  return hashAdaptiveText(JSON.stringify({ nodes: nodeRows, edges: edgeRows }));
}

export function collectAdaptiveTurnNodes(graph: GraphData): AdaptiveRecipeTurnNode[] {
  return graph.nodes
    .map((node) => {
      const config = (node.config ?? {}) as Record<string, unknown>;
      return {
        id: node.id,
        type: node.type,
        role: clean(config.role) || undefined,
        handoffRoleId: clean(config.handoffRoleId) as AdaptiveRecipeTurnNode["handoffRoleId"],
        roleMode: clean(config.roleMode) || undefined,
        sourceKind: clean(config.sourceKind) || undefined,
        internalNodeKind: clean(config.internalNodeKind) || undefined,
        artifactType: clean(config.artifactType) as AdaptiveRecipeTurnNode["artifactType"],
        promptTemplate: clean(config.promptTemplate) || undefined,
        temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : undefined,
        contextBudget: clean(config.contextBudget) as AdaptiveRecipeTurnNode["contextBudget"],
        maxInputChars: Number.isFinite(Number(config.maxInputChars)) ? Number(config.maxInputChars) : undefined,
        executor: clean(config.executor) as AdaptiveRecipeTurnNode["executor"],
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildPromptPackHash(turnNodes: AdaptiveRecipeTurnNode[]): string {
  const rows = turnNodes
    .filter((node) => node.type === "turn")
    .map((node) => ({
      id: node.id,
      promptTemplate: node.promptTemplate ?? "",
      role: node.role ?? "",
      sourceKind: node.sourceKind ?? "",
      handoffRoleId: node.handoffRoleId ?? "",
      internalNodeKind: node.internalNodeKind ?? "",
    }));
  return hashAdaptiveText(JSON.stringify(rows));
}

export function buildTuningBundleHash(turnNodes: AdaptiveRecipeTurnNode[]): string {
  const rows = turnNodes
    .filter((node) => node.type === "turn")
    .map((node) => ({
      id: node.id,
      executor: node.executor ?? "",
      temperature: node.temperature ?? null,
      contextBudget: node.contextBudget ?? null,
      maxInputChars: node.maxInputChars ?? null,
      artifactType: node.artifactType ?? "",
    }));
  return hashAdaptiveText(JSON.stringify(rows));
}
