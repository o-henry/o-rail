import { describe, expect, it, vi } from "vitest";
import { createRunGraphControlHandlers } from "./runGraphControlHandlers";

function createParams() {
  return {
    cwd: "/tmp/project",
    hasTauriRuntime: true,
    loginCompleted: true,
    setError: vi.fn(),
    setStatus: vi.fn(),
    collectRequiredWebProviders: vi.fn(() => []),
    graph: { nodes: [], edges: [], knowledge: { files: [], topK: 0, maxChars: 0 } },
    refreshWebBridgeStatus: vi.fn(),
    webBridgeStatus: {},
    buildWebConnectPreflightReasons: vi.fn(() => []),
    webProviderLabel: vi.fn(),
    t: (key: string) => key,
    setPendingWebConnectCheck: vi.fn(),
    inferRunGroupMeta: vi.fn(() => ({ name: "TEST", kind: "workflow", presetKind: "creative" })),
    lastAppliedPresetRef: { current: null },
    locale: "ko",
    findDirectInputNodeIds: vi.fn(() => []),
    webBridgeStageWarnTimerRef: { current: {} },
    activeWebPromptRef: { current: {} },
    activeWebNodeByProviderRef: { current: {} },
    turnTerminalResolverRef: { current: null },
    webTurnResolverRef: { current: null },
    webLoginResolverRef: { current: null },
    clearQueuedWebTurnRequests: vi.fn(),
    manualInputWaitNoticeByNodeRef: { current: {} },
    setPendingWebTurn: vi.fn(),
    setSuspendedWebTurn: vi.fn(),
    setSuspendedWebResponseDraft: vi.fn(),
    setPendingWebLogin: vi.fn(),
    setWebResponseDraft: vi.fn(),
    internalMemoryCorpusRef: { current: [] },
    activeRunPresetKindRef: { current: undefined },
    activeTurnNodeIdRef: { current: "" },
    activeTurnThreadByNodeIdRef: { current: {} },
    setIsGraphRunning: vi.fn(),
    setIsGraphPaused: vi.fn(),
    setIsRunStarting: vi.fn(),
    runStartGuardRef: { current: false },
    cancelRequestedRef: { current: false },
    pauseRequestedRef: { current: false },
    collectingRunRef: { current: false },
    setActiveFeedRunMeta: vi.fn(),
    isGraphRunning: false,
    pendingWebLogin: false,
    resolvePendingWebLogin: vi.fn(),
    invokeFn: vi.fn(),
    addNodeLog: vi.fn(),
    clearWebBridgeStageWarnTimer: vi.fn(),
    pendingWebTurn: null,
    suspendedWebTurn: null,
    resolvePendingWebTurn: vi.fn(),
    pauseErrorToken: "__pause__",
  } as any;
}

describe("createRunGraphControlHandlers", () => {
  it("allows multiple direct-input roots", async () => {
    const params = createParams();
    params.graph = {
      nodes: [
        { id: "a", type: "turn", position: { x: 0, y: 0 }, config: {} },
        { id: "b", type: "turn", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };
    params.findDirectInputNodeIds = vi.fn(() => ["a", "b"]);

    const { prepareRunGraphStart } = createRunGraphControlHandlers(params);
    const result = await prepareRunGraphStart(true);

    expect(result).toEqual({ name: "TEST", kind: "workflow", presetKind: "creative" });
    expect(params.setError).not.toHaveBeenCalled();
  });

  it("rejects graphs without any direct-input root", async () => {
    const params = createParams();
    params.graph = {
      nodes: [{ id: "joined", type: "turn", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };
    params.findDirectInputNodeIds = vi.fn(() => []);

    const { prepareRunGraphStart } = createRunGraphControlHandlers(params);
    const result = await prepareRunGraphStart(true);

    expect(result).toBeNull();
    expect(params.setError).toHaveBeenCalledWith(
      "질문 직접 입력으로 시작되는 노드가 없습니다. 최소 1개 노드를 질문에서 시작되게 연결하세요.",
    );
  });

  it("still prepares graph execution when Codex login is missing", async () => {
    const params = createParams();
    params.loginCompleted = false;
    params.graph = {
      nodes: [{ id: "a", type: "turn", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };
    params.findDirectInputNodeIds = vi.fn(() => ["a"]);

    const { prepareRunGraphStart } = createRunGraphControlHandlers(params);
    const result = await prepareRunGraphStart(true);

    expect(result).toEqual({ name: "TEST", kind: "workflow", presetKind: "creative" });
    expect(params.setError).not.toHaveBeenCalled();
  });
});
