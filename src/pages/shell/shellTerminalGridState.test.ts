import { describe, expect, it } from "vitest";
import {
  createShellTerminalPane,
  renameShellTerminalPaneTitle,
  reorderShellTerminalPanes,
} from "./shellTerminalGridState";

describe("shellTerminalGridState", () => {
  it("creates a uniquely identified terminal pane with the expected title", () => {
    const pane = createShellTerminalPane({ threadId: "thread_1", cwd: "/repo/.worktrees/thread_1", index: 2 });

    expect(pane.title).toBe("TERMINAL 2");
    expect(pane.subtitle).toBe("/repo/.worktrees/thread_1");
    expect(pane.status).toBe("idle");
    expect(pane.id).toMatch(/^tasks-shell-terminal:thread_1:2:/);
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
