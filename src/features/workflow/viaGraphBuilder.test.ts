import { describe, expect, it } from "vitest";
import type { GraphNode } from "./types";
import { connectViaDefaultEdges, countViaNodesByType, VIA_NODE_BASE_POSITION_BY_TYPE } from "./viaGraphBuilder";
import type { ViaNodeType } from "./viaCatalog";

function makeViaNode(id: string, viaNodeType: ViaNodeType): GraphNode {
  return {
    id,
    type: "turn",
    position: { x: 0, y: 0 },
    config: {
      executor: "via_flow",
      viaNodeType,
    },
  };
}

describe("viaGraphBuilder", () => {
  it("counts via nodes by type only for via_flow turns", () => {
    const nodes: GraphNode[] = [
      makeViaNode("n1", "source.news"),
      makeViaNode("n2", "source.news"),
      makeViaNode("n3", "source.sns"),
      {
        id: "n4",
        type: "turn",
        position: { x: 0, y: 0 },
        config: { executor: "codex", viaNodeType: "source.news" },
      },
    ];

    expect(countViaNodesByType(nodes, "source.news")).toBe(2);
    expect(countViaNodesByType(nodes, "source.sns")).toBe(1);
  });

  it("connects trigger -> source -> normalize when source is inserted", () => {
    const nodes: GraphNode[] = [
      makeViaNode("manual", "trigger.manual"),
      makeViaNode("normalize", "transform.normalize"),
      makeViaNode("news", "source.news"),
    ];

    const nextEdges = connectViaDefaultEdges({
      nodes,
      edges: [],
      insertedNodeId: "news",
      insertedNodeType: "source.news",
    });

    expect(nextEdges).toEqual([
      { from: { nodeId: "manual", port: "out" }, to: { nodeId: "news", port: "in" } },
      { from: { nodeId: "news", port: "out" }, to: { nodeId: "normalize", port: "in" } },
    ]);
  });

  it("matches default base positions from VIA catalog", () => {
    expect(VIA_NODE_BASE_POSITION_BY_TYPE["trigger.manual"]).toEqual({ x: 80, y: 120 });
    expect(VIA_NODE_BASE_POSITION_BY_TYPE["source.news"]).toEqual({ x: 300, y: 20 });
    expect(VIA_NODE_BASE_POSITION_BY_TYPE["source.sns"]).toEqual({ x: 300, y: 110 });
    expect(VIA_NODE_BASE_POSITION_BY_TYPE["source.community"]).toEqual({ x: 300, y: 200 });
    expect(VIA_NODE_BASE_POSITION_BY_TYPE["source.market"]).toEqual({ x: 300, y: 380 });
    expect(VIA_NODE_BASE_POSITION_BY_TYPE["transform.normalize"]).toEqual({ x: 560, y: 210 });
    expect(VIA_NODE_BASE_POSITION_BY_TYPE["export.rag"]).toEqual({ x: 1410, y: 210 });
  });
});
