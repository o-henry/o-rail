import { describe, expect, it } from "vitest";
import {
  isTasksCodexExecutionBlocked,
  rememberTasksProjectPath,
  revealTasksProjectPathState,
} from "./useTasksThreadState";

describe("rememberTasksProjectPath", () => {
  it("adds a discovered project without unhiding it elsewhere", () => {
    expect(rememberTasksProjectPath(["/repo/other"], "/repo/hidden/")).toEqual([
      "/repo/other",
      "/repo/hidden",
    ]);
  });

  it("does not duplicate an existing project path", () => {
    expect(rememberTasksProjectPath(["/repo/hidden"], "/repo/hidden/")).toEqual([
      "/repo/hidden",
    ]);
  });
});

describe("revealTasksProjectPathState", () => {
  it("only explicit reveal removes a project from the hidden list", () => {
    expect(revealTasksProjectPathState({
      hiddenProjectPaths: ["/repo/hidden"],
      projectPaths: ["/repo/other"],
      nextPath: "/repo/hidden/",
    })).toEqual({
      hiddenProjectPaths: [],
      projectPaths: ["/repo/other", "/repo/hidden"],
    });
  });
});

describe("isTasksCodexExecutionBlocked", () => {
  it("no longer blocks desktop task execution while auth is still being checked", () => {
    expect(isTasksCodexExecutionBlocked({
      hasTauriRuntime: true,
      loginCompleted: false,
      codexAuthCheckPending: true,
    })).toBe(false);
  });

  it("no longer blocks desktop task execution when login is missing", () => {
    expect(isTasksCodexExecutionBlocked({
      hasTauriRuntime: true,
      loginCompleted: false,
      codexAuthCheckPending: false,
    })).toBe(false);
  });

  it("allows browser-mode task execution without the Codex gate", () => {
    expect(isTasksCodexExecutionBlocked({
      hasTauriRuntime: false,
      loginCompleted: false,
      codexAuthCheckPending: false,
    })).toBe(false);
  });
});
