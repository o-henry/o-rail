import { describe, expect, it, vi } from "vitest";
import { createRunGraphProcessNode } from "./runGraphProcessNode";

describe("createRunGraphProcessNode", () => {
  it("fails the node instead of leaving it queued when input building throws", async () => {
    const node = {
      id: "synthesis",
      type: "turn",
      position: { x: 0, y: 0 },
      config: { role: "기획(PM) 조사 종합" },
    };
    const setNodeStatus = vi.fn();
    const setNodeRuntimeFields = vi.fn();
    const appendRunTransition = vi.fn();
    const addNodeLog = vi.fn();
    const scheduleChildren = vi.fn();
    const terminalStateByNodeId: Record<string, string> = {};

    const processNode = createRunGraphProcessNode({
      nodeMap: new Map([[node.id, node]]),
      graph: { edges: [] },
      workflowQuestion: "창의적인 게임 아이디어가 필요합니다.",
      latestFeedSourceByNodeId: new Map(),
      turnRoleLabel: vi.fn(() => "기획(PM)"),
      nodeTypeLabel: vi.fn(() => "turn"),
      nodeSelectionLabel: vi.fn(() => "기획(PM)"),
      resolveFeedInputSourcesForNode: vi.fn(() => []),
      buildNodeInputForNode: vi.fn(() => {
        throw new Error("structured packet failed");
      }),
      outputs: {},
      normalizedEvidenceByNodeId: {},
      getRunMemoryByNodeId: vi.fn(() => ({})),
      runRecord: { transitions: [] },
      setNodeStatus,
      setNodeRuntimeFields,
      appendRunTransition,
      terminalStateByNodeId,
      scheduleChildren,
      addNodeLog,
    });

    await processNode("synthesis");

    expect(setNodeStatus).toHaveBeenCalledWith(
      "synthesis",
      "failed",
      expect.stringContaining("노드 입력 구성 실패"),
    );
    expect(setNodeRuntimeFields).toHaveBeenCalledWith(
      "synthesis",
      expect.objectContaining({
        status: "failed",
      }),
    );
    expect(addNodeLog).toHaveBeenCalledWith(
      "synthesis",
      expect.stringContaining("structured packet failed"),
    );
    expect(appendRunTransition).toHaveBeenCalledWith(
      expect.any(Object),
      "synthesis",
      "failed",
      expect.stringContaining("structured packet failed"),
    );
    expect(scheduleChildren).toHaveBeenCalledWith("synthesis");
    expect(terminalStateByNodeId.synthesis).toBe("failed");
  });
});
