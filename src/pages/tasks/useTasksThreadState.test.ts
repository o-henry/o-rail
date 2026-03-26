import { describe, expect, it } from "vitest";
import {
  isTasksThreadInterruptible,
  isTasksCodexExecutionBlocked,
  normalizeResolvedTaskRoleIds,
  reduceLiveRoleEventBatch,
  reduceRuntimeTargetsByRole,
  rememberTasksProjectPath,
  resolveTasksThreadWebProvider,
  resolveTasksProjectSelection,
  revealTasksProjectPathState,
  shouldPollCurrentThreadSilently,
  shouldIgnoreInterruptedThreadEvent,
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

describe("isTasksThreadInterruptible", () => {
  it("stays interruptible while coordination is still running even if no live agent status remains", () => {
    expect(isTasksThreadInterruptible({
      agentStatuses: ["idle", "done"],
      coordinationStatus: "running",
    })).toBe(true);
  });

  it("turns off once coordination is blocked or cancelled and no live agents remain", () => {
    expect(isTasksThreadInterruptible({
      agentStatuses: ["idle", "done"],
      coordinationStatus: "needs_resume",
    })).toBe(false);
    expect(isTasksThreadInterruptible({
      agentStatuses: ["idle", "done"],
      coordinationStatus: "cancelled",
    })).toBe(false);
  });

  it("stays interruptible while runtime targets are still attached", () => {
    expect(isTasksThreadInterruptible({
      agentStatuses: ["idle", "done"],
      coordinationStatus: "completed",
      runtimeTargetCount: 1,
    })).toBe(true);
  });

  it("stays interruptible while non-terminal live events are still present", () => {
    expect(isTasksThreadInterruptible({
      agentStatuses: ["idle", "done"],
      coordinationStatus: "completed",
      activeLiveEventCount: 1,
    })).toBe(true);
  });
});

describe("shouldPollCurrentThreadSilently", () => {
  it("skips polling while fresh live signals are still arriving", () => {
    expect(shouldPollCurrentThreadSilently({
      hasLiveAgents: true,
      coordinationStatus: "running",
      activeThreadId: "thread-1",
      hasTauriRuntime: true,
      cwd: "/repo",
      freshestLiveSignalAt: "2026-03-24T01:00:05.000Z",
      nowMs: Date.parse("2026-03-24T01:00:10.000Z"),
    })).toBe(false);
  });

  it("polls when live execution has gone quiet for a while", () => {
    expect(shouldPollCurrentThreadSilently({
      hasLiveAgents: true,
      coordinationStatus: "running",
      activeThreadId: "thread-1",
      hasTauriRuntime: true,
      cwd: "/repo",
      freshestLiveSignalAt: "2026-03-24T01:00:00.000Z",
      nowMs: Date.parse("2026-03-24T01:00:10.000Z"),
    })).toBe(true);
  });

  it("polls when there is no live signal yet but a run is active", () => {
    expect(shouldPollCurrentThreadSilently({
      hasLiveAgents: true,
      coordinationStatus: "running",
      activeThreadId: "thread-1",
      hasTauriRuntime: true,
      cwd: "/repo",
      freshestLiveSignalAt: "",
      nowMs: Date.parse("2026-03-24T01:00:10.000Z"),
    })).toBe(true);
  });
});

describe("reduceLiveRoleEventBatch", () => {
  it("drops lingering live events for a role once run_done arrives", () => {
    const reduced = reduceLiveRoleEventBatch({
      activeThreadId: "task-1",
      details: [
        {
          taskId: "task-1",
          studioRoleId: "research_analyst",
          runId: "run-1",
          type: "run_done",
          stage: "codex",
          message: "done",
          at: "2026-03-22T00:00:02Z",
        },
      ],
      currentNotes: {
        researcher: {
          message: "진행 중",
          updatedAt: "2026-03-22T00:00:01Z",
        },
      },
      currentEvents: [
        {
          id: "event-1",
          runId: "run-1",
          roleId: "researcher",
          agentLabel: "RESEARCHER",
          type: "stage_started",
          stage: "codex",
          message: "역할 실행 시작",
          at: "2026-03-22T00:00:01Z",
        },
      ],
    });

    expect(reduced.nextNotes).toEqual({});
    expect(reduced.nextEvents).toEqual([]);
    expect(reduced.shouldRefresh).toBe(true);
  });
});

describe("normalizeResolvedTaskRoleIds", () => {
  it("maps studio role ids back onto task preset ids for orchestration sync", () => {
    expect(normalizeResolvedTaskRoleIds(["pm_planner", "research_analyst", "system_programmer"])).toEqual([
      "game_designer",
      "researcher",
      "unity_architect",
    ]);
  });

  it("preserves task preset ids when they are already normalized", () => {
    expect(normalizeResolvedTaskRoleIds(["game_designer", "researcher"])).toEqual([
      "game_designer",
      "researcher",
    ]);
  });
});

describe("resolveTasksThreadWebProvider", () => {
  it("maps WEB / STEEL to the steel provider", () => {
    expect(resolveTasksThreadWebProvider("WEB / STEEL")).toBe("steel");
  });

  it("maps WEB / LIGHTPANDA to the lightpanda experimental provider", () => {
    expect(resolveTasksThreadWebProvider("WEB / LIGHTPANDA")).toBe("lightpanda_experimental");
  });

  it("returns null for codex-backed task models", () => {
    expect(resolveTasksThreadWebProvider("GPT-5.4")).toBeNull();
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
    expect(reduced.nextEvents).toHaveLength(0);
    expect(reduced.shouldRefresh).toBe(true);
  });

  it("hides internal terminal errors without promoting them to a thread refresh", () => {
    const reduced = reduceLiveRoleEventBatch({
      activeThreadId: "thread-1",
      currentNotes: {
        researcher: {
          message: "자료 조사 중",
          updatedAt: "2026-03-22T00:00:00.000Z",
        },
      },
      currentEvents: [
        {
          id: "event-1",
          runId: "run-1",
          roleId: "researcher",
          agentLabel: "RESEARCHER",
          type: "stage_started",
          stage: "codex",
          message: "역할 실행 시작",
          at: "2026-03-22T00:00:00.000Z",
        },
      ],
      details: [
        {
          taskId: "thread-1",
          runId: "run-1",
          studioRoleId: "research_analyst",
          type: "run_error",
          stage: "codex",
          message: "internal brief failed",
          at: "2026-03-22T00:00:01.000Z",
          payload: {
            internal: true,
            promptMode: "brief",
          },
        },
      ],
    });

    expect(reduced.nextNotes.researcher).toBeUndefined();
    expect(reduced.nextEvents).toEqual([]);
    expect(reduced.shouldRefresh).toBe(false);
  });

  it("does not churn live notes when only repeated progress timestamps change", () => {
    const currentNotes = {
      researcher: {
        message: "자료 조사 중",
        updatedAt: "2026-03-22T00:00:00.000Z",
      },
    } as const;
    const reduced = reduceLiveRoleEventBatch({
      activeThreadId: "thread-1",
      currentNotes,
      currentEvents: [],
      details: [
        {
          taskId: "thread-1",
          runId: "run-1",
          studioRoleId: "research_analyst",
          type: "run_progress",
          stage: "search",
          message: "자료 조사 중",
          at: "2026-03-22T00:00:03.000Z",
        },
      ],
    });

    expect(reduced.nextNotes).toBe(currentNotes);
    expect(reduced.nextEvents).toHaveLength(1);
    expect(reduced.shouldRefresh).toBe(false);
  });
});

describe("reduceRuntimeTargetsByRole", () => {
  it("stores codex thread ids and provider overrides from runtime attachment events", () => {
    const next = reduceRuntimeTargetsByRole({}, {
      taskId: "thread-1",
      studioRoleId: "research_analyst",
      type: "runtime_attached",
      payload: {
        codexThreadId: "codex-thread-1",
        provider: "steel",
      },
    });

    expect(next.researcher).toEqual({
      codexThreadIds: ["codex-thread-1"],
      providers: ["steel"],
    });
  });

  it("accumulates provider names from bootstrap payload arrays", () => {
    const next = reduceRuntimeTargetsByRole({}, {
      taskId: "thread-1",
      studioRoleId: "research_analyst",
      type: "stage_done",
      stage: "crawler",
      payload: {
        providers: ["scrapling", "steel"],
      },
    });

    expect(next.researcher).toEqual({
      codexThreadIds: [],
      providers: ["scrapling", "steel"],
    });
  });

  it("clears stored runtime targets after the run finishes", () => {
    const current = {
      researcher: {
        codexThreadIds: ["codex-thread-1"],
        providers: ["steel"],
      },
    };

    expect(reduceRuntimeTargetsByRole(current, {
      taskId: "thread-1",
      studioRoleId: "research_analyst",
      type: "run_done",
    })).toEqual({});
  });
});

describe("shouldIgnoreInterruptedThreadEvent", () => {
  it("drops late runtime events for threads the operator already stopped", () => {
    expect(shouldIgnoreInterruptedThreadEvent({ "thread-1": true }, "thread-1")).toBe(true);
    expect(shouldIgnoreInterruptedThreadEvent({ "thread-1": true }, "thread-2")).toBe(false);
    expect(shouldIgnoreInterruptedThreadEvent({}, "thread-1")).toBe(false);
  });
});

describe("shouldIgnoreInterruptedThreadEvent", () => {
  it("ignores late runtime events once the thread was explicitly interrupted", () => {
    expect(shouldIgnoreInterruptedThreadEvent({ "thread-1": true }, "thread-1")).toBe(true);
    expect(shouldIgnoreInterruptedThreadEvent({ "thread-1": true }, "thread-2")).toBe(false);
    expect(shouldIgnoreInterruptedThreadEvent({}, "")).toBe(false);
  });
});
