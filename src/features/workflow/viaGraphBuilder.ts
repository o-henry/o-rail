import type { GraphEdge, GraphNode } from "./types";
import { isViaFlowTurnNode } from "./viaGraph";
import { isViaNodeType, type ViaNodeType } from "./viaCatalog";

const SOURCE_TYPES: ViaNodeType[] = [
  "source.news",
  "source.sns",
  "source.community",
  "source.dev",
  "source.market",
  "source.x",
  "source.threads",
  "source.reddit",
  "source.hn",
];

export const VIA_NODE_BASE_POSITION_BY_TYPE: Record<ViaNodeType, { x: number; y: number }> = {
  "trigger.manual": { x: 80, y: 120 },
  "source.news": { x: 300, y: 20 },
  "source.sns": { x: 300, y: 110 },
  "source.community": { x: 300, y: 200 },
  "source.dev": { x: 300, y: 290 },
  "source.market": { x: 300, y: 380 },
  "source.x": { x: 300, y: 110 },
  "source.threads": { x: 300, y: 110 },
  "source.reddit": { x: 300, y: 200 },
  "source.hn": { x: 300, y: 290 },
  "transform.normalize": { x: 560, y: 210 },
  "transform.verify": { x: 770, y: 210 },
  "transform.rank": { x: 980, y: 210 },
  "agent.codex": { x: 1190, y: 210 },
  "export.rag": { x: 1410, y: 210 },
};

function collectViaNodeIdsByType(nodes: GraphNode[]): Map<ViaNodeType, string[]> {
  const viaNodeIdsByType = new Map<ViaNodeType, string[]>();
  nodes.forEach((node) => {
    if (!isViaFlowTurnNode(node)) {
      return;
    }
    const rawType = String((node.config as Record<string, unknown>).viaNodeType ?? "").trim();
    if (!isViaNodeType(rawType)) {
      return;
    }
    const list = viaNodeIdsByType.get(rawType) ?? [];
    list.push(node.id);
    viaNodeIdsByType.set(rawType, list);
  });
  return viaNodeIdsByType;
}

function firstNodeId(viaNodeIdsByType: Map<ViaNodeType, string[]>, type: ViaNodeType): string {
  return viaNodeIdsByType.get(type)?.[0] ?? "";
}

function hasEdge(edges: GraphEdge[], fromNodeId: string, toNodeId: string): boolean {
  return edges.some((edge) => edge.from.nodeId === fromNodeId && edge.to.nodeId === toNodeId);
}

function addEdge(edges: GraphEdge[], fromNodeId: string, toNodeId: string): void {
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId || hasEdge(edges, fromNodeId, toNodeId)) {
    return;
  }
  edges.push({
    from: { nodeId: fromNodeId, port: "out" },
    to: { nodeId: toNodeId, port: "in" },
  });
}

export function countViaNodesByType(nodes: GraphNode[], viaNodeType: ViaNodeType): number {
  return nodes.filter((node) => {
    if (!isViaFlowTurnNode(node)) {
      return false;
    }
    const currentType = String((node.config as Record<string, unknown>).viaNodeType ?? "").trim();
    return currentType === viaNodeType;
  }).length;
}

export function connectViaDefaultEdges(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  insertedNodeId: string;
  insertedNodeType: ViaNodeType;
}): GraphEdge[] {
  const { nodes, edges, insertedNodeId, insertedNodeType } = params;
  const nextEdges: GraphEdge[] = [...edges];
  const viaNodeIdsByType = collectViaNodeIdsByType(nodes);

  const manualId = firstNodeId(viaNodeIdsByType, "trigger.manual");
  const normalizeId = firstNodeId(viaNodeIdsByType, "transform.normalize");
  const verifyId = firstNodeId(viaNodeIdsByType, "transform.verify");
  const rankId = firstNodeId(viaNodeIdsByType, "transform.rank");
  const codexId = firstNodeId(viaNodeIdsByType, "agent.codex");
  const exportId = firstNodeId(viaNodeIdsByType, "export.rag");

  if (insertedNodeType === "trigger.manual") {
    SOURCE_TYPES.forEach((type) => addEdge(nextEdges, insertedNodeId, firstNodeId(viaNodeIdsByType, type)));
  }

  if (SOURCE_TYPES.includes(insertedNodeType)) {
    addEdge(nextEdges, manualId, insertedNodeId);
    addEdge(nextEdges, insertedNodeId, normalizeId);
  }

  if (insertedNodeType === "transform.normalize") {
    SOURCE_TYPES.forEach((type) => addEdge(nextEdges, firstNodeId(viaNodeIdsByType, type), insertedNodeId));
    addEdge(nextEdges, insertedNodeId, verifyId);
  }

  if (insertedNodeType === "transform.verify") {
    addEdge(nextEdges, normalizeId, insertedNodeId);
    addEdge(nextEdges, insertedNodeId, rankId);
  }

  if (insertedNodeType === "transform.rank") {
    addEdge(nextEdges, verifyId, insertedNodeId);
    addEdge(nextEdges, insertedNodeId, codexId);
  }

  if (insertedNodeType === "agent.codex") {
    addEdge(nextEdges, rankId, insertedNodeId);
    addEdge(nextEdges, insertedNodeId, exportId);
  }

  if (insertedNodeType === "export.rag") {
    addEdge(nextEdges, codexId, insertedNodeId);
  }

  return nextEdges;
}
