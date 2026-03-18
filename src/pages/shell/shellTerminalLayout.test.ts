import { describe, expect, it } from "vitest";
import {
  collectShellTerminalPaneIds,
  createShellTerminalLeaf,
  removePaneFromShellTerminalLayout,
  splitShellTerminalLayout,
  updateShellTerminalSplitRatio,
} from "./shellTerminalLayout";

describe("shellTerminalLayout", () => {
  it("splits a target pane into a new horizontal pair", () => {
    const root = createShellTerminalLeaf("pane-1");
    const next = splitShellTerminalLayout({
      node: root,
      targetPaneId: "pane-1",
      newPaneId: "pane-2",
      direction: "right",
      splitId: "split-1",
    });

    expect(next).toMatchObject({
      kind: "split",
      id: "split-1",
      orientation: "horizontal",
      ratio: 0.5,
    });
    expect(collectShellTerminalPaneIds(next)).toEqual(["pane-1", "pane-2"]);
  });

  it("can nest a split into the second pane", () => {
    const root = splitShellTerminalLayout({
      node: createShellTerminalLeaf("pane-1"),
      targetPaneId: "pane-1",
      newPaneId: "pane-2",
      direction: "right",
      splitId: "split-1",
    });
    const next = splitShellTerminalLayout({
      node: root,
      targetPaneId: "pane-2",
      newPaneId: "pane-3",
      direction: "bottom",
      splitId: "split-2",
    });

    expect(collectShellTerminalPaneIds(next)).toEqual(["pane-1", "pane-2", "pane-3"]);
  });

  it("updates only the targeted split ratio", () => {
    const root = splitShellTerminalLayout({
      node: createShellTerminalLeaf("pane-1"),
      targetPaneId: "pane-1",
      newPaneId: "pane-2",
      direction: "right",
      splitId: "split-1",
    });
    const next = updateShellTerminalSplitRatio(root, "split-1", 0.72);

    expect(next).toMatchObject({
      kind: "split",
      id: "split-1",
      ratio: 0.72,
    });
  });

  it("collapses the sibling when a pane is removed", () => {
    const root = splitShellTerminalLayout({
      node: createShellTerminalLeaf("pane-1"),
      targetPaneId: "pane-1",
      newPaneId: "pane-2",
      direction: "right",
      splitId: "split-1",
    });
    const next = removePaneFromShellTerminalLayout(root, "pane-2");

    expect(next).toEqual({
      kind: "leaf",
      paneId: "pane-1",
    });
  });
});
