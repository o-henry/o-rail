import { describe, expect, it } from "vitest";
import type { GraphData } from "../../features/workflow/types";
import {
  collectWorkflowRoleQueuedRequests,
  removeWorkflowRoleQueuedRequest,
  resolveWorkflowRoleRequestTargetNodeIds,
} from "./workflowRoleRequestTargets";

describe("resolveWorkflowRoleRequestTargetNodeIds", () => {
  it("targets the selected role node when a matching node is selected", () => {
    const graph: GraphData = {
      version: 1,
      nodes: [
        {
          id: "pm-primary",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner", roleMode: "primary" },
        },
        {
          id: "pm-perspective",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner", roleMode: "perspective", internalParentNodeId: "pm-primary" },
        },
      ],
      edges: [],
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };

    const targetIds = resolveWorkflowRoleRequestTargetNodeIds({
      graph,
      roleId: "pm_planner",
      selectedNodeId: "pm-perspective",
    });

    expect(targetIds).toEqual(["pm-perspective"]);
  });

  it("targets only top-level primary nodes when no node is selected", () => {
    const graph: GraphData = {
      version: 1,
      nodes: [
        {
          id: "pm-primary",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner", roleMode: "primary" },
        },
        {
          id: "pm-perspective",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "pm_planner", roleMode: "perspective", internalParentNodeId: "pm-primary" },
        },
        {
          id: "client",
          type: "turn",
          position: { x: 0, y: 0 },
          config: { sourceKind: "handoff", handoffRoleId: "client_programmer", roleMode: "primary" },
        },
      ],
      edges: [],
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };

    const targetIds = resolveWorkflowRoleRequestTargetNodeIds({
      graph,
      roleId: "pm_planner",
    });

    expect(targetIds).toEqual(["pm-primary"]);
  });

  it("collects and deduplicates queued requests for target nodes", () => {
    const queued = collectWorkflowRoleQueuedRequests({
      targetNodeIds: ["pm-primary", "pm-secondary"],
      pendingNodeRequests: {
        "pm-primary": ["첫 요청", "공통 요청"],
        "pm-secondary": ["공통 요청", "둘째 요청"],
      },
    });

    expect(queued).toEqual(["첫 요청", "공통 요청", "둘째 요청"]);
  });

  it("removes the selected queued request from all target nodes only", () => {
    const next = removeWorkflowRoleQueuedRequest({
      targetNodeIds: ["pm-primary", "pm-secondary"],
      pendingNodeRequests: {
        "pm-primary": ["첫 요청", "공통 요청"],
        "pm-secondary": ["공통 요청", "둘째 요청"],
        client: ["공통 요청", "클라이언트 요청"],
      },
      text: "공통 요청",
    });

    expect(next).toEqual({
      "pm-primary": ["첫 요청"],
      "pm-secondary": ["둘째 요청"],
      client: ["공통 요청", "클라이언트 요청"],
    });
  });
});
