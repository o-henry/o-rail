import { describe, expect, it, vi } from "vitest";
import type { GraphNode } from "../../../features/workflow/types";
import type { ExecuteTurnNodeContext } from "./executeTurnNode";
import { executeTurnNodeWithContext } from "./executeTurnNode";

function buildContext(): ExecuteTurnNodeContext {
  return {
    model: "GPT-5.4",
    cwd: "/tmp/project",
    locale: "ko",
    workflowQuestion: "",
    codexMultiAgentMode: "off",
    forceAgentRulesAllTurns: false,
    turnOutputSchemaEnabled: false,
    pauseErrorToken: "__pause__",
    nodeStates: {},
    activeRunPresetKindRef: { current: null },
    internalMemoryCorpusRef: { current: [] },
    activeWebNodeByProviderRef: { current: {} },
    activeWebPromptRef: { current: {} },
    activeWebProviderByNodeRef: { current: {} },
    activeWebPromptByNodeRef: { current: {} },
    manualWebFallbackNodeRef: { current: {} },
    pauseRequestedRef: { current: false },
    cancelRequestedRef: { current: false },
    activeTurnNodeIdRef: { current: "" },
    activeTurnThreadByNodeIdRef: { current: {} },
    activeRunDeltaRef: { current: {} },
    turnTerminalResolverRef: { current: null },
    consumeNodeRequests: () => [],
    addNodeLog: vi.fn(),
    setStatus: vi.fn(),
    setNodeStatus: vi.fn(),
    setNodeRuntimeFields: vi.fn(),
    requestWebTurnResponse: vi.fn(),
    ensureWebWorkerReady: vi.fn(),
    clearWebBridgeStageWarnTimer: vi.fn(),
    loadAgentRuleDocs: vi.fn(async () => []),
    injectKnowledgeContext: vi.fn(async ({ prompt }) => ({ prompt, trace: [], memoryTrace: [] })),
    invokeFn: vi.fn(),
    openUrlFn: vi.fn(),
    t: (key: string) => key,
  };
}

