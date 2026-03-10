import { describe, expect, it } from "vitest";
import type { GraphData } from "../../../features/workflow/types";
import { resolveQuestionDirectInputNodeIds } from "./useCanvasGraphDerivedState";

describe("resolveQuestionDirectInputNodeIds", () => {
  it("keeps a role node as direct-input when only internal research nodes point to it", () => {
    const graph: GraphData = {
      nodes: [
        {
          id: "role",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner" },
        },
        {
          id: "research",
          type: "turn",
          position: { x: 0, y: 0 },
          config: {
            sourceKind: "data_research",
            internalParentNodeId: "role",
            internalNodeKind: "research",
          },
        },
        {
          id: "verification",
          type: "turn",
          position: { x: 0, y: 0 },
          config: {
            sourceKind: "data_pipeline",
            internalParentNodeId: "role",
            internalNodeKind: "verification",
          },
        },
      ],
      edges: [
        {
          from: { nodeId: "research", port: "out" },
          to: { nodeId: "verification", port: "in" },
        },
        {
          from: { nodeId: "verification", port: "out" },
          to: { nodeId: "role", port: "in" },
        },
      ],
      version: 1,
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };

    const directInputNodeIds = resolveQuestionDirectInputNodeIds(graph);

    expect(directInputNodeIds.has("role")).toBe(true);
  });

  it("removes direct-input when an external node feeds the role node", () => {
    const graph: GraphData = {
      nodes: [
        {
          id: "source",
          type: "turn",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "role",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner" },
        },
      ],
      edges: [
        {
          from: { nodeId: "source", port: "out" },
          to: { nodeId: "role", port: "in" },
        },
      ],
      version: 1,
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };

    const directInputNodeIds = resolveQuestionDirectInputNodeIds(graph);

    expect(directInputNodeIds.has("role")).toBe(false);
  });
});
