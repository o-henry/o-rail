import { describe, expect, it } from "vitest";
import {
  approveCoordinationPlan,
  blockCoordinationRun,
  completeCoordinationRun,
  createCoordinationState,
  deriveSessionIndexEntry,
  inferExecutionIntent,
  markCoordinationWaitingReview,
  readyCoordinationForExecution,
  reopenCoordinationRun,
  recommendCoordinationMode,
  startCoordinationRun,
} from "./coordination";

describe("coordination", () => {
  it("classifies research-heavy prompts as fanout", () => {
    const intent = inferExecutionIntent("Compare the docs and gather source-backed evidence.");
    expect(intent).toBe("research");
    expect(recommendCoordinationMode(intent)).toBe("fanout");
  });

  it("classifies review-heavy prompts as team", () => {
    const intent = inferExecutionIntent("Review the patch, verify risks, and request approval.");
    expect(intent).toBe("review_heavy");
    expect(recommendCoordinationMode(intent)).toBe("team");
  });

  it("creates a team plan that requires approval", () => {
    const state = createCoordinationState({
      threadId: "thread_1",
      prompt: "Plan the implementation, review the patch, then verify it.",
      overrideMode: "team",
      at: "2026-03-20T00:00:00.000Z",
    });
    expect(state.mode).toBe("team");
    expect(state.plan?.requiresApproval).toBe(true);
    expect(state.status).toBe("blocked");
    expect(state.teamSession?.lanes).toHaveLength(3);
  });

  it("moves a team run from approval to running and completion", () => {
    const initial = createCoordinationState({
      threadId: "thread_1",
      prompt: "Plan and coordinate this multi-step change.",
      overrideMode: "team",
      at: "2026-03-20T00:00:00.000Z",
    });
    const approved = approveCoordinationPlan(initial, "2026-03-20T00:01:00.000Z");
    const running = startCoordinationRun(approved, "2026-03-20T00:02:00.000Z");
    const completed = completeCoordinationRun(running, "2026-03-20T00:03:00.000Z");
    expect(approved.plan?.approvedAt).toBe("2026-03-20T00:01:00.000Z");
    expect(running.status).toBe("running");
    expect(completed.status).toBe("completed");
    expect(completed.plan?.steps.every((step) => step.status === "done")).toBe(true);
  });

  it("auto-approves team runs when preparing them for execution", () => {
    const initial = createCoordinationState({
      threadId: "thread_auto",
      prompt: "Coordinate a multi-step implementation automatically.",
      overrideMode: "team",
      at: "2026-03-20T00:00:00.000Z",
    });
    const ready = readyCoordinationForExecution(initial, "2026-03-20T00:00:30.000Z");
    expect(ready.plan?.approvedAt).toBe("2026-03-20T00:00:30.000Z");
    expect(ready.status).toBe("planning");
  });

  it("moves a team run into waiting review before final verification", () => {
    const initial = createCoordinationState({
      threadId: "thread_3",
      prompt: "Implement and review the final result.",
      overrideMode: "team",
      at: "2026-03-20T00:00:00.000Z",
    });
    const approved = approveCoordinationPlan(initial, "2026-03-20T00:01:00.000Z");
    const running = startCoordinationRun(approved, "2026-03-20T00:02:00.000Z");
    const review = markCoordinationWaitingReview(running, "2026-03-20T00:03:00.000Z");
    expect(review.status).toBe("waiting_review");
    expect(review.plan?.steps.find((step) => step.id === "execute")?.status).toBe("done");
    expect(review.plan?.steps.find((step) => step.id === "verify")?.status).toBe("active");
    expect(review.teamSession?.lanes.find((lane) => lane.id === "reviewer")?.status).toBe("review");
  });

  it("creates a resume pointer when the run is blocked", () => {
    const initial = createCoordinationState({
      threadId: "thread_2",
      prompt: "Review this change and verify the blocked approval.",
      overrideMode: "team",
      at: "2026-03-20T00:00:00.000Z",
    });
    const blocked = blockCoordinationRun(initial, {
      reason: "Waiting for approval",
      nextAction: "Resume after the approval is resolved.",
      at: "2026-03-20T00:04:00.000Z",
    });
    const indexEntry = deriveSessionIndexEntry(blocked, "Blocked review run");
    expect(blocked.resumePointer?.reason).toContain("approval");
    expect(indexEntry.status).toBe("needs_resume");
  });

  it("reopens a waiting review session into needs_resume", () => {
    const initial = createCoordinationState({
      threadId: "thread_4",
      prompt: "Review this result and reopen if needed.",
      overrideMode: "team",
      at: "2026-03-20T00:00:00.000Z",
    });
    const review = markCoordinationWaitingReview(
      startCoordinationRun(approveCoordinationPlan(initial, "2026-03-20T00:01:00.000Z"), "2026-03-20T00:02:00.000Z"),
      "2026-03-20T00:03:00.000Z",
    );
    const reopened = reopenCoordinationRun(review, {
      reason: "Reviewer requested follow-up changes.",
      nextAction: "Resume the team run to address the review feedback.",
      at: "2026-03-20T00:04:00.000Z",
    });
    expect(reopened.status).toBe("needs_resume");
    expect(reopened.resumePointer?.reason).toContain("follow-up");
    expect(reopened.plan?.steps.find((step) => step.id === "verify")?.status).toBe("pending");
  });
});
