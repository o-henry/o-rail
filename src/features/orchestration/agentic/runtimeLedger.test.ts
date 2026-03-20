import { describe, expect, it } from "vitest";
import { appendRuntimeLedger, buildRuntimeLedgerPaths, buildRuntimeSessionIndexPath, searchSessionIndex, upsertSessionIndex } from "./runtimeLedger";

describe("runtimeLedger", () => {
  it("builds stable workspace ledger paths", () => {
    expect(buildRuntimeLedgerPaths("/workspace/demo", "thread:1")).toEqual({
      root: "/workspace/demo/.rail/runtime/tasks/thread%3A1",
      statePath: "/workspace/demo/.rail/runtime/tasks/thread%3A1/coordination.json",
      ledgerPath: "/workspace/demo/.rail/runtime/tasks/thread%3A1/ledger.json",
      indexPath: "/workspace/demo/.rail/runtime/tasks/index.json",
    });
    expect(buildRuntimeSessionIndexPath("/workspace/demo")).toBe("/workspace/demo/.rail/runtime/tasks/index.json");
  });

  it("upserts and searches session index entries", () => {
    const entries = upsertSessionIndex([], {
      threadId: "thread_1",
      title: "Refactor review",
      mode: "team",
      intent: "review_heavy",
      status: "needs_resume",
      nextAction: "Resume after review.",
      updatedAt: "2026-03-20T00:01:00.000Z",
    });
    const next = upsertSessionIndex(entries, {
      threadId: "thread_2",
      title: "Research compare",
      mode: "fanout",
      intent: "research",
      status: "running",
      nextAction: "Wait for delegate results.",
      updatedAt: "2026-03-20T00:02:00.000Z",
    });
    expect(searchSessionIndex(next, "resume")).toHaveLength(1);
    expect(searchSessionIndex(next, "research")[0]?.threadId).toBe("thread_2");
  });

  it("appends runtime ledger events in chronological order", () => {
    const events = appendRuntimeLedger(
      [
        { id: "b", threadId: "thread_1", kind: "run_started", summary: "started", at: "2026-03-20T00:02:00.000Z" },
      ],
      { id: "a", threadId: "thread_1", kind: "plan_ready", summary: "ready", at: "2026-03-20T00:01:00.000Z" },
    );
    expect(events.map((event) => event.id)).toEqual(["a", "b"]);
  });
});
