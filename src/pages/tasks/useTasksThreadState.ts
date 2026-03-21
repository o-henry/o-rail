import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  blockCoordinationRun,
  completeDelegateTask,
  createCoordinationState,
  createRuntimeLedgerEvent,
  readyCoordinationForExecution,
  startCoordinationRun,
} from "../../features/orchestration/agentic/coordination";
import type {
  AgenticCoordinationState,
  CoordinationMode,
  RuntimeLedgerEvent,
  SessionIndexEntry,
} from "../../features/orchestration/agentic/coordinationTypes";
import {
  appendRuntimeLedger,
  buildRuntimeLedgerPaths,
  serializeCoordinationState,
  serializeRuntimeLedger,
  serializeSessionIndex,
} from "../../features/orchestration/agentic/runtimeLedger";
import type { KnowledgeFileRef } from "../../features/workflow/types";
import type { AgenticAction } from "../../features/orchestration/agentic/actionBus";
import {
  getTaskAgentLabel,
  getTaskAgentPresetIdByStudioRoleId,
  getTaskAgentStudioRoleId,
  getTaskAgentSummary,
  parseCoordinationModeTag,
  parseTaskAgentTags,
  stripCoordinationModeTags,
} from "./taskAgentPresets";
import {
  dispatchTaskExecutionPlan,
  deriveExecutionPlan,
  runBrowserExecutionPlan,
  runRuntimeExecutionPlan,
} from "./taskExecutionRuntime";
import {
  approveCoordinationPlanAction,
  cancelCoordinationAction,
  requestCoordinationFollowupAction,
  resumeCoordinationAction,
  verifyCoordinationReviewAction,
} from "./taskCoordinationActions";
import type {
  ApprovalDecision,
  ApprovalRecord,
  BackgroundAgentRecord,
  ThreadAgentDetail,
  ThreadDetail,
  ThreadDetailTab,
  ThreadListItem,
  ThreadRoleId,
} from "./threadTypes";
import { THREAD_DETAIL_TABS } from "./threadTypes";
import { buildProjectThreadGroups, filterThreadListByProject } from "./threadTree";
import { rememberThreadSelection, resolveThreadSelection } from "./threadSelectionState";
import { deriveThreadWorkflow } from "./threadWorkflow";
import { isLiveBackgroundAgentStatus } from "./liveAgentState";
import { resolveTasksThreadTerminalCwd } from "./taskThreadTerminalState";
import {
  buildTasksSessionIndex,
  deriveComposerCoordinationPreview,
  queryTasksSessionIndex,
  readTasksOrchestrationCache,
  withTaskCoordination,
  writeTasksOrchestrationCache,
  type TasksOrchestrationCache,
} from "./taskOrchestrationState";
import {
  browserDiffContent,
  buildBrowserAgentDetail,
  buildBrowserThread,
  createBrowserMessage,
  defaultSelectedAgent,
  defaultSelectedFile,
  isPlaceholderTitle,
  shouldAutoReplaceTitle,
  truncateTitle,
  withDerivedWorkflow,
} from "./taskThreadBrowserState";
import {
  applyBrowserStoreSnapshot,
  loadThreadState,
  refreshThreadListSilently,
  refreshThreadStateSilently,
  reloadThreadList,
} from "./taskThreadRepository";
import { loadThreadAgentDetail } from "./taskThreadAgentDetail";
import {
  cloneStore,
  loadBrowserStore,
  loadHiddenTasksProjectList,
  persistTasksActiveThreadSnapshot,
  loadTasksProjectList,
  loadTasksProjectPath,
  persistHiddenTasksProjectList,
  persistTasksProjectList,
  persistTasksProjectPath,
  type BrowserStore,
} from "./taskThreadStorageState";
import { buildPromptWithKnowledgeAttachments, findKnowledgeEntryIdByArtifact } from "./taskKnowledgeAttachments";
import { applyCoordinationSettlement, settleRunningCoordinationRun } from "./taskCoordinationLifecycle";
import { buildOptimisticThreadDeleteState } from "./taskThreadOptimisticDelete";
import {
  loadPersistedCoordinationState,
  loadPersistedRuntimeSessionIndex,
  mergeRuntimeSessionIndexes,
  pickNewerCoordinationState,
} from "./taskRuntimeHydration";
import { getDefaultTaskCreationIsolation } from "./taskCreationDefaults";
import { t as translate } from "../../i18n";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type Params = {
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
  publishAction: (action: AgenticAction) => void;
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
    topic?: string;
  }) => void;
  setStatus: (message: string) => void;
};

type LiveProcessEvent = {
  id: string;
  runId: string;
  roleId: ThreadRoleId;
  agentLabel: string;
  type: string;
  stage: string;
  message: string;
  at: string;
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? translate("common.unknownError"));
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

async function writeTextByPath(invokeFn: InvokeFn, path: string, content: string) {
  const normalized = String(path ?? "").trim();
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (slashIndex <= 0) {
    return null;
  }
  return invokeFn<string>("workspace_write_text", {
    cwd: normalized.slice(0, slashIndex),
    name: normalized.slice(slashIndex + 1),
    content,
  });
}