describe("executeTurnNodeWithContext", () => {
  it("passes the real GPT-5.4 engine id and reasoning effort to turn_start", async () => {
    const node: GraphNode = {
      id: "turn-node",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        executor: "codex",
        model: "GPT-5.4",
        reasoningLevel: "매우 높음",
        temperature: 0.48,
        contextBudget: "wide",
        maxInputChars: 5200,
        promptTemplate: "{{input}}",
      },
    };
    const ctx = buildContext();
    const invokeFn: ExecuteTurnNodeContext["invokeFn"] = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "thread_start") {
        return { threadId: "thread-1", raw: {} } as never;
      }
      if (command === "turn_start_blocking") {
        return { turnId: "turn-1", output_text: "done", usage: {} } as never;
      }
      throw new Error(`unexpected command ${command}: ${JSON.stringify(args)}`);
    });
    ctx.invokeFn = invokeFn;

    const result = await executeTurnNodeWithContext(node, "테스트 입력", ctx);

    expect(result.ok).toBe(true);
    expect(invokeFn).toHaveBeenCalledWith("thread_start", {
      model: "gpt-5.4",
      cwd: "/tmp/project",
    });
    const turnStartCall = vi.mocked(invokeFn).mock.calls.find((row) => row[0] === "turn_start_blocking");
    expect(turnStartCall?.[1]).toMatchObject({
      threadId: "thread-1",
      reasoningEffort: "xhigh",
      temperature: 0.48,
      contextBudget: "wide",
      maxInputChars: 5200,
    });
    expect(String(turnStartCall?.[1]?.text ?? "")).toContain("테스트 입력");
  });

  it("clips oversized prompt input by maxInputChars before execution", async () => {
    const node: GraphNode = {
      id: "turn-node",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        executor: "codex",
        model: "GPT-5.4",
        temperature: 0.36,
        contextBudget: "tight",
        maxInputChars: 640,
        promptTemplate: "{{input}}",
      },
    };
    const ctx = buildContext();
    const invokeFn: ExecuteTurnNodeContext["invokeFn"] = vi.fn(async (command: string) => {
      if (command === "thread_start") {
        return { threadId: "thread-1", raw: {} } as never;
      }
      if (command === "turn_start_blocking") {
        return { turnId: "turn-1", output_text: "done", usage: {} } as never;
      }
      throw new Error(`unexpected command ${command}`);
    });
    ctx.invokeFn = invokeFn;

    const result = await executeTurnNodeWithContext(node, "x".repeat(2400), ctx);

    expect(result.ok).toBe(true);
    const turnStartCall = vi.mocked(invokeFn).mock.calls.find((row) => row[0] === "turn_start_blocking");
    expect(turnStartCall?.[1]).toMatchObject({
      temperature: 0.36,
      contextBudget: "tight",
      maxInputChars: 640,
    });
    expect(String(turnStartCall?.[1]?.text ?? "")).toContain("[입력 일부 생략됨: context budget 제한]");
  });

  it("injects unity automation guard context for unity automation presets", async () => {
    const node: GraphNode = {
      id: "turn-node",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        executor: "codex",
        model: "GPT-5.4",
        promptTemplate: "{{input}}",
      },
    };
    const ctx = buildContext();
    ctx.activeRunPresetKindRef.current = "unityCiDoctor";
    const invokeFn: ExecuteTurnNodeContext["invokeFn"] = vi.fn(async (command: string) => {
      if (command === "unity_guard_inspect") {
        return {
          projectPath: "/tmp/project",
          unityProject: true,
          recommendedMode: "git_worktree",
          protectedPaths: ["ProjectSettings/**"],
          latestDiagnosticsPath: "/tmp/latest-diagnostics.json",
          latestDiagnosticsMarkdownPath: "/tmp/latest-diagnostics.md",
          worktreeRoot: "/tmp/.rail/unity/sandboxes",
          warnings: [],
        } as never;
      }
      if (command === "unity_collect_diagnostics") {
        return {
          projectPath: "/tmp/project",
          recommendedMode: "git_worktree",
          summary: "1 error",
          files: [],
          savedJsonPath: "/tmp/latest-diagnostics.json",
          savedMarkdownPath: "/tmp/latest-diagnostics.md",
        } as never;
      }
      if (command === "thread_start") {
        return { threadId: "thread-1", raw: {} } as never;
      }
      if (command === "turn_start_blocking") {
        return { turnId: "turn-1", output_text: "done", usage: {} } as never;
      }
      throw new Error(`unexpected command ${command}`);
    });
    ctx.invokeFn = invokeFn;

    const result = await executeTurnNodeWithContext(node, "에러 로그", ctx);

    expect(result.ok).toBe(true);
    const turnStartCall = vi.mocked(invokeFn).mock.calls.find((row) => row[0] === "turn_start_blocking");
    expect(String(turnStartCall?.[1]?.text ?? "")).toContain("[UNITY_AUTOMATION_CONTEXT]");
    expect(String(turnStartCall?.[1]?.text ?? "")).toContain("recommendedMode=git_worktree");
  });

  it("tracks and clears active turn threads around blocking codex execution", async () => {
    const node: GraphNode = {
      id: "parallel-turn",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        executor: "codex",
        model: "GPT-5.4",
        promptTemplate: "{{input}}",
      },
    };
    const ctx = buildContext();
    let observedDuringRun = "";
    ctx.invokeFn = vi.fn(async (command: string) => {
      if (command === "thread_start") {
        return { threadId: "thread-parallel", raw: {} } as never;
      }
      if (command === "turn_start_blocking") {
        observedDuringRun = ctx.activeTurnThreadByNodeIdRef.current[node.id] ?? "";
        return { turnId: "turn-1", output_text: "done", usage: {} } as never;
      }
      throw new Error(`unexpected command ${command}`);
    });

    const result = await executeTurnNodeWithContext(node, "테스트 입력", ctx);

    expect(result.ok).toBe(true);
    expect(observedDuringRun).toBe("thread-parallel");
    expect(ctx.activeTurnThreadByNodeIdRef.current[node.id]).toBeUndefined();
  });
});
