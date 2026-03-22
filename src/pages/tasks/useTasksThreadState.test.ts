import { describe, expect, it } from "vitest";
import {
  deriveAutomaticResearchProviderBadge,
  resolveAutomaticResearchModel,
  isTasksCodexExecutionBlocked,
  reduceLiveRoleEventBatch,
  rememberTasksProjectPath,
  resolveTasksProjectSelection,
  revealTasksProjectPathState,
  shouldAutoUseExternalResearchProvider,
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

describe("resolveTasksProjectSelection", () => {
  it("does not revive a hidden cwd as the selected project", () => {
    expect(resolveTasksProjectSelection({
      cwd: "/repo/rail-docs",
      projectPath: "/repo/rail-docs",
      projectPaths: ["/repo/rail-docs"],
      hiddenProjectPaths: ["/repo/rail-docs"],
    })).toBe("");
  });

  it("falls back to the first visible project when the selected one is hidden", () => {
    expect(resolveTasksProjectSelection({
      cwd: "/repo/rail-docs",
      projectPath: "/repo/rail-docs",
      projectPaths: ["/repo/rail-docs", "/repo/playground"],
      hiddenProjectPaths: ["/repo/rail-docs"],
    })).toBe("/repo/playground");
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

describe("shouldAutoUseExternalResearchProvider", () => {
  it("turns on for researcher-tagged prompts on codex models", () => {
    expect(shouldAutoUseExternalResearchProvider({
      currentModel: "GPT-5.4",
      prompt: "게임 반응을 조사해줘",
      taggedRoles: ["researcher"],
    })).toBe(true);
  });

  it("stays off when the user already picked a non-codex runtime", () => {
    expect(shouldAutoUseExternalResearchProvider({
      currentModel: "GPT-Web",
      prompt: "게임 반응을 조사해줘",
      taggedRoles: ["researcher"],
    })).toBe(false);
  });
});

describe("resolveAutomaticResearchModel", () => {
  it("honors an explicit provider override without mutating the base model", async () => {
    const invokeFn = (async () => ({ ready: false })) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    await expect(resolveAutomaticResearchModel({
      invokeFn,
      cwd: "/repo",
      currentModel: "GPT-5.4",
      prompt: "최근 인디게임 시장 반응을 조사해줘",
      taggedRoles: ["researcher"],
      hasTauriRuntime: true,
      preferredProviderModel: "WEB / LIGHTPANDA",
    })).resolves.toBe("WEB / LIGHTPANDA");
  });

  it("prefers WEB / STEEL when researcher-style requests have a ready steel runtime", async () => {
    const invokeFn = (async (_command: string, args?: Record<string, unknown>) => {
      const provider = String(args?.provider ?? "");
      if (provider === "steel") {
        return { ready: true };
      }
      return { ready: false };
    }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    await expect(resolveAutomaticResearchModel({
      invokeFn,
      cwd: "/repo",
      currentModel: "GPT-5.4",
      prompt: "최근 인디게임 시장 반응을 조사해줘",
      taggedRoles: ["researcher"],
      hasTauriRuntime: true,
    })).resolves.toBe("WEB / STEEL");
  });

  it("falls back to WEB / LIGHTPANDA when steel is unavailable", async () => {
    const invokeFn = (async (_command: string, args?: Record<string, unknown>) => {
      const provider = String(args?.provider ?? "");
      if (provider === "steel") {
        return { ready: false };
      }
      if (provider === "lightpanda_experimental") {
        return { ready: true };
      }
      return { ready: false };
    }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    await expect(resolveAutomaticResearchModel({
      invokeFn,
      cwd: "/repo",
      currentModel: "GPT-5.4",
      prompt: "최근 인디게임 시장 반응을 조사해줘",
      taggedRoles: ["researcher"],
      hasTauriRuntime: true,
    })).resolves.toBe("WEB / LIGHTPANDA");
  });
});

describe("deriveAutomaticResearchProviderBadge", () => {
  it("shows the explicit provider badge when the user picked one", () => {
    expect(deriveAutomaticResearchProviderBadge({
      currentModel: "GPT-5.4",
      prompt: "게임 반응을 조사해줘",
      taggedRoles: ["researcher"],
      preferredProviderModel: "WEB / STEEL",
      readiness: { steel: false, lightpanda: false },
    })).toBe("WEB / STEEL");
  });

  it("falls back to the first ready automatic provider for research prompts", () => {
    expect(deriveAutomaticResearchProviderBadge({
      currentModel: "GPT-5.4",
      prompt: "게임 반응을 조사해줘",
      taggedRoles: ["researcher"],
      readiness: { steel: true, lightpanda: true },
    })).toBe("WEB / STEEL");
  });
});

describe("reduceLiveRoleEventBatch", () => {
  it("batches duplicate progress events into one timeline entry and one live note", () => {
    const reduced = reduceLiveRoleEventBatch({
      activeThreadId: "thread-1",
      currentNotes: {},
      currentEvents: [],
      details: [
        {
          taskId: "thread-1",
          runId: "run-1",
          studioRoleId: "research_analyst",
          type: "run_progress",
          stage: "search",
          message: "자료 조사 중",
          at: "2026-03-22T00:00:00.000Z",
        },
        {
          taskId: "thread-1",
          runId: "run-1",
          studioRoleId: "research_analyst",
          type: "run_progress",
          stage: "search",
          message: "자료 조사 중",
          at: "2026-03-22T00:00:00.000Z",
        },
      ],
    });

    expect(reduced.nextEvents).toHaveLength(1);
    expect(reduced.nextNotes.researcher?.message).toBe("자료 조사 중");
    expect(reduced.shouldRefresh).toBe(false);
  });

  it("clears completed role notes and schedules a refresh for done/error events", () => {
    const reduced = reduceLiveRoleEventBatch({
      activeThreadId: "thread-1",
      currentNotes: {
        researcher: {
          message: "자료 조사 중",
          updatedAt: "2026-03-22T00:00:00.000Z",
        },
      },
      currentEvents: [],
      details: [
        {
          taskId: "thread-1",
          runId: "run-1",
          studioRoleId: "research_analyst",
          type: "run_done",
          stage: "done",
          message: "완료",
          at: "2026-03-22T00:00:01.000Z",
        },
      ],
    });

    expect(reduced.nextNotes.researcher).toBeUndefined();
    expect(reduced.nextEvents).toHaveLength(1);
    expect(reduced.shouldRefresh).toBe(true);
  });
});
