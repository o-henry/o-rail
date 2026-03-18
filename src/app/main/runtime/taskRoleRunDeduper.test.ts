import { beforeEach, describe, expect, it } from "vitest";
import { resetTaskRoleRunDeduper, shouldSkipRecentTaskRoleRun } from "./taskRoleRunDeduper";

describe("taskRoleRunDeduper", () => {
  beforeEach(() => {
    resetTaskRoleRunDeduper();
  });

  it("blocks duplicate role runs inside the dedupe window", () => {
    const first = shouldSkipRecentTaskRoleRun({
      taskId: "thread-1",
      roleId: "unity_implementer",
      prompt: "점프 버그를 고쳐줘",
      now: 1000,
    });
    const second = shouldSkipRecentTaskRoleRun({
      taskId: "thread-1",
      roleId: "unity_implementer",
      prompt: "점프 버그를 고쳐줘",
      now: 2000,
    });

    expect(first).toBe(false);
    expect(second).toBe(true);
  });

  it("allows rerun after the dedupe window expires", () => {
    shouldSkipRecentTaskRoleRun({
      taskId: "thread-1",
      roleId: "unity_implementer",
      prompt: "점프 버그를 고쳐줘",
      now: 1000,
    });
    const third = shouldSkipRecentTaskRoleRun({
      taskId: "thread-1",
      roleId: "unity_implementer",
      prompt: "점프 버그를 고쳐줘",
      now: 50_500,
    });

    expect(third).toBe(false);
  });
});
