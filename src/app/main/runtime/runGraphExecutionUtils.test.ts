import { describe, expect, it, vi } from "vitest";
import { cancelGraphRun } from "./runGraphExecutionUtils";

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
