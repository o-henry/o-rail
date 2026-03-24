import { describe, expect, it } from "vitest";
import { shouldForwardRoleRunToMissionControl } from "./useRoleRunCompletionBridge";

describe("useRoleRunCompletionBridge", () => {
  it("does not forward tasks role completions into mission control", () => {
    expect(shouldForwardRoleRunToMissionControl("tasks")).toBe(false);
    expect(shouldForwardRoleRunToMissionControl("tasks-thread")).toBe(false);
  });

  it("forwards workflow-style role completions into mission control", () => {
    expect(shouldForwardRoleRunToMissionControl("agents")).toBe(true);
    expect(shouldForwardRoleRunToMissionControl("workflow")).toBe(true);
    expect(shouldForwardRoleRunToMissionControl("workbench")).toBe(true);
  });
});
