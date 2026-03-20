import { describe, expect, it } from "vitest";
import { buildTasksSessionIndex, deriveComposerCoordinationPreview, queryTasksSessionIndex } from "./taskOrchestrationState";

describe("taskOrchestrationState", () => {
  it("derives a fanout preview for research-heavy prompts", () => {
    const preview = deriveComposerCoordinationPreview({
      prompt: "Compare docs and gather source-backed research",
      roleIds: ["researcher"],
    });
    expect(preview?.recommendedMode).toBe("fanout");
    expect(preview?.selectedMode).toBe("fanout");
  });

  it("searches indexed runtime sessions by title and action", () => {
    const entries = buildTasksSessionIndex({
      thread_1: {
        threadId: "thread_1",
        prompt: "Prompt",
        requestedRoleIds: ["researcher"],
        recommendedMode: "team",
        mode: "team",
        intent: "review_heavy",
        status: "needs_resume",
        nextAction: "Resume after approval",
        blockedReason: "Waiting for approval",
        plan: null,
        delegateTasks: [],
        delegateResults: [],
        teamSession: null,
        resumePointer: null,
        guidance: [],
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    }, []);
    expect(queryTasksSessionIndex(entries, "resume")).toHaveLength(1);
  });
});
