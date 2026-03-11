import { describe, expect, it } from "vitest";
import { resolveQuestionDirectInputNodeIds } from "../../../features/workflow/graph-utils";
import type { GraphData } from "../../../features/workflow/types";

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

    expect(directInputNodeIds).toContain("role");
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

    expect(directInputNodeIds).not.toContain("role");
  });

  it("does not mark internal synthesis or verification nodes as direct-input", () => {
    const graph: GraphData = {
      nodes: [
        {
          id: "role",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner" },
        },
        {
          id: "synthesis",
          type: "turn",
          position: { x: 0, y: 0 },
          config: {
            sourceKind: "data_pipeline",
            internalParentNodeId: "role",
            internalNodeKind: "synthesis",
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
          from: { nodeId: "synthesis", port: "out" },
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

    expect(directInputNodeIds).toContain("role");
    expect(directInputNodeIds).not.toContain("synthesis");
    expect(directInputNodeIds).not.toContain("verification");
  });
});
