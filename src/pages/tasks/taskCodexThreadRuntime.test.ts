import { describe, expect, it } from "vitest";
import { extractCodexThreadStatus, extractTaskCodexThreadRuntime } from "./taskCodexThreadRuntime";

describe("extractTaskCodexThreadRuntime", () => {
  it("reads codex thread metadata from response json", () => {
    const runtime = extractTaskCodexThreadRuntime(JSON.stringify({
      codexThreadId: "codex-thread-1",
      codexTurnId: "turn-1",
    }));
    expect(runtime).toEqual({
      codexThreadId: "codex-thread-1",
      codexTurnId: "turn-1",
      codexThreadStatus: null,
    });
  });

  it("returns null when the payload does not contain a codex thread id", () => {
    expect(extractTaskCodexThreadRuntime("{\"hello\":true}")).toBeNull();
  });

  it("keeps the last known thread status when present in the payload", () => {
    const runtime = extractTaskCodexThreadRuntime(JSON.stringify({
      threadId: "codex-thread-2",
      thread: {
        status: "running",
      },
    }));
    expect(runtime).toEqual({
      codexThreadId: "codex-thread-2",
      codexTurnId: null,
      codexThreadStatus: "running",
    });
  });
});

describe("extractCodexThreadStatus", () => {
  it("prefers nested thread status", () => {
    expect(extractCodexThreadStatus({ thread: { status: "running" } })).toBe("running");
  });
});
