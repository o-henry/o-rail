import { describe, expect, it } from "vitest";
import { isTasksLeftNavToggleShortcut } from "./tasksWorkspaceShortcuts";

describe("tasksWorkspaceShortcuts", () => {
  it("recognizes option+command+b", () => {
    expect(
      isTasksLeftNavToggleShortcut({
        key: "b",
        code: "KeyB",
        ctrlKey: false,
        altKey: true,
        metaKey: true,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(true);
  });

  it("rejects modified or repeated variants", () => {
    expect(
      isTasksLeftNavToggleShortcut({
        key: "b",
        code: "KeyB",
        ctrlKey: false,
        altKey: true,
        metaKey: false,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false);
    expect(
      isTasksLeftNavToggleShortcut({
        key: "b",
        code: "KeyB",
        ctrlKey: false,
        altKey: true,
        metaKey: true,
        shiftKey: false,
        repeat: true,
      }),
    ).toBe(false);
    expect(
      isTasksLeftNavToggleShortcut({
        key: "b",
        code: "KeyB",
        ctrlKey: true,
        altKey: true,
        metaKey: true,
        shiftKey: false,
        repeat: false,
      }),
    ).toBe(false);
  });
});
