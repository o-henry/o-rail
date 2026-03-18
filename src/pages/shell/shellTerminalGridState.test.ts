import { describe, expect, it } from "vitest";
import {
  createShellTerminalPane,
  renameShellTerminalPaneTitle,
  reorderShellTerminalPanes,
} from "./shellTerminalGridState";

describe("shellTerminalGridState", () => {
  it("creates a stable terminal pane id and title", () => {
    expect(createShellTerminalPane({ threadId: "thread_1", cwd: "/repo/.worktrees/thread_1", index: 2 })).toMatchObject({
      id: "tasks-shell-terminal:thread_1:2",
      title: "TERMINAL 2",
      subtitle: "/repo/.worktrees/thread_1",
      status: "idle",
    });
  });

  it("reorders panes by dragged and target ids", () => {
    const panes = [
      createShellTerminalPane({ threadId: "thread_1", cwd: "/repo", index: 1 }),
      createShellTerminalPane({ threadId: "thread_1", cwd: "/repo", index: 2 }),
      createShellTerminalPane({ threadId: "thread_1", cwd: "/repo", index: 3 }),
    ];
    expect(reorderShellTerminalPanes(panes, panes[2]!.id, panes[0]!.id).map((pane) => pane.title)).toEqual([
      "TERMINAL 3",
      "TERMINAL 1",
      "TERMINAL 2",
    ]);
  });

  it("renames only the targeted pane title", () => {
    const panes = [
      createShellTerminalPane({ threadId: "thread_1", cwd: "/repo", index: 1 }),
      createShellTerminalPane({ threadId: "thread_1", cwd: "/repo", index: 2 }),
    ];
    expect(renameShellTerminalPaneTitle(panes, panes[1]!.id, "BUILD SHELL").map((pane) => pane.title)).toEqual([
      "TERMINAL 1",
      "BUILD SHELL",
    ]);
  });
});
