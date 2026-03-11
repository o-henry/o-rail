import { describe, expect, it } from "vitest";
import { buildAdaptiveRecipeSnapshot } from "./recipe";
import type { GraphData } from "../../features/workflow/types";

describe("buildAdaptiveRecipeSnapshot", () => {
  it("ignores node positions when hashing the graph shape", () => {
    const base: GraphData = {
      version: 3,
      nodes: [
        { id: "a", type: "turn", position: { x: 10, y: 20 }, config: { role: "A" } },
        { id: "b", type: "turn", position: { x: 30, y: 40 }, config: { role: "B" } },
      ],
      edges: [{ from: { nodeId: "a", port: "out" }, to: { nodeId: "b", port: "in" } }],
      knowledge: { files: [], topK: 0, maxChars: 2800 },
    };
    const moved: GraphData = {
      ...base,
      nodes: base.nodes.map((node) => ({
        ...node,
        position: { x: node.position.x + 500, y: node.position.y + 240 },
      })),
    };

    const left = buildAdaptiveRecipeSnapshot({ cwd: "/tmp/demo", graph: base });
    const right = buildAdaptiveRecipeSnapshot({ cwd: "/tmp/demo", graph: moved });

    expect(left.graphShapeHash).toBe(right.graphShapeHash);
  });

  it("classifies preset, role, and custom families correctly", () => {
    const presetGraph: GraphData = {
      version: 3,
      nodes: [{ id: "turn-a", type: "turn", position: { x: 0, y: 0 }, config: { role: "A" } }],
      edges: [],
      knowledge: { files: [], topK: 0, maxChars: 2800 },
    };
    const roleGraph: GraphData = {
      version: 3,
      nodes: [
        {
          id: "role",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner", roleMode: "primary" },
        },
        {
          id: "verification",
          type: "turn",
          position: { x: -200, y: 0 },
          config: { internalParentNodeId: "role", internalNodeKind: "verification" },
        },
      ],
      edges: [{ from: { nodeId: "verification", port: "out" }, to: { nodeId: "role", port: "in" } }],
      knowledge: { files: [], topK: 0, maxChars: 2800 },
    };
    const customGraph: GraphData = {
      version: 3,
      nodes: [
        { id: "turn-a", type: "turn", position: { x: 0, y: 0 }, config: { role: "A" } },
        { id: "turn-b", type: "turn", position: { x: 100, y: 0 }, config: { role: "B" } },
      ],
      edges: [{ from: { nodeId: "turn-a", port: "out" }, to: { nodeId: "turn-b", port: "in" } }],
      knowledge: { files: [], topK: 0, maxChars: 2800 },
    };

    expect(buildAdaptiveRecipeSnapshot({ cwd: "/tmp/demo", graph: presetGraph, workflowPresetKind: "creative" }).family).toBe("preset:creative");
    expect(buildAdaptiveRecipeSnapshot({ cwd: "/tmp/demo", graph: roleGraph }).family).toBe("role:pm_planner");
    expect(buildAdaptiveRecipeSnapshot({ cwd: "/tmp/demo", graph: customGraph }).family.startsWith("custom:")).toBe(true);
  });
});
