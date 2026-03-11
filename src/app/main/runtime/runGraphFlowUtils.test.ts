import { describe, expect, it } from "vitest";
import type { GraphData } from "../../../features/workflow/types";
import { findDirectInputNodeIds } from "./runGraphFlowUtils";

describe("findDirectInputNodeIds", () => {
  it("ignores internal role research nodes when resolving question-direct roots", () => {
    const graph: GraphData = {
      version: 1,
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
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };

    expect(findDirectInputNodeIds(graph)).toEqual(["role"]);
  });
});
