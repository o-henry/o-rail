import { describe, expect, it, vi } from "vitest";
import { loadPersistedCoordinationState, loadPersistedRuntimeSessionIndex, mergeRuntimeSessionIndexes, pickNewerCoordinationState } from "./taskRuntimeHydration";
import type { AgenticCoordinationState } from "../../features/orchestration/agentic/coordinationTypes";

function buildCoordination(overrides: Partial<AgenticCoordinationState> = {}): AgenticCoordinationState {
  return {
    threadId: "thread_1",
    prompt: "Review the current implementation",
    requestedRoleIds: ["reviewer"],
    recommendedMode: "team",
    mode: "team",
    intent: "review_heavy",
    status: "needs_resume",
    nextAction: "Resume after approval",
    blockedReason: "Waiting for operator approval",
    plan: null,
    delegateTasks: [],
    delegateResults: [],
    teamSession: null,
    resumePointer: null,
    guidance: [],
    updatedAt: "2026-03-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("taskRuntimeHydration", () => {
  it("prefers the newer coordination state when hydrating", () => {
    const current = buildCoordination({ updatedAt: "2026-03-20T00:00:00.000Z", status: "running" });
    const persisted = buildCoordination({ updatedAt: "2026-03-20T00:01:00.000Z", status: "needs_resume" });
    expect(pickNewerCoordinationState(current, persisted)?.status).toBe("needs_resume");
  });

  it("merges runtime session indexes by thread and keeps latest ordering", () => {
    const merged = mergeRuntimeSessionIndexes(
      [
        {
          threadId: "thread_1",
          title: "Current",
          mode: "quick",
          intent: "simple",
          status: "running",
          nextAction: "Continue",
          updatedAt: "2026-03-20T00:01:00.000Z",
        },
      ],
      [
        {
          threadId: "thread_1",
          title: "Persisted",
          mode: "team",
          intent: "review_heavy",
          status: "needs_resume",
          nextAction: "Resume",
          updatedAt: "2026-03-20T00:02:00.000Z",
        },
        {
          threadId: "thread_2",
          title: "Research",
          mode: "fanout",
          intent: "research",
          status: "running",
          nextAction: "Wait for delegates",
          updatedAt: "2026-03-20T00:03:00.000Z",
        },
      ],
    );
    expect(merged.map((entry) => entry.threadId)).toEqual(["thread_2", "thread_1"]);
    expect(merged[1]?.title).toBe("Persisted");
  });

  it("loads persisted coordination and index from workspace files", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const path = String(args?.path ?? "");
      if (path.endsWith("coordination.json")) {
        return JSON.stringify(buildCoordination({ status: "blocked" }));
      }
      if (path.endsWith("index.json")) {
        return JSON.stringify([
          {
            threadId: "thread_3",
            title: "Blocked review",
            mode: "team",
            intent: "review_heavy",
            status: "blocked",
            nextAction: "Resolve merge conflict",
            updatedAt: "2026-03-20T00:04:00.000Z",
          },
        ]);
      }
      return "";
    });

    const invokeFn = invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    const state = await loadPersistedCoordinationState("/workspace/demo", "thread_3", invokeFn);
    const index = await loadPersistedRuntimeSessionIndex("/workspace/demo", invokeFn);

    expect(state?.status).toBe("blocked");
    expect(index[0]?.threadId).toBe("thread_3");
  });
});
