import { describe, expect, it } from "vitest";
import type { GraphData, GraphNode } from "../types";
import { arrangeExpandedRoleInternalNodes, arrangeGraphAfterEdgeConnect } from "./localLayout";

function createGraph(nodes: GraphNode[], edges: GraphData["edges"] = []): GraphData {
  return {
    version: 1,
    nodes,
    edges,
    knowledge: { files: [], topK: 0, maxChars: 0 },
  };
}

describe("localLayout", () => {
  it("places the target node below the source when connected from bottom to top", () => {
    const graph = createGraph(
      [
        { id: "a", type: "turn", position: { x: 120, y: 80 }, config: {} },
        { id: "b", type: "turn", position: { x: 760, y: 140 }, config: {} },
      ],
      [
        {
          from: { nodeId: "a", port: "out", side: "bottom" },
          to: { nodeId: "b", port: "in", side: "top" },
        },
      ],
    );

    const next = arrangeGraphAfterEdgeConnect(graph, {
      fromNodeId: "a",
      toNodeId: "b",
      fromSide: "bottom",
      toSide: "top",
    });

    const source = next.nodes.find((node) => node.id === "a");
    const target = next.nodes.find((node) => node.id === "b");
    expect(source).not.toBeUndefined();
    expect(target).not.toBeUndefined();
    expect((target?.position.y ?? 0) > (source?.position.y ?? 0)).toBe(true);
    expect(target?.position.x).toBe(source?.position.x);
  });

  it("repositions internal role nodes around the expanded parent without overlap", () => {
    const parent: GraphNode = {
      id: "role",
      type: "turn",
      position: { x: 920, y: 420 },
      config: { sourceKind: "handoff" },
    };
    const graph = createGraph([
      parent,
      {
        id: "research-1",
        type: "turn",
        position: { x: 0, y: 0 },
        config: { internalParentNodeId: "role", internalNodeKind: "research" },
      },
      {
        id: "research-2",
        type: "turn",
        position: { x: 0, y: 0 },
        config: { internalParentNodeId: "role", internalNodeKind: "research" },
      },
      {
        id: "synthesis",
        type: "turn",
        position: { x: 0, y: 0 },
        config: { internalParentNodeId: "role", internalNodeKind: "synthesis" },
      },
      {
        id: "verification",
        type: "turn",
        position: { x: 0, y: 0 },
        config: { internalParentNodeId: "role", internalNodeKind: "verification" },
      },
    ]);

    const next = arrangeExpandedRoleInternalNodes(graph, "role", new Set(["role"]));
    const researchOne = next.nodes.find((node) => node.id === "research-1");
    const researchTwo = next.nodes.find((node) => node.id === "research-2");
    const synthesis = next.nodes.find((node) => node.id === "synthesis");
    const verification = next.nodes.find((node) => node.id === "verification");

    expect(researchOne?.position.x).toBeLessThan(parent.position.x);
    expect(researchTwo?.position.x).toBeLessThan(parent.position.x);
    expect(researchOne?.position.y).not.toBe(researchTwo?.position.y);
    expect(synthesis?.position.y).toBeLessThan(verification?.position.y ?? 0);
  });
});
