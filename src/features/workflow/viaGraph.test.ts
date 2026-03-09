import { describe, expect, it } from "vitest";
import type { GraphData, GraphNode } from "./types";
import { buildGraphForViewMode, isViaFlowTurnNode, isVisibleRagWorkspaceNode } from "./viaGraph";

const baseGraph: GraphData = {
  version: 1,
  knowledge: {
    files: [],
    maxChars: 1200,
    topK: 4,
  },
  nodes: [
    { id: "turn-codex", type: "turn", position: { x: 10, y: 10 }, config: { executor: "codex" } },
    { id: "turn-via-1", type: "turn", position: { x: 20, y: 20 }, config: { executor: "via_flow", viaFlowId: "1" } },
    { id: "transform-1", type: "transform", position: { x: 30, y: 30 }, config: {} },
    { id: "turn-via-2", type: "turn", position: { x: 40, y: 40 }, config: { executor: "via_flow", viaFlowId: "2" } },
  ],
  edges: [
    { from: { nodeId: "turn-via-1", port: "out" }, to: { nodeId: "turn-via-2", port: "in" } },
    { from: { nodeId: "turn-codex", port: "out" }, to: { nodeId: "turn-via-1", port: "in" } },
    { from: { nodeId: "turn-via-2", port: "out" }, to: { nodeId: "transform-1", port: "in" } },
  ],
};

describe("viaGraph helpers", () => {
  it("detects via_flow turn nodes", () => {
    expect(isViaFlowTurnNode(baseGraph.nodes[1])).toBe(true);
    expect(isViaFlowTurnNode(baseGraph.nodes[0])).toBe(false);
    expect(isViaFlowTurnNode(baseGraph.nodes[2])).toBe(false);
  });

  it("keeps original graph in graph mode", () => {
    const next = buildGraphForViewMode(baseGraph, "graph");
    expect(next).toBe(baseGraph);
  });

  it("filters graph to via_flow turn nodes in rag mode", () => {
    const next = buildGraphForViewMode(baseGraph, "rag");
    expect(next.nodes.map((node) => node.id)).toEqual(["turn-via-1", "turn-via-2"]);
    expect(next.edges).toEqual([
      { from: { nodeId: "turn-via-1", port: "out" }, to: { nodeId: "turn-via-2", port: "in" } },
    ]);
    expect(next.knowledge).toBe(baseGraph.knowledge);
  });

  it("hides internal role research via nodes from rag mode", () => {
    const visibleViaNode: GraphNode = {
      id: "turn-via-visible",
      type: "turn",
      position: { x: 20, y: 20 },
      config: { executor: "via_flow", viaFlowId: "1", viaNodeType: "source.news" },
    };
    const internalViaNode: GraphNode = {
      id: "turn-via-internal",
      type: "turn",
      position: { x: 40, y: 40 },
      config: {
        executor: "via_flow",
        viaFlowId: "1",
        viaNodeType: "source.community",
        internalParentNodeId: "role-node-1",
        internalNodeKind: "research",
      },
    };

    expect(isVisibleRagWorkspaceNode(visibleViaNode)).toBe(true);
    expect(isVisibleRagWorkspaceNode(internalViaNode)).toBe(false);

    const graph = buildGraphForViewMode(
      {
        version: 1,
        knowledge: baseGraph.knowledge,
        nodes: [visibleViaNode, internalViaNode],
        edges: [
          { from: { nodeId: visibleViaNode.id, port: "out" }, to: { nodeId: internalViaNode.id, port: "in" } },
        ],
      },
      "rag",
    );

    expect(graph.nodes.map((node) => node.id)).toEqual([visibleViaNode.id]);
    expect(graph.edges).toHaveLength(0);
  });
});
