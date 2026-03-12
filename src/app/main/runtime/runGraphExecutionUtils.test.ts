import { describe, expect, it, vi } from "vitest";
import type { GraphNode } from "../../../features/workflow/types";
import { buildFinalTurnInputPacket, buildNodeInputForNode, cancelGraphRun } from "./runGraphExecutionUtils";

describe("cancelGraphRun", () => {
  it("interrupts every active codex thread when multiple turn nodes run in parallel", async () => {
    const invokeFn = vi.fn(async () => ({})) as any;

    await cancelGraphRun({
      isGraphRunning: true,
      setIsGraphPaused: vi.fn(),
      setStatus: vi.fn(),
      pendingWebLogin: false,
      resolvePendingWebLogin: vi.fn(),
      activeWebNodeByProvider: {},
      invokeFn,
      addNodeLog: vi.fn(),
      clearWebBridgeStageWarnTimer: vi.fn(),
      activeWebPromptByProvider: {},
      setError: vi.fn(),
      pendingWebTurn: null,
      suspendedWebTurn: null,
      clearQueuedWebTurnRequests: vi.fn(),
      resolvePendingWebTurn: vi.fn(),
      pauseErrorToken: "__pause__",
      activeTurnThreadByNodeId: {
        "root-a": "thread-a",
        "root-b": "thread-b",
      },
    });

    expect(invokeFn).toHaveBeenCalledTimes(2);
    expect(invokeFn).toHaveBeenNthCalledWith(1, "turn_interrupt", { threadId: "thread-a" });
    expect(invokeFn).toHaveBeenNthCalledWith(2, "turn_interrupt", { threadId: "thread-b" });
  });
});

describe("buildNodeInputForNode", () => {
  const reviewNode: GraphNode = {
    id: "review",
    type: "turn",
    position: { x: 0, y: 0 },
    config: {
      role: "REVIEW AGENT",
      qualityProfile: "synthesis_final",
    },
  };
  const leftNode: GraphNode = {
    id: "left",
    type: "turn",
    position: { x: 0, y: 0 },
    config: {
      role: "CLIENT AGENT",
      artifactType: "TaskPlanArtifact",
    },
  };
  const rightNode: GraphNode = {
    id: "right",
    type: "turn",
    position: { x: 0, y: 0 },
    config: {
      role: "SYSTEM AGENT",
    },
  };

  it("builds a structured packet for multi-parent turn nodes", () => {
    const input = buildNodeInputForNode({
      node: reviewNode,
      nodeMap: new Map([
        [reviewNode.id, reviewNode],
        [leftNode.id, leftNode],
        [rightNode.id, rightNode],
      ]),
      edges: [
        { from: { nodeId: "left", port: "out" }, to: { nodeId: "review", port: "in" } },
        { from: { nodeId: "right", port: "out" }, to: { nodeId: "review", port: "in" } },
      ],
      nodeId: "review",
      outputs: {
        left: "손맛이 강한 1인 개발형 아이디어",
        right: "구현 범위와 리스크 검토",
      },
      rootInput: "창의적인 게임 아이디어가 필요하다",
      normalizedEvidenceByNodeId: {},
      runMemory: {},
    });

    expect(input).toMatchObject({
      packetType: "structured_node_input",
      stage: "multi_parent_review",
      question: "창의적인 게임 아이디어가 필요하다",
    });
    expect((input as { parentOutputs: Array<{ nodeId: string }> }).parentOutputs).toHaveLength(2);
  });

  it("builds a final structured packet with run memory for final synthesis nodes", () => {
    const input = buildFinalTurnInputPacket({
      edges: [
        { from: { nodeId: "left", port: "out" }, to: { nodeId: "review", port: "in" } },
      ],
      nodeId: "review",
      currentInput: "fallback",
      outputs: {
        left: "핵심 후보 1개",
      },
      rootInput: "창의적인 게임 아이디어가 필요하다",
      normalizedEvidenceByNodeId: {},
      runMemory: {
        left: {
          nodeId: "left",
          roleLabel: "CLIENT AGENT",
          responsibility: "client",
          decisionSummary: "첫 훅이 강하다",
          openIssues: [],
          nextRequests: [],
          updatedAt: new Date().toISOString(),
        },
      },
      nodeMap: new Map([
        [reviewNode.id, reviewNode],
        [leftNode.id, leftNode],
      ]),
    });

    expect(input).toMatchObject({
      packetType: "structured_node_input",
      stage: "final_synthesis",
    });
    expect((input as { runMemory: unknown[] }).runMemory).toHaveLength(1);
  });
});
