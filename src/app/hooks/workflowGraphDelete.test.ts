import { describe, expect, it } from "vitest";
import type { GraphData } from "../../features/workflow/types";
import { removeGraphNodesPreservingLayout } from "./workflowGraphDelete";

describe("removeGraphNodesPreservingLayout", () => {
  it("removes only target nodes and connected edges without moving surviving nodes", () => {
    const graph: GraphData = {
      version: 1,
      nodes: [
        { id: "a", type: "turn", position: { x: 40, y: 40 }, config: {} },
        { id: "b", type: "turn", position: { x: 320, y: 40 }, config: {} },
        { id: "c", type: "turn", position: { x: 600, y: 220 }, config: {} },
      ],
      edges: [
        { from: { nodeId: "a", port: "out" }, to: { nodeId: "b", port: "in" } },
        { from: { nodeId: "b", port: "out" }, to: { nodeId: "c", port: "in" } },
      ],
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };

    const next = removeGraphNodesPreservingLayout(graph, ["b"]);

    expect(next.nodes.map((node) => node.id)).toEqual(["a", "c"]);
    expect(next.edges).toEqual([]);
    expect(next.nodes.find((node) => node.id === "a")?.position).toEqual({ x: 40, y: 40 });
    expect(next.nodes.find((node) => node.id === "c")?.position).toEqual({ x: 600, y: 220 });
  });
});