export function useTasksThreadState(params: Params) {
  const initialProjectPath = useMemo(() => loadTasksProjectPath(params.cwd), [params.cwd]);
  const initialProjectList = useMemo(() => loadTasksProjectList(params.cwd), [params.cwd]);
  const initialHiddenProjectList = useMemo(() => loadHiddenTasksProjectList(), []);
  const [threadItems, setThreadItems] = useState<ThreadListItem[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [activeThread, setActiveThread] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [composerDraft, setComposerDraft] = useState("");
  const [model, setModel] = useState("GPT-5.4");
  const [reasoning, setReasoning] = useState("중간");
  const [accessMode] = useState("Local");
  const [detailTab, setDetailTab] = useState<ThreadDetailTab>("files");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedAgentDetail, setSelectedAgentDetail] = useState<ThreadAgentDetail | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedFileDiff, setSelectedFileDiff] = useState("");
  const [selectedAgentIdsByThread, setSelectedAgentIdsByThread] = useState<Record<string, string>>({});
  const [selectedFilePathsByThread, setSelectedFilePathsByThread] = useState<Record<string, string>>({});
  const [attachedFiles, setAttachedFiles] = useState<KnowledgeFileRef[]>([]);
  const [selectedComposerRoleIds, setSelectedComposerRoleIds] = useState<ThreadRoleId[]>([]);
  const [projectPath, setProjectPath] = useState(initialProjectPath);
  const [projectPaths, setProjectPaths] = useState<string[]>(initialProjectList);
  const [hiddenProjectPaths, setHiddenProjectPaths] = useState<string[]>(initialHiddenProjectList);
  const [liveRoleNotes, setLiveRoleNotes] = useState<Partial<Record<ThreadRoleId, { message: string; updatedAt: string }>>>({});
  const [liveProcessEvents, setLiveProcessEvents] = useState<LiveProcessEvent[]>([]);
  const [stoppingComposerRun, setStoppingComposerRun] = useState(false);
  const [composerSubmitPending, setComposerSubmitPending] = useState(false);
  const [composerCoordinationModeOverride, setComposerCoordinationModeOverride] = useState<CoordinationMode | null>(null);
  const [orchestrationByThread, setOrchestrationByThread] = useState<TasksOrchestrationCache>(() => readTasksOrchestrationCache());
  const [persistedRuntimeSessions, setPersistedRuntimeSessions] = useState<SessionIndexEntry[]>([]);
  const browserStoreRef = useRef<BrowserStore>(loadBrowserStore());
  const orchestrationRef = useRef(orchestrationByThread);
  const orchestrationLedgerRef = useRef<Record<string, RuntimeLedgerEvent[]>>({});
  const visibleThreadItems = useMemo(
    () => threadItems.filter((item) => !hiddenProjectPaths.includes(String(item.projectPath || item.thread.cwd || "").trim())),
    [hiddenProjectPaths, threadItems],
  );
  const visibleProjectPaths = useMemo(
    () => projectPaths.filter((path) => !hiddenProjectPaths.includes(String(path ?? "").trim())),
    [hiddenProjectPaths, projectPaths],
  );
  const threads = useMemo(() => filterThreadListByProject(visibleThreadItems, projectPath || params.cwd), [params.cwd, projectPath, visibleThreadItems]);
  const projectGroups = useMemo(
    () => buildProjectThreadGroups(visibleThreadItems, projectPath || params.cwd, visibleProjectPaths, params.cwd),
    [params.cwd, projectPath, visibleProjectPaths, visibleThreadItems],
  );
  const composerCoordinationPreview = useMemo(
    () => deriveComposerCoordinationPreview({
      prompt: composerDraft,
      overrideMode: composerCoordinationModeOverride ?? parseCoordinationModeTag(composerDraft),
      roleIds: selectedComposerRoleIds,
    }),
    [composerCoordinationModeOverride, composerDraft, selectedComposerRoleIds],
  );
  const runtimeSessionIndex = useMemo(
    () => mergeRuntimeSessionIndexes(buildTasksSessionIndex(orchestrationByThread, activeThread ? [activeThread] : []), persistedRuntimeSessions),
    [activeThread, orchestrationByThread, persistedRuntimeSessions],
  );
  const activeThreadCoordination = useMemo(
    () => (activeThread ? orchestrationByThread[activeThread.thread.threadId] ?? activeThread.orchestration ?? null : null),
    [activeThread, orchestrationByThread],
  );

  useEffect(() => {
    orchestrationRef.current = orchestrationByThread;
    writeTasksOrchestrationCache(orchestrationByThread);
  }, [orchestrationByThread]);

  useEffect(() => {
    const snapshot = activeThread
      ? {
          threadId: String(activeThread.thread.threadId ?? "").trim(),
          cwd: resolveTasksThreadTerminalCwd(activeThread),
        }
      : null;
    persistTasksActiveThreadSnapshot(snapshot);
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("rail:tasks-active-thread-changed", {
        detail: snapshot ?? { threadId: "", cwd: "" },
      }),
    );
  }, [
    activeThread?.task.projectPath,
    activeThread?.task.workspacePath,
    activeThread?.task.worktreePath,
    activeThread?.thread.cwd,
    activeThread?.thread.threadId,
  ]);

  useEffect(() => {
    if (!params.hasTauriRuntime || !params.cwd) {
      return;
    }
    let cancelled = false;
    void loadPersistedRuntimeSessionIndex(params.cwd, params.invokeFn)
      .then((entries) => {
        if (!cancelled) {
          setPersistedRuntimeSessions(entries);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params.cwd, params.hasTauriRuntime, params.invokeFn]);

  const hydrateThreadDetail = useCallback((detail: ThreadDetail | null) => {
    if (!detail) {
      return null;
    }
    return withTaskCoordination(withDerivedWorkflow(detail), orchestrationRef.current[detail.thread.threadId] ?? null);
  }, []);

  const hydratePersistedCoordination = useCallback(
    async (threadId: string) => {
      const normalizedThreadId = String(threadId ?? "").trim();
      if (!normalizedThreadId || !params.hasTauriRuntime || !params.cwd) {
        return orchestrationRef.current[normalizedThreadId] ?? null;
      }
      const persisted = await loadPersistedCoordinationState(params.cwd, normalizedThreadId, params.invokeFn);
      const next = pickNewerCoordinationState(orchestrationRef.current[normalizedThreadId] ?? null, persisted);
      if (!next) {
        return null;
      }
      if (next !== orchestrationRef.current[normalizedThreadId]) {
        const nextCache = {
          ...orchestrationRef.current,
          [normalizedThreadId]: next,
        };
        orchestrationRef.current = nextCache;
        setOrchestrationByThread(nextCache);
      }
      return next;
    },
    [params.cwd, params.hasTauriRuntime, params.invokeFn],
  );

  useEffect(() => {
    setActiveThread((current) => (current ? withTaskCoordination(current, orchestrationByThread[current.thread.threadId] ?? null) : current));
  }, [orchestrationByThread]);

  const rememberProjectPath = useCallback((nextPath: string) => {
    const normalized = String(nextPath ?? "").trim();
    if (!normalized) {
      return;
    }
    setHiddenProjectPaths((current) => current.filter((path) => path !== normalized));
    setProjectPaths((current) => (current.includes(normalized) ? current : [...current, normalized]));
  }, []);

  const rememberSelectedAgent = useCallback((threadId: string, agentId: string) => {
    const normalizedAgentId = String(agentId ?? "").trim();
    setSelectedAgentId(normalizedAgentId);
    setSelectedAgentIdsByThread((current) => rememberThreadSelection(current, threadId, normalizedAgentId));
  }, []);

  const rememberSelectedFile = useCallback((threadId: string, filePath: string) => {
    const normalizedFilePath = String(filePath ?? "").trim();
    setSelectedFilePath(normalizedFilePath);
    setSelectedFilePathsByThread((current) => rememberThreadSelection(current, threadId, normalizedFilePath));
  }, []);

  const persistCoordinationArtifacts = useCallback(
    async (threadId: string, cache: TasksOrchestrationCache, event?: RuntimeLedgerEvent) => {
      if (!params.hasTauriRuntime || !params.cwd) {
        return;
      }
      const state = cache[threadId];
      if (!state) {
        return;
      }
      const paths = buildRuntimeLedgerPaths(params.cwd, threadId);
      const nextLedger = event
        ? appendRuntimeLedger(orchestrationLedgerRef.current[threadId] ?? [], event)
        : (orchestrationLedgerRef.current[threadId] ?? []);
      orchestrationLedgerRef.current = {
        ...orchestrationLedgerRef.current,
        [threadId]: nextLedger,
      };
      await Promise.all([
        writeTextByPath(params.invokeFn, paths.statePath, serializeCoordinationState(state)),
        writeTextByPath(params.invokeFn, paths.ledgerPath, serializeRuntimeLedger(nextLedger)),
        writeTextByPath(params.invokeFn, paths.indexPath, serializeSessionIndex(buildTasksSessionIndex(cache, activeThread ? [activeThread] : []))),
      ]);
    },
    [activeThread, params.cwd, params.hasTauriRuntime, params.invokeFn],
  );

  const updateThreadCoordination = useCallback(
    (
      threadId: string,
      updater: (current: AgenticCoordinationState | null) => AgenticCoordinationState | null,
      event?: { kind: RuntimeLedgerEvent["kind"]; summary: string },
    ) => {
      const normalizedThreadId = String(threadId ?? "").trim();
      if (!normalizedThreadId) {
        return null;
      }
      const current = orchestrationRef.current[normalizedThreadId] ?? null;
      const next = updater(current);
      if (!next) {
        return null;
      }
      const nextCache = {
        ...orchestrationRef.current,
        [normalizedThreadId]: next,
      };
      orchestrationRef.current = nextCache;
      setOrchestrationByThread(nextCache);
      if (event) {
        void persistCoordinationArtifacts(
          normalizedThreadId,
          nextCache,
          createRuntimeLedgerEvent({
            threadId: normalizedThreadId,
            kind: event.kind,
            summary: event.summary,
            at: next.updatedAt,
          }),
        );
      } else {
        void persistCoordinationArtifacts(normalizedThreadId, nextCache);
      }
      return next;
    },
    [persistCoordinationArtifacts],
  );

  useEffect(() => {
    setProjectPath((current) => current || initialProjectPath);
  }, [initialProjectPath]);

  useEffect(() => {
    persistTasksProjectPath(projectPath);
  }, [projectPath]);

  useEffect(() => {
    persistTasksProjectList(projectPaths);
  }, [projectPaths]);

  useEffect(() => {
    persistHiddenTasksProjectList(hiddenProjectPaths);
  }, [hiddenProjectPaths]);

  useEffect(() => {
    const discoveredPaths = threadItems
      .map((item) => String(item.projectPath || item.thread.cwd || "").trim())
      .filter(Boolean);
    if (discoveredPaths.length === 0) {
      return;
    }
    setProjectPaths((current) => {
      const next = [...new Set([...current, ...discoveredPaths])];
      return next.length === current.length && next.every((value, index) => value === current[index]) ? current : next;
    });
  }, [threadItems]);

  const removeProject = useCallback((targetProjectPath: string) => {
    const normalized = String(targetProjectPath ?? "").trim();
    if (!normalized) {
      return;
    }
    setHiddenProjectPaths((current) => (current.includes(normalized) ? current : [...current, normalized]));
    setProjectPaths((current) => current.filter((path) => path !== normalized));
    if (projectPath === normalized) {
      const fallbackProject = visibleProjectPaths.find((path) => path !== normalized) || "";
      setProjectPath(fallbackProject);
      setActiveThread(null);
      setActiveThreadId("");
      setSelectedAgentId("");
      setSelectedAgentDetail(null);
      setSelectedFilePath("");
      setSelectedFileDiff("");
    }
  }, [projectPath, visibleProjectPaths]);

  const applyBrowserStore = useCallback(
    (store: BrowserStore, preferredThreadId?: string) => applyBrowserStoreSnapshot({
      store,
      browserStoreRef,
      hydrateThreadDetail,
      preferredThreadId,
      activeThreadId,
      projectPath,
      cwd: params.cwd,
      selectedAgentIdsByThread,
      selectedFilePathsByThread,
      rememberSelectedAgent,
      rememberSelectedFile,
      setActiveThread,
      setActiveThreadId,
      setSelectedAgentId,
      setSelectedAgentDetail,
      setSelectedFilePath,
      setSelectedFileDiff,
      setThreadItems,
    }),
    [activeThreadId, hydrateThreadDetail, params.cwd, projectPath, rememberSelectedAgent, rememberSelectedFile, selectedAgentIdsByThread, selectedFilePathsByThread],
  );

  const loadThread = useCallback(
    async (threadId: string) => loadThreadState({
      threadId,
      hasTauriRuntime: params.hasTauriRuntime,
      cwd: params.cwd,
      projectPath,
      invokeFn: params.invokeFn,
      browserStoreRef,
      applyBrowserStore,
      hydrateThreadDetail,
      hydratePersistedCoordination,
      selectedAgentIdsByThread,
      selectedFilePathsByThread,
      rememberProjectPath,
      rememberSelectedAgent,
      rememberSelectedFile,
      setActiveThread,
      setActiveThreadId,
      setProjectPath,
      setSelectedAgentId,
      setSelectedAgentDetail,
      setSelectedFilePath,
      setSelectedFileDiff,
      onError: (message) => {
        params.setStatus(`THREAD load failed: ${message}`);
        params.appendWorkspaceEvent({
          source: "tasks-thread",
          actor: "system",
          level: "error",
          message: `THREAD load failed: ${message}`,
        });
      },
    }),
    [applyBrowserStore, hydratePersistedCoordination, params, rememberSelectedAgent, rememberSelectedFile, selectedAgentIdsByThread, selectedFilePathsByThread],
  );

  const reloadThreads = useCallback(
    async (preferredThreadId?: string) => reloadThreadList({
      preferredThreadId,
      hasTauriRuntime: params.hasTauriRuntime,
      cwd: params.cwd,
      projectPath,
      invokeFn: params.invokeFn,
      browserStoreRef,
      applyBrowserStore,
      activeThreadId,
      loadThread,
      setActiveThread,
      setActiveThreadId,
      setLoading,
      setSelectedAgentId,
      setSelectedAgentDetail,
      setSelectedFilePath,
      setSelectedFileDiff,
      setThreadItems,
      onError: (message) => params.setStatus(`Failed to load threads: ${message}`),
    }),
    [activeThreadId, applyBrowserStore, loadThread, params, projectPath],
  );

  const refreshCurrentThreadSilently = useCallback(
    async (threadId: string) => refreshThreadStateSilently({
      threadId,
      hasTauriRuntime: params.hasTauriRuntime,
      cwd: params.cwd,
      projectPath,
      invokeFn: params.invokeFn,
      hydratePersistedCoordination,
      selectedAgentIdsByThread,
      selectedFilePathsByThread,
      rememberSelectedAgent,
      rememberSelectedFile,
      setActiveThread,
      setActiveThreadId,
      setThreadItems,
    }),
    [hydratePersistedCoordination, params, projectPath, rememberSelectedAgent, rememberSelectedFile, selectedAgentIdsByThread, selectedFilePathsByThread],
  );

  const refreshThreadListMetadataSilently = useCallback(
    async () => refreshThreadListSilently({
      hasTauriRuntime: params.hasTauriRuntime,
      cwd: params.cwd,
      projectPath,
      invokeFn: params.invokeFn,
      setThreadItems,
    }),
    [params, projectPath],
  );

  const loadAgentDetail = useCallback(
    async (threadId: string, agentId: string): Promise<ThreadAgentDetail | null> => loadThreadAgentDetail({
      threadId,
      agentId,
      hasTauriRuntime: params.hasTauriRuntime,
      cwd: params.cwd,
      invokeFn: params.invokeFn,
    }),
    [params.cwd, params.hasTauriRuntime, params.invokeFn],
  );

  useEffect(() => {
    void reloadThreads();
  }, [reloadThreads]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      void reloadThreads(detail?.threadId);
    };
    window.addEventListener("rail:thread-updated", handler as EventListener);
    return () => window.removeEventListener("rail:thread-updated", handler as EventListener);
  }, [reloadThreads]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        taskId?: string;
        runId?: string;
        studioRoleId?: string;
        type?: string;
        stage?: string | null;
        message?: string;
        at?: string;
      }>).detail;
      if (!detail || String(detail.taskId ?? "").trim() !== String(activeThreadId ?? "").trim()) {
        return;
      }
      const roleId = getTaskAgentPresetIdByStudioRoleId(detail.studioRoleId);
      if (!roleId) {
        return;
      }
      const eventType = String(detail.type ?? "").trim();
      if (eventType === "run_done" || eventType === "run_error") {
        setLiveRoleNotes((current) => {
          const next = { ...current };
          delete next[roleId];
          return next;
        });
      }
      const stageLabel = String(detail.stage ?? "").trim();
      const message = String(detail.message ?? "").trim() || (stageLabel ? `${stageLabel} 진행 중` : "작업 중");
      const eventId = [
        String(detail.runId ?? "").trim(),
        roleId,
        eventType,
        stageLabel,
        message,
      ].filter(Boolean).join(":");
      setLiveProcessEvents((current) => {
        if (eventId && current.some((entry) => entry.id === eventId)) {
          return current;
        }
        return [
          ...current,
          {
            id: eventId || nextId("process"),
            runId: String(detail.runId ?? "").trim(),
            roleId,
            agentLabel: getTaskAgentLabel(roleId),
            type: eventType,
            stage: stageLabel,
            message,
            at: String(detail.at ?? "").trim() || nowIso(),
          },
        ].slice(-24);
      });
      if (eventType === "run_done" || eventType === "run_error") {
        void refreshCurrentThreadSilently(activeThreadId);
        return;
      }
      setLiveRoleNotes((current) => ({
        ...current,
        [roleId]: {
          message,
          updatedAt: String(detail.at ?? "").trim() || nowIso(),
        },
      }));
    };
    window.addEventListener("rail:tasks-role-event", handler as EventListener);
    return () => window.removeEventListener("rail:tasks-role-event", handler as EventListener);
  }, [activeThreadId, refreshCurrentThreadSilently]);

  useEffect(() => {
    setLiveProcessEvents([]);
  }, [activeThreadId]);

  useEffect(() => {
    const liveRoleIds = new Set((activeThread?.agents ?? []).filter((agent) => isLiveBackgroundAgentStatus(agent.status)).map((agent) => agent.roleId));
    setLiveRoleNotes((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([roleId]) => liveRoleIds.has(roleId as ThreadRoleId)),
      ) as Partial<Record<ThreadRoleId, { message: string; updatedAt: string }>>;
      const unchanged = Object.keys(next).length === Object.keys(current).length
        && Object.keys(next).every((key) => next[key as ThreadRoleId]?.message === current[key as ThreadRoleId]?.message);
      return unchanged ? current : next;
    });
  }, [activeThread?.agents]);

  const canInterruptCurrentThread = useMemo(
    () => {
      if (!activeThread) {
        return false;
      }
      if (activeThreadCoordination?.status === "needs_resume" || activeThreadCoordination?.status === "cancelled") {
        return false;
      }
      return activeThread.agents.some((agent) => isLiveBackgroundAgentStatus(agent.status));
    },
    [activeThread, activeThreadCoordination?.status],
  );

  useEffect(() => {
    if (canInterruptCurrentThread || stoppingComposerRun) {
      setComposerSubmitPending(false);
    }
  }, [canInterruptCurrentThread, stoppingComposerRun]);

  useEffect(() => {
    if (!activeThread || !activeThreadCoordination || activeThreadCoordination.status !== "running") {
      return;
    }
    const settlement = settleRunningCoordinationRun(activeThread, activeThreadCoordination);
    if (settlement.kind === "pending") {
      return;
    }
    const nextCoordination = updateThreadCoordination(
      activeThread.thread.threadId,
      (current) => {
        if (!current) {
          return current;
        }
        return applyCoordinationSettlement(current, settlement);
      },
      {
        kind: settlement.kind === "completed" ? "run_completed" : "run_blocked",
        summary: settlement.summary,
      },
    );
    if (!nextCoordination) {
      return;
    }
    setActiveThread((current) => {
      if (!current || current.thread.threadId !== activeThread.thread.threadId) {
        return current;
      }
        return withTaskCoordination(
          {
            ...current,
            thread: {
              ...current.thread,
              status: settlement.kind === "completed" ? "completed" : nextCoordination.status,
              updatedAt: nextCoordination.updatedAt,
            },
          },
        nextCoordination,
      );
    });
  }, [activeThread, activeThreadCoordination, updateThreadCoordination]);

  useEffect(() => {
    const hasLiveAgents = (activeThread?.agents ?? []).some((agent) => isLiveBackgroundAgentStatus(agent.status));
    if (
      !hasLiveAgents
      || activeThreadCoordination?.status !== "running"
      || !activeThreadId
      || !params.hasTauriRuntime
      || !params.cwd
    ) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshCurrentThreadSilently(activeThreadId);
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [activeThread?.agents, activeThreadCoordination?.status, activeThreadId, params, refreshCurrentThreadSilently]);

  useEffect(() => {
    if (!activeThread || !selectedAgentId) {
      setSelectedAgentDetail(null);
      return;
    }
    if (!params.hasTauriRuntime || !params.cwd) {
      const agent = activeThread.agents.find((entry) => entry.id === selectedAgentId) ?? null;
      setSelectedAgentDetail(agent ? buildBrowserAgentDetail(activeThread, agent) : null);
      return;
    }
    void loadAgentDetail(activeThread.thread.threadId, selectedAgentId)
      .then(setSelectedAgentDetail)
      .catch((error) => {
        setSelectedAgentDetail(null);
        params.setStatus(`Failed to load agent detail: ${formatError(error)}`);
      });
  }, [activeThread, loadAgentDetail, params, selectedAgentId]);

  useEffect(() => {
    if (!activeThread || !selectedFilePath) {
      setSelectedFileDiff("");
      return;
    }
    if (!params.hasTauriRuntime || !params.cwd) {
      setSelectedFileDiff(browserDiffContent(selectedFilePath));
      return;
    }
    void params
      .invokeFn<string>("thread_file_diff", {
        cwd: params.cwd,
        threadId: activeThread.thread.threadId,
        relativePath: selectedFilePath,
      })
      .then(setSelectedFileDiff)
      .catch(() => setSelectedFileDiff(""));
  }, [activeThread, params, selectedFilePath]);

  const pendingApprovals = useMemo(() => activeThread?.approvals.filter((approval) => approval.status === "pending") ?? [], [activeThread]);

  const openAttachmentPicker = useCallback(async () => {
    if (!params.hasTauriRuntime || !params.cwd) {
      params.setStatus("Tasks file attachments are available in the desktop runtime only.");
      return;
    }
    try {
      const paths = await params.invokeFn<string[]>("dialog_pick_knowledge_files");
      if (!paths.length) {
        return;
      }
      const probed = await params.invokeFn<KnowledgeFileRef[]>("knowledge_probe", { paths });
      setAttachedFiles((current) => {
        const seen = new Set(current.map((file) => file.path));
        const next = [...current];
        for (const file of probed) {
          if (!seen.has(file.path)) {
            seen.add(file.path);
            next.push(file);
          }
        }
        return next;
      });
    } catch (error) {
      params.setStatus(`Failed to attach files: ${formatError(error)}`);
    }
  }, [params]);

  const removeAttachedFile = useCallback((fileId: string) => {
    setAttachedFiles((current) => current.filter((file) => file.id !== fileId));
  }, []);

  const clearAttachedFiles = useCallback(() => {
    setAttachedFiles([]);
  }, []);

  const openProjectDirectory = useCallback(async () => {
    if (!params.hasTauriRuntime) {
      params.setStatus("Project selection is available in the desktop runtime only.");
      return;
    }
    try {
      const selected = await params.invokeFn<string | null>("dialog_pick_directory");
      const selectedPath = String(selected ?? "").trim();
      if (!selectedPath) {
        return;
      }
      setActiveThread(null);
      setActiveThreadId("");
      setSelectedAgentId("");
      setSelectedAgentDetail(null);
      setSelectedFilePath("");
      setSelectedFileDiff("");
      rememberProjectPath(selectedPath);
      setProjectPath(selectedPath);
      params.setStatus(`Tasks project selected: ${selectedPath}`);
    } catch (error) {
      params.setStatus(`Failed to open project: ${formatError(error)}`);
    }
  }, [params, rememberProjectPath]);

  const selectProject = useCallback((nextProjectPath: string) => {
    const normalized = String(nextProjectPath ?? "").trim();
    if (!normalized || normalized === projectPath) {
      return;
    }
    rememberProjectPath(normalized);
    setActiveThread(null);
    setActiveThreadId("");
    setSelectedAgentId("");
    setSelectedAgentDetail(null);
    setSelectedFilePath("");
    setSelectedFileDiff("");
    setSelectedComposerRoleIds([]);
    setProjectPath(normalized);
  }, [projectPath, rememberProjectPath]);

  const openKnowledgeEntryForArtifact = useCallback((artifactPath: string) => {
    const entryId = findKnowledgeEntryIdByArtifact(artifactPath);
    if (!entryId) {
      params.setStatus("데이터베이스에서 연결된 문서를 찾지 못했습니다.");
      return;
    }
    params.publishAction({
      type: "open_knowledge_doc",
      payload: {
        entryId,
      },
    });
  }, [params]);

  const buildPromptWithAttachments = useCallback(async (prompt: string) => {
    try {
      return await buildPromptWithKnowledgeAttachments({
        attachedFiles,
        prompt,
        cwd: params.cwd,
        hasTauriRuntime: params.hasTauriRuntime,
        invokeFn: params.invokeFn,
      });
    } catch (error) {
      params.setStatus(`Failed to read attached files: ${formatError(error)}`);
      return String(prompt ?? "").trim();
    }
  }, [attachedFiles, params]);

  const openNewThread = useCallback(async () => {
    setComposerDraft("");
    setSelectedComposerRoleIds([]);
    setComposerCoordinationModeOverride(null);
    clearAttachedFiles();
    setSelectedAgentId("");
    setSelectedAgentDetail(null);
    setSelectedFilePath("");
    setSelectedFileDiff("");
    setDetailTab("files");
    const selectedProjectPath = String(projectPath || params.cwd || "/workspace").trim();
    if (!params.hasTauriRuntime || !params.cwd) {
      const store = cloneStore(browserStoreRef.current);
      const detail = buildBrowserThread(params.cwd || "/workspace", selectedProjectPath, "", model, reasoning, accessMode);
      store.details[detail.thread.threadId] = detail;
      store.order = [detail.thread.threadId, ...store.order.filter((id) => id !== detail.thread.threadId)];
      applyBrowserStore(store, detail.thread.threadId);
      params.setStatus(`${translate("tasks.thread.new")}: ${detail.thread.title}`);
      return;
    }
    try {
      const detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_create", {
        cwd: params.cwd,
        projectPath: selectedProjectPath,
        prompt: translate("tasks.thread.new"),
        mode: "balanced",
        team: "full-squad",
        isolation: getDefaultTaskCreationIsolation(),
        model,
        reasoning,
        accessMode,
      }));
      setActiveThread(detail);
      setActiveThreadId(detail.thread.threadId);
      rememberSelectedAgent(detail.thread.threadId, defaultSelectedAgent(detail));
      rememberSelectedFile(detail.thread.threadId, defaultSelectedFile(detail));
      await reloadThreads(detail.thread.threadId);
      params.setStatus(`${translate("tasks.thread.new")}: ${truncateTitle(detail.thread.title)}`);
    } catch (error) {
      setActiveThread(null);
      setActiveThreadId("");
      params.setStatus(`${translate("tasks.stage.failed")}: ${formatError(error)}`);
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "system",
        level: "error",
        message: `Thread create failed: ${formatError(error)}`,
      });
    }
  }, [accessMode, applyBrowserStore, clearAttachedFiles, model, params, projectPath, reasoning, reloadThreads]);

  const selectThread = useCallback(async (threadId: string) => {
    setSelectedAgentId("");
    setSelectedFilePath("");
    setSelectedComposerRoleIds([]);
    await loadThread(threadId);
  }, [loadThread]);

  const addComposerRole = useCallback((roleId: ThreadRoleId) => {
    setSelectedComposerRoleIds((current) => (current.includes(roleId) ? current : [...current, roleId]));
  }, []);

  const removeComposerRole = useCallback((roleId: ThreadRoleId) => {
    setSelectedComposerRoleIds((current) => current.filter((entry) => entry !== roleId));
  }, []);

  const syncSpawnedThreadSelection = useCallback(async (detail: ThreadDetail) => {
    setActiveThread(detail);
    setActiveThreadId(detail.thread.threadId);
    rememberSelectedAgent(
      detail.thread.threadId,
      resolveThreadSelection(
        selectedAgentIdsByThread,
        detail.thread.threadId,
        detail.agents.map((agent) => agent.id),
        defaultSelectedAgent(detail),
      ),
    );
    rememberSelectedFile(
      detail.thread.threadId,
      resolveThreadSelection(
        selectedFilePathsByThread,
        detail.thread.threadId,
        detail.files.map((file) => file.path),
        defaultSelectedFile(detail),
      ),
    );
    await reloadThreads(detail.thread.threadId);
  }, [reloadThreads, rememberSelectedAgent, rememberSelectedFile, selectedAgentIdsByThread, selectedFilePathsByThread]);

  const submitComposer = useCallback(async () => {
    const rawPrompt = composerDraft.trim();
    if (!rawPrompt) {
      return;
    }
    const modeTagOverride = composerCoordinationModeOverride ?? parseCoordinationModeTag(rawPrompt);
    const prompt = stripCoordinationModeTags(rawPrompt);
    if (!prompt) {
      return;
    }
    setComposerSubmitPending(true);
    const selectedProjectPath = String(projectPath || params.cwd || "/workspace").trim();
    try {
      const promptWithAttachments = await buildPromptWithAttachments(prompt);
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        const existingDetail = activeThread ? store.details[activeThread.thread.threadId] : undefined;
        const detail: ThreadDetail = existingDetail
          ?? buildBrowserThread(params.cwd || "/workspace", selectedProjectPath, prompt, model, reasoning, accessMode);
        if (!existingDetail) {
          store.details[detail.thread.threadId] = detail;
          store.order = [detail.thread.threadId, ...store.order.filter((id) => id !== detail.thread.threadId)];
        }
        const timestamp = nowIso();
        detail.thread.title = shouldAutoReplaceTitle(detail.thread.title, detail.thread.userPrompt)
          ? truncateTitle(prompt)
          : detail.thread.title;
        detail.thread.userPrompt = detail.thread.userPrompt || prompt;
        detail.thread.status = "running";
        detail.thread.updatedAt = timestamp;
        detail.thread.model = model;
        detail.thread.reasoning = reasoning;
        detail.thread.accessMode = accessMode;
        detail.task.goal = isPlaceholderTitle(detail.task.goal) ? prompt : detail.task.goal;
        detail.task.updatedAt = timestamp;
        detail.messages.push(
          createBrowserMessage(detail.thread.threadId, "user", prompt, timestamp, {
            eventKind: "user_prompt",
          }),
        );
        const taggedRoles = [...new Set([...selectedComposerRoleIds, ...parseTaskAgentTags(prompt)])];
        const executionPlan = deriveExecutionPlan({
          enabledRoleIds: detail.agents.map((agent) => agent.roleId),
          requestedRoleIds: taggedRoles,
          prompt,
          selectedMode: modeTagOverride ?? undefined,
        });
        const coordination = createCoordinationState({
          threadId: detail.thread.threadId,
          prompt: promptWithAttachments,
          requestedRoleIds: executionPlan.participantRoleIds,
          overrideMode: modeTagOverride,
          at: timestamp,
        });
        const executableCoordination = readyCoordinationForExecution(coordination, timestamp);
        detail.artifacts = {
          ...detail.artifacts,
          brief: prompt,
          plan: executableCoordination.plan?.summary || detail.artifacts.plan,
        };
        detail.orchestration = updateThreadCoordination(
          detail.thread.threadId,
          () => executableCoordination,
          { kind: "plan_ready", summary: `Prepared ${coordination.mode} plan` },
        ) ?? executableCoordination;
        const runningCoordination = updateThreadCoordination(
          detail.thread.threadId,
          () => startCoordinationRun(executableCoordination, timestamp),
          { kind: "run_started", summary: `Started ${coordination.mode} run` },
        ) ?? executableCoordination;
        runBrowserExecutionPlan({
          detail,
          prompt: promptWithAttachments,
          plan: executionPlan,
          timestamp,
          createId: nextId,
        });
        if (coordination.mode === "fanout") {
          runningCoordination.delegateTasks.forEach((task) => {
            updateThreadCoordination(detail.thread.threadId, (current) => (
              current
                ? completeDelegateTask(current, {
                    taskId: task.id,
                    summary: `${task.title} ready`,
                    at: timestamp,
                  })
                : current
            ));
          });
        }
        detail.orchestration = runningCoordination;
        store.details[detail.thread.threadId] = withTaskCoordination(detail, detail.orchestration);
        applyBrowserStore(store, detail.thread.threadId);
        rememberSelectedAgent(detail.thread.threadId, `${detail.thread.threadId}:${executionPlan.participantRoleIds[0]}`);
        rememberSelectedFile(detail.thread.threadId, detail.changedFiles[0] ?? defaultSelectedFile(detail));
        setComposerDraft("");
        setSelectedComposerRoleIds([]);
        setComposerCoordinationModeOverride(null);
        clearAttachedFiles();
        params.appendWorkspaceEvent({
          source: "tasks-thread",
          actor: "user",
          level: "info",
          message: `Thread ${detail.thread.threadId} · ${executionPlan.participantRoleIds.map((roleId) => getTaskAgentLabel(roleId)).join(", ")} dispatched${executionPlan.cappedParticipantCount ? " (participant cap applied)" : ""}`,
        });
        params.setStatus(`Thread updated: ${truncateTitle(detail.thread.title)}`);
        return;
      }

      let detail = activeThread;
      if (!detail) {
        detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_create", {
          cwd: params.cwd,
          projectPath: selectedProjectPath,
          prompt: promptWithAttachments,
          mode: "balanced",
          team: "full-squad",
          isolation: getDefaultTaskCreationIsolation(),
          model,
          reasoning,
          accessMode,
        }));
        setActiveThread(detail);
        setActiveThreadId(detail.thread.threadId);
        await reloadThreads(detail.thread.threadId);
      } else {
        detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_append_message", {
          cwd: params.cwd,
          threadId: detail.thread.threadId,
          role: "user",
          content: prompt,
        }));
        setActiveThread(detail);
      }

      const taggedRoles = [...new Set([...selectedComposerRoleIds, ...parseTaskAgentTags(prompt)])];
      const executionPlan = deriveExecutionPlan({
        enabledRoleIds: detail.agents.map((agent) => agent.roleId),
        requestedRoleIds: taggedRoles,
        prompt,
        selectedMode: modeTagOverride ?? undefined,
      });
      const coordination = createCoordinationState({
        threadId: detail.thread.threadId,
        prompt: promptWithAttachments,
        requestedRoleIds: executionPlan.participantRoleIds,
        overrideMode: modeTagOverride,
        at: nowIso(),
      });
      const executableCoordination = readyCoordinationForExecution(coordination);
      updateThreadCoordination(
        detail.thread.threadId,
        () => executableCoordination,
        { kind: "plan_ready", summary: `Prepared ${coordination.mode} plan` },
      );
      const rolesToRun = executionPlan.participantRoleIds;
      if (rolesToRun.length === 0) {
        setActiveThread(detail);
        await reloadThreads(detail.thread.threadId);
        params.setStatus("No task agents selected. Add an agent or use @researcher, @designer, @architect, @implementer, @playtest, and related tags.");
        return;
      }
      const runningCoordination = updateThreadCoordination(
        detail.thread.threadId,
        () => startCoordinationRun(executableCoordination),
        { kind: "run_started", summary: `Started ${coordination.mode} run` },
      ) ?? executableCoordination;
      const spawned = await runRuntimeExecutionPlan({
        detail,
        prompt: promptWithAttachments,
        plan: executionPlan,
        cwd: params.cwd,
        invokeFn: params.invokeFn,
        hydrateThreadDetail,
        publishAction: params.publishAction,
      });
      await syncSpawnedThreadSelection(spawned);
      setActiveThread((current) => (
        current && current.thread.threadId === spawned.thread.threadId
          ? withTaskCoordination(current, runningCoordination)
          : withTaskCoordination(spawned, runningCoordination)
      ));
      if (coordination.mode === "fanout") {
        runningCoordination.delegateTasks.forEach((task) => {
          updateThreadCoordination(spawned.thread.threadId, (current) => (
            current
              ? completeDelegateTask(current, {
                  taskId: task.id,
                  summary: `${task.title} queued`,
                })
              : current
          ));
        });
      }
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "user",
        level: "info",
        message: `Thread ${spawned.thread.threadId} · ${rolesToRun.map((roleId) => getTaskAgentLabel(roleId)).join(", ")} dispatched${executionPlan.cappedParticipantCount ? " (participant cap applied)" : ""}`,
      });
      params.setStatus(`Thread updated: ${truncateTitle(spawned.thread.title)}`);
      setComposerDraft("");
      setSelectedComposerRoleIds([]);
      setComposerCoordinationModeOverride(null);
      clearAttachedFiles();
    } catch (error) {
      params.setStatus(`Thread submit failed: ${formatError(error)}`);
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "system",
        level: "error",
        message: `Thread submit failed: ${formatError(error)}`,
      });
    } finally {
      setComposerSubmitPending(false);
    }
  }, [accessMode, activeThread, applyBrowserStore, buildPromptWithAttachments, clearAttachedFiles, composerCoordinationModeOverride, composerDraft, hydrateThreadDetail, model, params, projectPath, reasoning, selectedComposerRoleIds, syncSpawnedThreadSelection, updateThreadCoordination]);

  const stopComposerRun = useCallback(async () => {
    if (!activeThread || stoppingComposerRun || !canInterruptCurrentThread) {
      return;
    }
    const runningAgents = activeThread.agents.filter((agent) => isLiveBackgroundAgentStatus(agent.status));
    if (runningAgents.length === 0) {
      return;
    }

    setStoppingComposerRun(true);
    const timestamp = nowIso();
    const runningRoleIds = new Set(runningAgents.map((agent) => agent.roleId));
    try {
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        const detail = store.details[activeThread.thread.threadId];
        if (!detail) {
          return;
        }
        detail.thread.status = "idle";
        detail.thread.updatedAt = timestamp;
        detail.agents = detail.agents.map((agent) => (
          runningAgents.some((entry) => entry.id === agent.id)
            ? { ...agent, status: "idle", lastUpdatedAt: timestamp }
            : agent
        ));
        detail.messages.push(
          createBrowserMessage(
            detail.thread.threadId,
            "system",
            "사용자가 현재 작업을 중단했습니다.",
            timestamp,
            { eventKind: "run_interrupted" },
          ),
        );
        detail.workflow = deriveThreadWorkflow(detail);
        detail.orchestration = updateThreadCoordination(
          detail.thread.threadId,
          (current) => (
            current
              ? blockCoordinationRun(current, {
                  reason: "Interrupted by operator.",
                  nextAction: "Resume the run when you are ready.",
                  at: timestamp,
                })
              : current
          ),
          { kind: "run_blocked", summary: "Run interrupted by operator" },
        ) ?? detail.orchestration ?? null;
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        setLiveRoleNotes((current) => Object.fromEntries(
          Object.entries(current).filter(([roleId]) => !runningRoleIds.has(roleId as ThreadRoleId)),
        ) as Partial<Record<ThreadRoleId, { message: string; updatedAt: string }>>);
        setLiveProcessEvents((current) => current.filter((event) => !runningRoleIds.has(event.roleId)));
        params.setStatus("현재 작업을 중단했습니다.");
        return;
      }

      const agentDetails = await Promise.all(
        runningAgents.map((agent) => loadAgentDetail(activeThread.thread.threadId, agent.id).catch(() => null)),
      );
      const codexThreadIds = [...new Set(
        agentDetails
          .map((detail) => String(detail?.codexThreadId ?? "").trim())
          .filter(Boolean),
      )];

      if (codexThreadIds.length === 0) {
        params.setStatus("중단할 실행 세션을 찾지 못했습니다.");
        return;
      }

      await Promise.all(codexThreadIds.map((threadId) => params.invokeFn("turn_interrupt", { threadId })));
      const interruptedCoordination = updateThreadCoordination(
        activeThread.thread.threadId,
        (current) => (
          current
            ? blockCoordinationRun(current, {
                reason: "Interrupted by operator.",
                nextAction: "Resume the run when you are ready.",
                at: timestamp,
              })
            : current
        ),
        { kind: "run_blocked", summary: "Run interrupted by operator" },
      );
      setActiveThread((current) => (
        current && current.thread.threadId === activeThread.thread.threadId
          ? withTaskCoordination({
            ...current,
            thread: {
              ...current.thread,
              status: "idle",
              updatedAt: timestamp,
            },
            agents: current.agents.map((agent) => (
              runningAgents.some((entry) => entry.id === agent.id)
                ? { ...agent, status: "idle", lastUpdatedAt: timestamp, summary: "중단되었습니다." }
                : agent
            )),
            messages: [
              ...current.messages,
              createBrowserMessage(
                current.thread.threadId,
                "system",
                "사용자가 현재 작업을 중단했습니다.",
                timestamp,
                { eventKind: "run_interrupted" },
              ),
            ],
          }, interruptedCoordination ?? current.orchestration ?? null)
          : current
      ));
      setLiveRoleNotes((current) => Object.fromEntries(
        Object.entries(current).filter(([roleId]) => !runningRoleIds.has(roleId as ThreadRoleId)),
      ) as Partial<Record<ThreadRoleId, { message: string; updatedAt: string }>>);
      setLiveProcessEvents((current) => current.filter((event) => !runningRoleIds.has(event.roleId)));
      await refreshCurrentThreadSilently(activeThread.thread.threadId);
      setActiveThread((current) => (
        current && current.thread.threadId === activeThread.thread.threadId
          ? withTaskCoordination({
            ...current,
            thread: {
              ...current.thread,
              status: "idle",
              updatedAt: timestamp,
            },
            agents: current.agents.map((agent) => (
              runningAgents.some((entry) => entry.id === agent.id)
                ? { ...agent, status: "idle", lastUpdatedAt: timestamp, summary: "중단되었습니다." }
                : agent
            )),
          }, interruptedCoordination ?? current.orchestration ?? null)
          : current
      ));
      if (selectedAgentDetail?.agent.id) {
        const refreshedDetail = await loadAgentDetail(activeThread.thread.threadId, selectedAgentDetail.agent.id).catch(() => null);
        setSelectedAgentDetail(refreshedDetail);
      }
      params.setStatus("현재 작업을 중단했습니다.");
    } catch (error) {
      params.setStatus(`작업 중단 실패: ${formatError(error)}`);
    } finally {
      setStoppingComposerRun(false);
    }
  }, [
    activeThread,
    applyBrowserStore,
    canInterruptCurrentThread,
    loadAgentDetail,
    params,
    refreshCurrentThreadSilently,
    selectedAgentDetail?.agent.id,
    stoppingComposerRun,
  ]);

  const approveActiveCoordinationPlan = useCallback(
    async () => {
      if (!activeThread || !activeThreadCoordination) {
        return;
      }
      await approveCoordinationPlanAction({
        activeThread,
        activeThreadCoordination,
        applyBrowserStore,
        browserStoreRef,
        createId: nextId,
        cwd: params.cwd,
        hasTauriRuntime: params.hasTauriRuntime,
        hydrateThreadDetail,
        invokeFn: params.invokeFn,
        publishAction: params.publishAction,
        setActiveThread,
        setStatus: params.setStatus,
        syncSpawnedThreadSelection,
        timestampFactory: nowIso,
        updateThreadCoordination,
      });
    },
    [activeThread, activeThreadCoordination, applyBrowserStore, browserStoreRef, hydrateThreadDetail, params, syncSpawnedThreadSelection, updateThreadCoordination],
  );

  const cancelActiveCoordination = useCallback(() => {
    if (!activeThread || !activeThreadCoordination) {
      return;
    }
    cancelCoordinationAction({
      activeThread,
      activeThreadCoordination,
      applyBrowserStore,
      browserStoreRef,
      createId: nextId,
      cwd: params.cwd,
      hasTauriRuntime: params.hasTauriRuntime,
      hydrateThreadDetail,
      invokeFn: params.invokeFn,
      publishAction: params.publishAction,
      setActiveThread,
      setStatus: params.setStatus,
      syncSpawnedThreadSelection,
      timestampFactory: nowIso,
      updateThreadCoordination,
    });
  }, [activeThread, activeThreadCoordination, applyBrowserStore, browserStoreRef, hydrateThreadDetail, params, syncSpawnedThreadSelection, updateThreadCoordination]);

  const resumeActiveCoordination = useCallback(
    async () => {
      if (!activeThread || !activeThreadCoordination?.resumePointer) {
        return;
      }
      await resumeCoordinationAction({
        activeThread,
        activeThreadCoordination,
        applyBrowserStore,
        browserStoreRef,
        createId: nextId,
        cwd: params.cwd,
        hasTauriRuntime: params.hasTauriRuntime,
        hydrateThreadDetail,
        invokeFn: params.invokeFn,
        publishAction: params.publishAction,
        setActiveThread,
        setStatus: params.setStatus,
        syncSpawnedThreadSelection,
        timestampFactory: nowIso,
        updateThreadCoordination,
      });
    },
    [activeThread, activeThreadCoordination?.resumePointer, applyBrowserStore, browserStoreRef, hydrateThreadDetail, params, syncSpawnedThreadSelection, updateThreadCoordination],
  );

  const verifyActiveCoordinationReview = useCallback(() => {
    if (!activeThread || !activeThreadCoordination || activeThreadCoordination.status !== "waiting_review") {
      return;
    }
    verifyCoordinationReviewAction({
      activeThread,
      activeThreadCoordination,
      applyBrowserStore,
      browserStoreRef,
      createId: nextId,
      cwd: params.cwd,
      hasTauriRuntime: params.hasTauriRuntime,
      hydrateThreadDetail,
      invokeFn: params.invokeFn,
      publishAction: params.publishAction,
      setActiveThread,
      setStatus: params.setStatus,
      syncSpawnedThreadSelection,
      timestampFactory: nowIso,
      updateThreadCoordination,
    });
  }, [activeThread, activeThreadCoordination, applyBrowserStore, browserStoreRef, hydrateThreadDetail, params, syncSpawnedThreadSelection, updateThreadCoordination]);

  const requestCoordinationFollowup = useCallback(() => {
    if (!activeThread || !activeThreadCoordination || activeThreadCoordination.status !== "waiting_review") {
      return;
    }
    requestCoordinationFollowupAction({
      activeThread,
      activeThreadCoordination,
      applyBrowserStore,
      browserStoreRef,
      createId: nextId,
      cwd: params.cwd,
      hasTauriRuntime: params.hasTauriRuntime,
      hydrateThreadDetail,
      invokeFn: params.invokeFn,
      publishAction: params.publishAction,
      setActiveThread,
      setStatus: params.setStatus,
      syncSpawnedThreadSelection,
      timestampFactory: nowIso,
      updateThreadCoordination,
    });
  }, [activeThread, activeThreadCoordination, applyBrowserStore, browserStoreRef, hydrateThreadDetail, params, syncSpawnedThreadSelection, updateThreadCoordination]);

  const openAgent = useCallback(
    async (agent: BackgroundAgentRecord) => {
      rememberSelectedAgent(activeThread?.thread.threadId || activeThreadId, agent.id);
      setDetailTab("agent");
      if (!activeThread) return;
      if (!params.hasTauriRuntime || !params.cwd) {
        setSelectedAgentDetail(buildBrowserAgentDetail(activeThread, agent));
        return;
      }
      try {
        const detail = await loadAgentDetail(activeThread.thread.threadId, agent.id);
        setSelectedAgentDetail(detail);
      } catch (error) {
        params.setStatus(`Failed to open agent: ${formatError(error)}`);
      }
    },
    [activeThread, activeThreadId, loadAgentDetail, params, rememberSelectedAgent],
  );

  const compactSelectedAgentCodexThread = useCallback(async () => {
    if (!activeThread || !selectedAgentDetail?.codexThreadId || !params.hasTauriRuntime || !params.cwd) {
      params.setStatus("압축할 Codex 세션이 없습니다.");
      return;
    }
    try {
      await params.invokeFn("codex_thread_compact_start", {
        threadId: selectedAgentDetail.codexThreadId,
      });
      const refreshedDetail = await loadAgentDetail(activeThread.thread.threadId, selectedAgentDetail.agent.id);
      if (refreshedDetail) {
        setSelectedAgentDetail(refreshedDetail);
      }
      void refreshCurrentThreadSilently(activeThread.thread.threadId);
      params.setStatus(`Codex 세션을 압축했습니다: ${selectedAgentDetail.agent.label}`);
    } catch (error) {
      params.setStatus(`Codex 세션 압축 실패: ${formatError(error)}`);
    }
  }, [activeThread, loadAgentDetail, params, refreshCurrentThreadSilently, selectedAgentDetail]);

  const resolveApproval = useCallback(
    async (approval: ApprovalRecord, decision: ApprovalDecision) => {
      if (!activeThread) return;
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        const detail = store.details[activeThread.thread.threadId];
        if (!detail) return;
        const timestamp = nowIso();
        detail.approvals = detail.approvals.map((entry) =>
          entry.id === approval.id ? { ...entry, status: decision, updatedAt: timestamp } : entry,
        );
        if (decision === "approved") {
          const targetRole = String(approval.payload?.targetRole ?? "").trim() as ThreadRoleId;
          detail.agents = detail.agents.map((agent) =>
            agent.roleId === targetRole ? { ...agent, status: "thinking", lastUpdatedAt: timestamp } : agent,
          );
          detail.messages.push(
            createBrowserMessage(
              detail.thread.threadId,
              "assistant",
              `Approval granted. ${getTaskAgentLabel(targetRole)} is continuing the work.`,
              timestamp,
              {
                agentId: `${detail.thread.threadId}:${targetRole}`,
                agentLabel: getTaskAgentLabel(targetRole),
                sourceRoleId: targetRole,
                eventKind: "approval_approved",
              },
            ),
          );
        } else {
          detail.messages.push(
            createBrowserMessage(
              detail.thread.threadId,
              "assistant",
              "Approval rejected. Waiting for a new direction.",
              timestamp,
              { eventKind: "approval_rejected" },
            ),
          );
        }
        detail.thread.updatedAt = timestamp;
        detail.workflow = deriveThreadWorkflow(detail);
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        return;
      }
      try {
        let detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_resolve_approval", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          approvalId: approval.id,
          decision,
        }));
        setActiveThread(detail);
        await reloadThreads(detail.thread.threadId);
        if (decision === "approved") {
          const payload = approval.payload ?? {};
          const targetRole = String(payload.targetRole ?? "").trim() as ThreadRoleId;
          const followupPrompt = String(payload.prompt ?? "").trim();
          if (targetRole && followupPrompt) {
            detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_spawn_agents", {
              cwd: params.cwd,
              threadId: detail.thread.threadId,
              prompt: followupPrompt,
              roles: [targetRole],
            }));
            setActiveThread(detail);
            await reloadThreads(detail.thread.threadId);
            dispatchTaskExecutionPlan({
              detail,
              prompt: followupPrompt,
              plan: {
                mode: "single",
                participantRoleIds: [targetRole],
                primaryRoleId: targetRole,
                synthesisRoleId: targetRole,
                maxParticipants: 1,
                maxRounds: 1,
                cappedParticipantCount: false,
              },
              publishAction: params.publishAction,
            });
          }
        }
      } catch (error) {
        params.setStatus(`Failed to resolve approval: ${formatError(error)}`);
      }
    },
    [activeThread, applyBrowserStore, params, reloadThreads],
  );

  const deleteThread = useCallback(
    async (threadId?: string) => {
      const targetThreadId = String(threadId ?? activeThreadId).trim();
      if (!targetThreadId) {
        return;
      }
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        delete store.details[targetThreadId];
        store.order = store.order.filter((id) => id !== targetThreadId);
        applyBrowserStore(store);
        setComposerDraft("");
        params.setStatus(`Thread deleted: ${targetThreadId}`);
        return;
      }
      const previousSelectedAgentId = selectedAgentId;
      const previousSelectedAgentDetail = selectedAgentDetail;
      const previousSelectedFilePath = selectedFilePath;
      const previousSelectedFileDiff = selectedFileDiff;
      const previousComposerDraft = composerDraft;
      try {
        const optimistic = buildOptimisticThreadDeleteState({
          threadItems,
          targetThreadId,
          activeThreadId,
          projectPath,
          cwd: params.cwd,
        });
        setThreadItems(optimistic.nextThreadItems);
        if (activeThreadId === targetThreadId) {
          setActiveThread(null);
          setActiveThreadId(optimistic.nextActiveThreadId);
          setSelectedAgentId("");
          setSelectedAgentDetail(null);
          setSelectedFilePath("");
          setSelectedFileDiff("");
          setComposerDraft("");
        }
        params.setStatus(`Thread deleted: ${targetThreadId}`);
        await params.invokeFn<boolean>("thread_delete", { cwd: params.cwd, threadId: targetThreadId });
        if (activeThreadId === targetThreadId && optimistic.nextActiveThreadId) {
          void loadThread(optimistic.nextActiveThreadId);
        }
        window.setTimeout(() => {
          void refreshThreadListMetadataSilently();
        }, 160);
      } catch (error) {
        setThreadItems(threadItems);
        setActiveThread(activeThread);
        setActiveThreadId(activeThreadId);
        setSelectedAgentId(previousSelectedAgentId);
        setSelectedAgentDetail(previousSelectedAgentDetail);
        setSelectedFilePath(previousSelectedFilePath);
        setSelectedFileDiff(previousSelectedFileDiff);
        setComposerDraft(previousComposerDraft);
        params.setStatus(`Failed to delete thread: ${formatError(error)}`);
      }
    },
    [
      activeThread,
      activeThreadId,
      applyBrowserStore,
      composerDraft,
      params,
      projectPath,
      refreshThreadListMetadataSilently,
      selectedAgentDetail,
      selectedAgentId,
      selectedFileDiff,
      selectedFilePath,
      loadThread,
      threadItems,
    ],
  );

  const updateAgent = useCallback(
    async (agentId: string, label: string) => {
      if (!activeThread) {
        return;
      }
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        const detail = store.details[activeThread.thread.threadId];
        if (!detail) return;
        detail.agents = detail.agents.map((agent) => (agent.id === agentId ? { ...agent, label, lastUpdatedAt: nowIso() } : agent));
        detail.task.roles = detail.task.roles.map((role) => {
          const normalizedAgentId = `${detail.thread.threadId}:${role.id}`;
          return normalizedAgentId === agentId ? { ...role, label, updatedAt: nowIso() } : role;
        });
        detail.workflow = deriveThreadWorkflow(detail);
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        params.setStatus("Agent updated");
        return;
      }
      try {
        const detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_update_agent", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          agentId,
          label,
        }));
        setActiveThread(detail);
        await reloadThreads(detail.thread.threadId);
        params.setStatus("Agent updated");
      } catch (error) {
        params.setStatus(`Failed to update agent: ${formatError(error)}`);
      }
    },
    [activeThread, applyBrowserStore, params, reloadThreads],
  );

  const renameThread = useCallback(
    async (title: string) => {
      if (!activeThread) {
        return;
      }
      const nextTitle = truncateTitle(title);
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        const detail = store.details[activeThread.thread.threadId];
        if (!detail) return;
        detail.thread.title = nextTitle;
        detail.thread.updatedAt = nowIso();
        detail.workflow = deriveThreadWorkflow(detail);
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        params.setStatus(`Thread renamed: ${nextTitle}`);
        return;
      }
      try {
        const detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_rename", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          title: nextTitle,
        }));
        setActiveThread(detail);
        await reloadThreads(detail.thread.threadId);
        params.setStatus(`Thread renamed: ${detail.thread.title}`);
      } catch (error) {
        params.setStatus(`Failed to rename thread: ${formatError(error)}`);
      }
    },
    [activeThread, applyBrowserStore, params, reloadThreads],
  );

  const removeAgent = useCallback(
    async (agentId: string) => {
      if (!activeThread) {
        return;
      }
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        const detail = store.details[activeThread.thread.threadId];
        if (!detail) return;
        const removedRoleId = String(agentId.split(":").pop() ?? "").trim() as ThreadRoleId;
        detail.agents = detail.agents.filter((agent) => agent.id !== agentId);
        if (selectedAgentId === agentId) {
          setSelectedAgentId("");
          setSelectedAgentDetail(null);
          setSelectedAgentIdsByThread((current) => rememberThreadSelection(current, detail.thread.threadId, ""));
        }
        detail.task.roles = detail.task.roles.map((role) =>
          role.id === removedRoleId ? { ...role, enabled: false, status: "disabled", updatedAt: nowIso() } : role,
        );
        detail.workflow = deriveThreadWorkflow(detail);
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        params.setStatus("Agent removed");
        return;
      }
      try {
        const detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_remove_agent", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          agentId,
        }));
        setActiveThread(detail);
        if (selectedAgentId === agentId) {
          setSelectedAgentId("");
          setSelectedAgentIdsByThread((current) => rememberThreadSelection(current, detail.thread.threadId, ""));
        }
        setSelectedAgentDetail((current) => (current?.agent.id === agentId ? null : current));
        await reloadThreads(detail.thread.threadId);
        params.setStatus("Agent removed");
      } catch (error) {
        params.setStatus(`Failed to remove agent: ${formatError(error)}`);
      }
    },
    [activeThread, applyBrowserStore, params, reloadThreads, selectedAgentId],
  );

  const addAgent = useCallback(
    async (roleId: ThreadRoleId, label: string) => {
      if (!activeThread) {
        return;
      }
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        const detail = store.details[activeThread.thread.threadId];
        if (!detail) return;
        if (!detail.agents.some((agent) => agent.roleId === roleId)) {
          detail.agents.push({
            id: `${detail.thread.threadId}:${roleId}`,
            threadId: detail.thread.threadId,
            label,
            roleId,
            status: "idle",
            summary: getTaskAgentSummary(roleId),
            worktreePath: detail.task.worktreePath || detail.task.workspacePath,
            lastUpdatedAt: nowIso(),
          });
          if (detail.task.roles.some((role) => role.id === roleId)) {
            detail.task.roles = detail.task.roles.map((role) =>
              role.id === roleId
                ? {
                    ...role,
                    label,
                    studioRoleId: getTaskAgentStudioRoleId(roleId) || "",
                    enabled: true,
                    status: "idle",
                    updatedAt: nowIso(),
                  }
                : role,
            );
          } else {
            detail.task.roles.push({
              id: roleId,
              label,
              studioRoleId: getTaskAgentStudioRoleId(roleId) || "",
              enabled: true,
              status: "idle",
              lastPrompt: null,
              lastPromptAt: null,
              lastRunId: null,
              artifactPaths: [],
              updatedAt: nowIso(),
            });
          }
          detail.messages.push(
            createBrowserMessage(
              detail.thread.threadId,
              "assistant",
              `Added ${getTaskAgentLabel(roleId)} to this thread.`,
              nowIso(),
              {
                agentId: `${detail.thread.threadId}:${roleId}`,
                agentLabel: getTaskAgentLabel(roleId),
                sourceRoleId: roleId,
                eventKind: "agent_added",
              },
            ),
          );
        }
        detail.workflow = deriveThreadWorkflow(detail);
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        rememberSelectedAgent(detail.thread.threadId, `${detail.thread.threadId}:${roleId}`);
        setDetailTab("agent");
        params.setStatus(`Agent added: ${getTaskAgentLabel(roleId)}`);
        return;
      }
      try {
        const detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_add_agent", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          roleId,
          label,
        }));
        setActiveThread(detail);
        rememberSelectedAgent(detail.thread.threadId, `${detail.thread.threadId}:${roleId}`);
        setDetailTab("agent");
        await reloadThreads(detail.thread.threadId);
        params.setStatus(`Agent added: ${getTaskAgentLabel(roleId)}`);
      } catch (error) {
        params.setStatus(`Failed to add agent: ${formatError(error)}`);
      }
    },
    [activeThread, applyBrowserStore, params, reloadThreads, rememberSelectedAgent],
  );

  const selectFilePath = useCallback((filePath: string) => {
    const threadId = String(activeThread?.thread.threadId || activeThreadId).trim();
    if (!threadId) {
      setSelectedFilePath(String(filePath ?? "").trim());
      return;
    }
    rememberSelectedFile(threadId, filePath);
  }, [activeThread?.thread.threadId, activeThreadId, rememberSelectedFile]);

  const searchRuntimeSessions = useCallback(
    (query: string) => queryTasksSessionIndex(runtimeSessionIndex, query),
    [runtimeSessionIndex],
  );

  return {
    loading,
    threads,
    projectGroups,
    activeThread,
    activeThreadCoordination,
    activeThreadId,
    composerCoordinationModeOverride,
    composerCoordinationPreview,
    projectPath,
    composerDraft,
    setComposerDraft,
    model,
    setModel,
    reasoning,
    setReasoning,
    accessMode,
    setAccessMode: () => undefined,
    detailTab,
    setDetailTab,
    detailTabs: THREAD_DETAIL_TABS,
    pendingApprovals,
    selectedAgentId,
    selectedAgentDetail,
    selectedFilePath,
    selectedFileDiff,
    liveRoleNotes,
    liveProcessEvents,
    attachedFiles,
    selectedComposerRoleIds,
    setComposerCoordinationModeOverride,
    setSelectedFilePath: selectFilePath,
    addComposerRole,
    removeComposerRole,
    openProjectDirectory,
    removeProject,
    openKnowledgeEntryForArtifact,
    openAttachmentPicker,
    removeAttachedFile,
    openNewThread,
    approveActiveCoordinationPlan,
    cancelActiveCoordination,
    requestCoordinationFollowup,
    resumeActiveCoordination,
    selectProject,
    searchRuntimeSessions,
    selectThread,
    submitComposer,
    stopComposerRun,
    canInterruptCurrentThread,
    composerSubmitPending,
    stoppingComposerRun,
    openAgent,
    resolveApproval,
    compactSelectedAgentCodexThread,
    deleteThread,
    addAgent,
    renameThread,
    updateAgent,
    verifyActiveCoordinationReview,
    removeAgent,
  };
}
