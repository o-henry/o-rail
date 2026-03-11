import { describe, expect, it, vi } from "vitest";
import { createRunGraphRunner } from "./runGraphRunner";

function createBaseParams() {
  return {
    isGraphRunning: false,
    isGraphPaused: false,
    pauseRequestedRef: { current: false },
    setIsGraphPaused: vi.fn(),
    runStartGuardRef: { current: false },
    prepareRunGraphStart: vi.fn(async () => ({ name: "TEST", kind: "workflow", presetKind: "development" })),
    validateUnifiedRunInput: vi.fn(() => ({ ok: false as const, errors: ["invalid input"] })),
    workflowQuestion: "",
    locale: "ko",
    setError: vi.fn(),
    setStatus: vi.fn(),
    setPendingWebConnectCheck: vi.fn(),
    setIsRunStarting: vi.fn(),
    setIsGraphRunning: vi.fn(),
    cancelRequestedRef: { current: false },
    collectingRunRef: { current: false },
    createRunNodeStateSnapshot: vi.fn(),
    graph: { nodes: [], edges: [], knowledge: { files: [], topK: 3, maxChars: 2400 } },
    runLogCollectorRef: { current: [] },
    setNodeStates: vi.fn(),
    findDirectInputNodeIds: vi.fn(() => []),
    resolveGraphDagMaxThreads: vi.fn(() => 1),
  } as any;
}

describe("createRunGraphRunner", () => {
  it("prefers questionOverride for input validation", async () => {
    const params = createBaseParams();
    const runGraph = createRunGraphRunner(params);

    await runGraph(false, "override question");

    expect(params.validateUnifiedRunInput).toHaveBeenCalledWith("override question", "ko");
  });

  it("uses workflowQuestion when questionOverride is not provided", async () => {
    const params = createBaseParams();
    params.workflowQuestion = "workflow question";
    const runGraph = createRunGraphRunner(params);

    await runGraph(false);

    expect(params.validateUnifiedRunInput).toHaveBeenCalledWith("workflow question", "ko");
  });
});
