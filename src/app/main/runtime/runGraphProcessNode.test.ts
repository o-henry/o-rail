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

  it("hard-fails turn nodes when the model returns an empty artifact payload", async () => {
    const node = {
      id: "pm-agent",
      type: "turn",
      position: { x: 0, y: 0 },
      config: { role: "기획(PM) AGENT", artifactType: "DesignArtifact" },
    };
    const setNodeStatus = vi.fn();
    const setNodeRuntimeFields = vi.fn();
    const appendRunTransition = vi.fn();
    const addNodeLog = vi.fn();
    const scheduleChildren = vi.fn();
    const terminalStateByNodeId: Record<string, string> = {};
    const outputs: Record<string, unknown> = {};
    const runRecord = { runId: "run-1", transitions: [], providerTrace: [], feedPosts: [], threadTurnMap: {} };

    const processNode = createRunGraphProcessNode({
      nodeMap: new Map([[node.id, node]]),
      graph: { edges: [{ from: { nodeId: "pm-agent", port: "out" }, to: { nodeId: "next", port: "in" } }] },
      adjacency: new Map([[node.id, ["next"]]]),
      incoming: new Map([[node.id, []]]),
      workflowQuestion: "창의적인 게임 아이디어가 필요합니다.",
      latestFeedSourceByNodeId: new Map(),
      turnRoleLabel: vi.fn(() => "기획(PM)"),
      nodeTypeLabel: vi.fn(() => "turn"),
      nodeSelectionLabel: vi.fn(() => "기획(PM)"),
      resolveFeedInputSourcesForNode: vi.fn(() => []),
      buildNodeInputForNode: vi.fn(() => "입력"),
      outputs,
      normalizedEvidenceByNodeId: {},
      getRunMemoryByNodeId: vi.fn(() => ({})),
      runRecord,
      setNodeStatus,
      setNodeRuntimeFields,
      appendRunTransition,
      terminalStateByNodeId,
      scheduleChildren,
      addNodeLog,
      pauseRequestedRef: { current: false },
      cancelRequestedRef: { current: false },
      queue: [],
      skipSet: new Set(),
      appendNodeEvidence: vi.fn(() => ({
        verificationStatus: "unverified",
        confidenceBand: "low",
        dataIssues: [],
      })),
      buildFeedPost: vi.fn(({ status, summary, output, error }: any) => ({
        post: { id: `feed-${status}`, status, summary, output, error },
        rawAttachments: { markdown: "", json: "" },
      })),
      rememberFeedSource: vi.fn(),
      feedRawAttachmentRef: { current: {} },
      feedAttachmentRawKey: (id: string, kind: string) => `${id}:${kind}`,
      runLogCollectorRef: { current: {} },
      executeTurnNodeWithOutputSchemaRetry: vi.fn(async () => ({
        result: {
          ok: true,
          output: {
            artifact: {
              payload: {
                text: "",
              },
            },
            text: "",
          },
          executor: "codex",
          provider: "codex",
          usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
          threadId: "thread-1",
          turnId: "turn-1",
        },
        artifactWarnings: [],
        normalizedOutput: {
          artifact: {
            payload: {
              text: "",
            },
          },
          text: "",
        },
      })),
      executeTurnNode: vi.fn(),
      validateSimpleSchema: vi.fn(() => []),
      turnOutputSchemaEnabled: true,
      turnOutputSchemaMaxRetry: 0,
      isPauseSignalError: vi.fn(() => false),
      buildQualityReport: vi.fn(),
      cwd: "/tmp/project",
      setLastDoneNodeId: vi.fn(),
      t: (key: string) => key,
      storeGraphRoleKnowledge: vi.fn(),
    });

    await processNode("pm-agent");

    expect(setNodeStatus).toHaveBeenCalledWith(
      "pm-agent",
      "failed",
      "빈 산출이 감지되어 실행을 중단했습니다. 이 결과는 다음 노드로 전달하지 않습니다.",
    );
    expect(outputs).toEqual({});
    expect(appendRunTransition).toHaveBeenCalledWith(
      runRecord,
      "pm-agent",
      "failed",
      "빈 산출이 감지되어 실행을 중단했습니다. 이 결과는 다음 노드로 전달하지 않습니다.",
    );
    expect(terminalStateByNodeId["pm-agent"]).toBe("failed");
    expect(scheduleChildren).toHaveBeenCalledWith("pm-agent");
  });
});
