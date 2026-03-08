import { describe, expect, it } from "vitest";
import { buildWorkspaceTabModel } from "./workspaceDockTabs";
import type { WorkflowWorkspaceTerminalPane } from "./workflowWorkspaceTerminalTypes";

function pane(id: string): WorkflowWorkspaceTerminalPane {
  return {
    id,
    title: id,
    subtitle: "",
    startupCommand: "codex",
    buffer: "",
    input: "",
    status: "idle",
    exitCode: null,
  };
}

describe("workspaceDockTabs", () => {
  it("shows the selected pane and its paired neighbor", () => {
    const panes = ["a", "b", "c", "d"].map(pane);
    expect(buildWorkspaceTabModel(panes, "c")).toEqual({
      activePaneId: "c",
      pairStartIndex: 2,
      visiblePaneIds: ["c", "d"],
    });
  });

  it("falls back to the first pair when selection is missing", () => {
    const panes = ["a", "b", "c", "d"].map(pane);
    expect(buildWorkspaceTabModel(panes, "missing")).toEqual({
      activePaneId: "a",
      pairStartIndex: 0,
      visiblePaneIds: ["a", "b"],
    });
  });
});
