import { describe, expect, it } from "vitest";
import { shouldLoadVisualizeWorkspaceData } from "./useVisualizePageState";

describe("shouldLoadVisualizeWorkspaceData", () => {
  it("loads visualize workspace data only for an active tab with a new workspace", () => {
    expect(shouldLoadVisualizeWorkspaceData({
      cwd: "/tmp/workspace",
      hasTauriRuntime: true,
      isActive: true,
      loadedWorkspaceCwd: "",
    })).toBe(true);
    expect(shouldLoadVisualizeWorkspaceData({
      cwd: "/tmp/workspace",
      hasTauriRuntime: true,
      isActive: true,
      loadedWorkspaceCwd: "/tmp/workspace",
    })).toBe(false);
    expect(shouldLoadVisualizeWorkspaceData({
      cwd: "/tmp/workspace",
      hasTauriRuntime: true,
      isActive: false,
      loadedWorkspaceCwd: "",
    })).toBe(false);
  });
});
