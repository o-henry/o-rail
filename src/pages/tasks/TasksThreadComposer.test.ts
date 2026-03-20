import { describe, expect, it } from "vitest";
import { buildSelectedTasksComposerBadges, canSubmitTasksComposer } from "./TasksThreadComposer";

describe("canSubmitTasksComposer", () => {
  it("returns false for empty or whitespace-only input", () => {
    expect(canSubmitTasksComposer("")).toBe(false);
    expect(canSubmitTasksComposer("   ")).toBe(false);
  });

  it("returns false when the draft only contains orchestration mode tags", () => {
    expect(canSubmitTasksComposer("@team")).toBe(false);
    expect(canSubmitTasksComposer("  @fanout   ")).toBe(false);
  });

  it("returns true when there is real prompt content", () => {
    expect(canSubmitTasksComposer("fix this bug")).toBe(true);
    expect(canSubmitTasksComposer("@team fix this bug")).toBe(true);
  });
});

describe("buildSelectedTasksComposerBadges", () => {
  it("includes coordination mode badges alongside agent badges", () => {
    expect(buildSelectedTasksComposerBadges({
      roleIds: ["researcher"],
      modeOverride: "fanout",
    })).toEqual([
      {
        key: "agent:researcher",
        kind: "agent",
        label: "RESEARCHER",
        roleId: "researcher",
      },
      {
        key: "mode:fanout",
        kind: "mode",
        label: "FANOUT",
        mode: "fanout",
      },
    ]);
  });
});
