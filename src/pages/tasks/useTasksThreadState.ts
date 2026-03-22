import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { inferTaskPromptIntent } from "./taskPromptOrchestration";
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
  normalizeTasksProjectPath,
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
import { findRuntimeModelOption } from "../../features/workflow/runtimeModelOptions";
import { getWebProviderFromExecutor } from "../../features/workflow/domain";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const LIVE_ROLE_EVENT_FLUSH_MS = 120;
const LIVE_ROLE_EVENT_REFRESH_DEBOUNCE_MS = 220;

type Params = {
  cwd: string;
  hasTauriRuntime: boolean;
  loginCompleted: boolean;
  codexAuthCheckPending: boolean;
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

type TasksRoleRuntimeEvent = {
  taskId?: string;
  runId?: string;
  studioRoleId?: string;
  type?: string;
  stage?: string | null;
  message?: string;
  payload?: Record<string, unknown> | null;
  at?: string;
};

type RuntimeTarget = {
  codexThreadIds: string[];
  providers: string[];
};

type InternalRunBadge = {
  key: string;
  label: string;
  kind: "internal" | "provider";
};

function formatRuntimeProviderBadgeLabel(raw: string): string {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "steel") return "@STEEL";
  if (normalized === "lightpanda_experimental") return "@LIGHTPANDA";
  if (normalized === "scrapling") return "SCRAPLING";
  if (normalized === "crawl4ai") return "CRAWL4AI";
  if (normalized === "browser_use") return "BROWSER USE";
  if (normalized === "playwright_local") return "PLAYWRIGHT";
  if (normalized === "scrapy_playwright") return "SCRAPY PLAYWRIGHT";
  return normalized.replace(/_/g, " ").toUpperCase();
}

function appendInternalRunBadge(current: InternalRunBadge[], next: InternalRunBadge): InternalRunBadge[] {
  if (!next.key || !next.label) {
    return current;
  }
  if (current.some((badge) => badge.key === next.key)) {
    return current;
  }
  return [...current, next];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? translate("common.unknownError"));
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export const AUTO_EXTERNAL_PROVIDER_MODEL_VALUES = ["WEB / STEEL", "WEB / LIGHTPANDA"] as const;
export type ExternalResearchProviderModel = (typeof AUTO_EXTERNAL_PROVIDER_MODEL_VALUES)[number];
type ExternalProviderReadiness = {
  steel: boolean;
  lightpanda: boolean;
};

export function shouldAutoUseExternalResearchProvider(params: {
  currentModel: string;
  prompt: string;
  taggedRoles: ThreadRoleId[];
}): boolean {
  const currentExecutor = findRuntimeModelOption(params.currentModel).executor;
  if (currentExecutor !== "codex") {
    return false;
  }
  if (params.taggedRoles.includes("researcher")) {
    return true;
  }
  return inferTaskPromptIntent(params.prompt) === "research";
}

export async function resolveAutomaticResearchModel(params: {
  invokeFn: InvokeFn;
  cwd: string;
  currentModel: string;
  prompt: string;
  taggedRoles: ThreadRoleId[];
  hasTauriRuntime: boolean;
  preferredProviderModel?: string | null;
}): Promise<string> {
  const preferredProviderModel = String(params.preferredProviderModel ?? "").trim();
  if (preferredProviderModel && AUTO_EXTERNAL_PROVIDER_MODEL_VALUES.includes(preferredProviderModel as ExternalResearchProviderModel)) {
    return preferredProviderModel;
  }
  if (!params.hasTauriRuntime || !params.cwd) {
    return params.currentModel;
  }
  if (!shouldAutoUseExternalResearchProvider(params)) {
    return params.currentModel;
  }
  try {
    const steelHealth = await params.invokeFn<{ ready?: boolean }>("dashboard_crawl_provider_health", {
      cwd: params.cwd,
      provider: "steel",
    });
    if (steelHealth?.ready) {
      return "WEB / STEEL";
    }
  } catch {
    // Ignore provider probe failures and keep falling back.
  }
  try {
    const lightpandaHealth = await params.invokeFn<{ ready?: boolean }>("dashboard_crawl_provider_health", {
      cwd: params.cwd,
      provider: "lightpanda_experimental",
    });
    if (lightpandaHealth?.ready) {
      return "WEB / LIGHTPANDA";
    }
  } catch {
    // Ignore provider probe failures and keep the current model.
  }
  return params.currentModel;
}

export function deriveAutomaticResearchProviderBadge(params: {
  currentModel: string;
  prompt: string;
  taggedRoles: ThreadRoleId[];
  preferredProviderModel?: string | null;
  readiness: ExternalProviderReadiness;
}): ExternalResearchProviderModel | null {
  const preferredProviderModel = String(params.preferredProviderModel ?? "").trim();
  if (preferredProviderModel && AUTO_EXTERNAL_PROVIDER_MODEL_VALUES.includes(preferredProviderModel as ExternalResearchProviderModel)) {
    return preferredProviderModel as ExternalResearchProviderModel;
  }
  if (!shouldAutoUseExternalResearchProvider(params)) {
    return null;
  }
  if (params.readiness.steel) {
    return "WEB / STEEL";
  }
  if (params.readiness.lightpanda) {
    return "WEB / LIGHTPANDA";
  }
  return null;
}

export function resolveTasksThreadWebProvider(model: string): string | null {
  const executor = findRuntimeModelOption(String(model ?? "").trim()).executor;
  return getWebProviderFromExecutor(executor);
}

export function reduceLiveRoleEventBatch(params: {
  activeThreadId: string;
  currentNotes: Partial<Record<ThreadRoleId, { message: string; updatedAt: string }>>;
  currentEvents: LiveProcessEvent[];
  details: TasksRoleRuntimeEvent[];
}): {
  nextNotes: Partial<Record<ThreadRoleId, { message: string; updatedAt: string }>>;
  nextEvents: LiveProcessEvent[];
  shouldRefresh: boolean;
} {
  const activeThreadId = String(params.activeThreadId ?? "").trim();
  if (!activeThreadId || params.details.length === 0) {
    return {
      nextNotes: params.currentNotes,
      nextEvents: params.currentEvents,
      shouldRefresh: false,
    };
  }
  let nextNotes = params.currentNotes;
  let notesChanged = false;
  let nextEvents = params.currentEvents;
  let eventsChanged = false;
  let shouldRefresh = false;
  const knownEventIds = new Set(params.currentEvents.map((entry) => entry.id));

  for (const detail of params.details) {
    if (String(detail.taskId ?? "").trim() !== activeThreadId) {
      continue;
    }
    const roleId = getTaskAgentPresetIdByStudioRoleId(detail.studioRoleId);
    if (!roleId) {
      continue;
    }
    const eventType = String(detail.type ?? "").trim();
    const stageLabel = String(detail.stage ?? "").trim();
    const message = String(detail.message ?? "").trim() || (stageLabel ? `${stageLabel} 진행 중` : "작업 중");
    const updatedAt = String(detail.at ?? "").trim() || nowIso();

    if (eventType === "run_done" || eventType === "run_error") {
      if (Object.prototype.hasOwnProperty.call(nextNotes, roleId)) {
        if (!notesChanged) {
          nextNotes = { ...nextNotes };
          notesChanged = true;
        }
        delete nextNotes[roleId];
      }
      const filteredEvents = nextEvents.filter((event) => event.roleId !== roleId);
      if (filteredEvents.length !== nextEvents.length) {
        nextEvents = filteredEvents;
        eventsChanged = true;
      }
      shouldRefresh = true;
      continue;
    } else {
      const previous = nextNotes[roleId];
      if (!previous || previous.message !== message || previous.updatedAt !== updatedAt) {
        if (!notesChanged) {
          nextNotes = { ...nextNotes };
          notesChanged = true;
        }
        nextNotes[roleId] = {
          message,
          updatedAt,
        };
      }
    }

    const eventId = [
      String(detail.runId ?? "").trim(),
      roleId,
      eventType,
      stageLabel,
      message,
    ].filter(Boolean).join(":");
    const nextEventId = eventId || nextId("process");
    if (knownEventIds.has(nextEventId)) {
      continue;
    }
    if (!eventsChanged) {
      nextEvents = [...nextEvents];
      eventsChanged = true;
    }
    knownEventIds.add(nextEventId);
    nextEvents.push({
      id: nextEventId,
      runId: String(detail.runId ?? "").trim(),
      roleId,
      agentLabel: getTaskAgentLabel(roleId),
      type: eventType,
      stage: stageLabel,
      message,
      at: updatedAt,
    });
  }

  return {
    nextNotes,
    nextEvents: eventsChanged ? nextEvents.slice(-24) : params.currentEvents,
    shouldRefresh,
  };
}

export function reduceRuntimeTargetsByRole(
  current: Partial<Record<ThreadRoleId, RuntimeTarget>>,
  detail: TasksRoleRuntimeEvent,
): Partial<Record<ThreadRoleId, RuntimeTarget>> {
  const roleId = getTaskAgentPresetIdByStudioRoleId(detail.studioRoleId);
  if (!roleId) {
    return current;
  }
  const eventType = String(detail.type ?? "").trim().toLowerCase();
  if (eventType === "run_done" || eventType === "run_error") {
    if (!current[roleId]) {
      return current;
    }
    const next = { ...current };
    delete next[roleId];
    return next;
  }
  const payload = detail.payload ?? {};
  const codexThreadId = String(payload.codexThreadId ?? "").trim();
  const provider = String(payload.provider ?? "").trim();
  const payloadProviders = Array.isArray(payload.providers)
    ? payload.providers.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (!codexThreadId && !provider && payloadProviders.length === 0) {
    return current;
  }
  const previous = current[roleId] ?? { codexThreadIds: [], providers: [] };
  const nextThreadIds = codexThreadId && !previous.codexThreadIds.includes(codexThreadId)
    ? [...previous.codexThreadIds, codexThreadId]
    : previous.codexThreadIds;
  const nextProviders = [...new Set([
    ...previous.providers,
    ...payloadProviders,
    ...(provider ? [provider] : []),
  ])];
  if (
    nextThreadIds.length === previous.codexThreadIds.length
    && nextThreadIds.every((value, index) => value === previous.codexThreadIds[index])
    && nextProviders.length === previous.providers.length
    && nextProviders.every((value, index) => value === previous.providers[index])
  ) {
    return current;
  }
  return {
    ...current,
    [roleId]: {
      codexThreadIds: nextThreadIds,
      providers: nextProviders,
    },
  };
}

export function isTasksCodexExecutionBlocked(_params: {
  hasTauriRuntime: boolean;
  loginCompleted: boolean;
  codexAuthCheckPending: boolean;
}): boolean {
  return false;
}

export function rememberTasksProjectPath(projectPaths: string[], nextPath: string): string[] {
  const normalized = normalizeTasksProjectPath(nextPath);
  if (!normalized) {
    return projectPaths;
  }
  return projectPaths.includes(normalized) ? projectPaths : [...projectPaths, normalized];
}

export function revealTasksProjectPathState(params: {
  hiddenProjectPaths: string[];
  projectPaths: string[];
  nextPath: string;
}): { hiddenProjectPaths: string[]; projectPaths: string[] } {
  const normalized = normalizeTasksProjectPath(params.nextPath);
  if (!normalized) {
    return {
      hiddenProjectPaths: params.hiddenProjectPaths,
      projectPaths: params.projectPaths,
    };
  }
  return {
    hiddenProjectPaths: params.hiddenProjectPaths.filter((path) => path !== normalized),
    projectPaths: rememberTasksProjectPath(params.projectPaths, normalized),
  };
}

export function isTasksThreadInterruptible(params: {
  agentStatuses: Array<string | null | undefined>;
  coordinationStatus?: string | null;
  runtimeTargetCount?: number;
  activeLiveEventCount?: number;
}): boolean {
  const coordinationStatus = String(params.coordinationStatus ?? "").trim().toLowerCase();
  if (coordinationStatus === "needs_resume" || coordinationStatus === "cancelled") {
    return false;
  }
  if (coordinationStatus === "running") {
    return true;
  }
  if ((params.runtimeTargetCount ?? 0) > 0) {
    return true;
  }
  if ((params.activeLiveEventCount ?? 0) > 0) {
    return true;
  }
  return params.agentStatuses.some((status) => isLiveBackgroundAgentStatus(status));
}

export function resolveTasksProjectSelection(params: {
  cwd: string;
  projectPath: string;
  projectPaths: string[];
  hiddenProjectPaths: string[];
}): string {
  const hiddenSet = new Set(params.hiddenProjectPaths.map((path) => normalizeTasksProjectPath(path)).filter(Boolean));
  const normalizedCurrent = normalizeTasksProjectPath(params.projectPath);
  if (normalizedCurrent && !hiddenSet.has(normalizedCurrent)) {
    return normalizedCurrent;
  }
  const firstVisibleProject = params.projectPaths
    .map((path) => normalizeTasksProjectPath(path))
    .find((path) => path && !hiddenSet.has(path));
  if (firstVisibleProject) {
    return firstVisibleProject;
  }
  const normalizedCwd = normalizeTasksProjectPath(params.cwd);
  return normalizedCwd && !hiddenSet.has(normalizedCwd) ? normalizedCwd : "";
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
  const initialHiddenProjectList = useMemo(() => loadHiddenTasksProjectList(), []);
  const initialProjectList = useMemo(() => loadTasksProjectList(params.cwd), [params.cwd]);
  const initialProjectPath = useMemo(
    () => resolveTasksProjectSelection({
      cwd: params.cwd,
      projectPath: loadTasksProjectPath(params.cwd),
      projectPaths: initialProjectList,
      hiddenProjectPaths: initialHiddenProjectList,
    }),
    [initialHiddenProjectList, initialProjectList, params.cwd],
  );
  const [threadItems, setThreadItems] = useState<ThreadListItem[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [activeThread, setActiveThread] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [composerDraft, setComposerDraft] = useState("");
  const [model, setModel] = useState("GPT-5.4");
  const [composerProviderOverride, setComposerProviderOverride] = useState<ExternalResearchProviderModel | null>(null);
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
  const [latestRunInternalBadges, setLatestRunInternalBadges] = useState<InternalRunBadge[]>([]);
  const [runtimeTargetCount, setRuntimeTargetCount] = useState(0);
  const [stoppingComposerRun, setStoppingComposerRun] = useState(false);
  const [composerSubmitPending, setComposerSubmitPending] = useState(false);
  const [composerCoordinationModeOverride, setComposerCoordinationModeOverride] = useState<CoordinationMode | null>(null);
  const [orchestrationByThread, setOrchestrationByThread] = useState<TasksOrchestrationCache>(() => readTasksOrchestrationCache());
  const [persistedRuntimeSessions, setPersistedRuntimeSessions] = useState<SessionIndexEntry[]>([]);
  const [externalProviderReadiness, setExternalProviderReadiness] = useState<ExternalProviderReadiness>({ steel: false, lightpanda: false });
  const browserStoreRef = useRef<BrowserStore>(loadBrowserStore());
  const orchestrationRef = useRef(orchestrationByThread);
  const orchestrationLedgerRef = useRef<Record<string, RuntimeLedgerEvent[]>>({});
  const liveRoleNotesRef = useRef(liveRoleNotes);
  const liveProcessEventsRef = useRef(liveProcessEvents);
  const runtimeTargetsByRoleRef = useRef<Partial<Record<ThreadRoleId, RuntimeTarget>>>({});
  const pendingRoleEventsRef = useRef<TasksRoleRuntimeEvent[]>([]);
  const liveRoleEventFlushTimeoutRef = useRef<number | null>(null);
  const refreshThreadTimeoutRef = useRef<number | null>(null);
  const visibleThreadItems = useMemo(
    () => threadItems.filter((item) => !hiddenProjectPaths.includes(normalizeTasksProjectPath(item.projectPath || item.thread.cwd || ""))),
    [hiddenProjectPaths, threadItems],
  );
  const visibleProjectPaths = useMemo(
    () => projectPaths.filter((path) => !hiddenProjectPaths.includes(normalizeTasksProjectPath(path))),
    [hiddenProjectPaths, projectPaths],
  );
  const threads = useMemo(() => filterThreadListByProject(visibleThreadItems, projectPath), [projectPath, visibleThreadItems]);
  const projectGroups = useMemo(
    () => buildProjectThreadGroups(visibleThreadItems, projectPath, visibleProjectPaths, params.cwd),
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
    liveRoleNotesRef.current = liveRoleNotes;
  }, [liveRoleNotes]);

  useEffect(() => {
    liveProcessEventsRef.current = liveProcessEvents;
  }, [liveProcessEvents]);

  useEffect(() => {
    setLatestRunInternalBadges([]);
  }, [activeThreadId]);

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
    const normalized = normalizeTasksProjectPath(nextPath);
    if (!normalized) {
      return;
    }
    setProjectPaths((current) => rememberTasksProjectPath(current, normalized));
  }, []);

  const revealProjectPath = useCallback((nextPath: string) => {
    const normalized = normalizeTasksProjectPath(nextPath);
    if (!normalized) {
      return;
    }
    setHiddenProjectPaths((current) => current.filter((path) => path !== normalized));
    setProjectPaths((current) => rememberTasksProjectPath(current, normalized));
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

  useEffect(() => () => {
    if (typeof window !== "undefined") {
      if (liveRoleEventFlushTimeoutRef.current !== null) {
        window.clearTimeout(liveRoleEventFlushTimeoutRef.current);
      }
      if (refreshThreadTimeoutRef.current !== null) {
        window.clearTimeout(refreshThreadTimeoutRef.current);
      }
    }
  }, []);

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
    const nextProjectPath = resolveTasksProjectSelection({
      cwd: params.cwd,
      projectPath,
      projectPaths,
      hiddenProjectPaths,
    });
    if (nextProjectPath !== projectPath) {
      setProjectPath(nextProjectPath);
    }
  }, [hiddenProjectPaths, params.cwd, projectPath, projectPaths]);

  useEffect(() => {
    const discoveredPaths = threadItems
      .map((item) => normalizeTasksProjectPath(item.projectPath || item.thread.cwd || ""))
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
    const normalized = normalizeTasksProjectPath(targetProjectPath);
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

  const scheduleRefreshCurrentThreadSilently = useCallback((threadId: string) => {
    const normalizedThreadId = String(threadId ?? "").trim();
    if (!normalizedThreadId || typeof window === "undefined") {
      return;
    }
    if (refreshThreadTimeoutRef.current !== null) {
      window.clearTimeout(refreshThreadTimeoutRef.current);
    }
    refreshThreadTimeoutRef.current = window.setTimeout(() => {
      refreshThreadTimeoutRef.current = null;
      void refreshCurrentThreadSilently(normalizedThreadId);
    }, LIVE_ROLE_EVENT_REFRESH_DEBOUNCE_MS);
  }, [refreshCurrentThreadSilently]);

  const flushPendingRoleEvents = useCallback(() => {
    if (liveRoleEventFlushTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(liveRoleEventFlushTimeoutRef.current);
      liveRoleEventFlushTimeoutRef.current = null;
    }
    const pending = pendingRoleEventsRef.current;
    if (pending.length === 0) {
      return;
    }
    pendingRoleEventsRef.current = [];
    const reduced = reduceLiveRoleEventBatch({
      activeThreadId,
      currentNotes: liveRoleNotesRef.current,
      currentEvents: liveProcessEventsRef.current,
      details: pending,
    });
    startTransition(() => {
      if (reduced.nextNotes !== liveRoleNotesRef.current) {
        setLiveRoleNotes(reduced.nextNotes);
      }
      if (reduced.nextEvents !== liveProcessEventsRef.current) {
        setLiveProcessEvents(reduced.nextEvents);
      }
    });
    if (reduced.shouldRefresh) {
      scheduleRefreshCurrentThreadSilently(activeThreadId);
    }
  }, [activeThreadId, scheduleRefreshCurrentThreadSilently]);

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
    let cancelled = false;
    if (!params.hasTauriRuntime || !params.cwd) {
      setExternalProviderReadiness({ steel: false, lightpanda: false });
      return;
    }
    const probe = async () => {
      try {
        const [steelHealth, lightpandaHealth] = await Promise.all([
          params.invokeFn<{ ready?: boolean }>("dashboard_crawl_provider_health", {
            cwd: params.cwd,
            provider: "steel",
          }).catch(() => ({ ready: false })),
          params.invokeFn<{ ready?: boolean }>("dashboard_crawl_provider_health", {
            cwd: params.cwd,
            provider: "lightpanda_experimental",
          }).catch(() => ({ ready: false })),
        ]);
        if (cancelled) {
          return;
        }
        setExternalProviderReadiness({
          steel: Boolean(steelHealth?.ready),
          lightpanda: Boolean(lightpandaHealth?.ready),
        });
      } catch {
        if (!cancelled) {
          setExternalProviderReadiness({ steel: false, lightpanda: false });
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [params.cwd, params.hasTauriRuntime, params.invokeFn]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TasksRoleRuntimeEvent>).detail;
      if (!detail || String(detail.taskId ?? "").trim() !== String(activeThreadId ?? "").trim()) {
        return;
      }
      runtimeTargetsByRoleRef.current = reduceRuntimeTargetsByRole(runtimeTargetsByRoleRef.current, detail);
      setRuntimeTargetCount(Object.keys(runtimeTargetsByRoleRef.current).length);
      const payload = detail.payload ?? {};
      const providerLabels = [
        String(payload.provider ?? "").trim(),
        ...(Array.isArray(payload.providers) ? payload.providers.map((value) => String(value ?? "").trim()) : []),
      ]
        .map((value) => formatRuntimeProviderBadgeLabel(value))
        .filter(Boolean);
      if (providerLabels.length > 0) {
        setLatestRunInternalBadges((current) => providerLabels.reduce(
          (badges, label) => appendInternalRunBadge(badges, {
            key: `provider:${label}`,
            label,
            kind: "provider",
          }),
          current,
        ));
      }
      pendingRoleEventsRef.current = [...pendingRoleEventsRef.current, detail];
      if (liveRoleEventFlushTimeoutRef.current !== null) {
        return;
      }
      liveRoleEventFlushTimeoutRef.current = window.setTimeout(() => {
        flushPendingRoleEvents();
      }, LIVE_ROLE_EVENT_FLUSH_MS);
    };
    window.addEventListener("rail:tasks-role-event", handler as EventListener);
    return () => {
      window.removeEventListener("rail:tasks-role-event", handler as EventListener);
      if (liveRoleEventFlushTimeoutRef.current !== null) {
        window.clearTimeout(liveRoleEventFlushTimeoutRef.current);
        liveRoleEventFlushTimeoutRef.current = null;
      }
    };
  }, [activeThreadId, flushPendingRoleEvents]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        taskId?: string;
        participantRoleIds?: string[];
        primaryRoleId?: string;
        criticRoleId?: string;
        orchestrationSummary?: string;
      }>).detail;
      const threadId = String(detail?.taskId ?? "").trim();
      if (!threadId) {
        return;
      }
      const assignedRoleIds = [...new Set((detail?.participantRoleIds ?? []).map((roleId) => String(roleId ?? "").trim()).filter(Boolean))] as ThreadRoleId[];
      updateThreadCoordination(threadId, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          assignedRoleIds,
          nextAction: String(detail?.orchestrationSummary ?? "").trim() || current.nextAction,
          updatedAt: nowIso(),
        };
      });
      setLatestRunInternalBadges((current) => appendInternalRunBadge(current, {
        key: "internal:orchestrator",
        label: "ORCHESTRATOR",
        kind: "internal",
      }));
      setLiveRoleNotes((current) => Object.fromEntries(
        Object.entries(current).filter(([roleId]) => assignedRoleIds.includes(roleId as ThreadRoleId)),
      ) as Partial<Record<ThreadRoleId, { message: string; updatedAt: string }>>);
      setLiveProcessEvents((current) => current.filter((item) => assignedRoleIds.includes(item.roleId)));
      if (!activeThreadId || threadId !== activeThreadId) {
        return;
      }
      setActiveThread((current) => {
        if (!current || current.thread.threadId !== threadId) {
          return current;
        }
        const nextTaskRoles = current.task.roles.map((role) => (
          assignedRoleIds.includes(role.id)
            ? role
            : (!String(role.lastRunId ?? "").trim() && isLiveBackgroundAgentStatus(role.status))
              ? { ...role, status: "idle" as const, updatedAt: nowIso() }
              : role
        ));
        const nextAgents = current.agents.map((agent) => {
          const matchingRole = current.task.roles.find((role) => role.id === agent.roleId);
          return assignedRoleIds.includes(agent.roleId)
            ? agent
            : (!String(matchingRole?.lastRunId ?? "").trim() && isLiveBackgroundAgentStatus(agent.status))
              ? { ...agent, status: "idle" as const, lastUpdatedAt: nowIso() }
              : agent;
        });
        return {
          ...current,
          task: {
            ...current.task,
            roles: nextTaskRoles,
          },
          agents: nextAgents,
        };
      });
      if (params.hasTauriRuntime && params.cwd) {
        void params.invokeFn<ThreadDetail>("thread_sync_orchestrated_roles", {
          cwd: params.cwd,
          threadId,
          assignedRoles: assignedRoleIds,
        }).then((synced) => {
          const hydrated = hydrateThreadDetail(synced);
          if (!hydrated) {
            return;
          }
          setActiveThread((current) => (
            current && current.thread.threadId === threadId ? hydrated : current
          ));
        }).catch(() => {});
      }
    };
    window.addEventListener("rail:tasks-orchestration-resolved", handler as EventListener);
    return () => window.removeEventListener("rail:tasks-orchestration-resolved", handler as EventListener);
  }, [activeThreadId, hydrateThreadDetail, params.cwd, params.hasTauriRuntime, params.invokeFn, updateThreadCoordination]);

  useEffect(() => {
    pendingRoleEventsRef.current = [];
    setLiveProcessEvents([]);
    runtimeTargetsByRoleRef.current = {};
    setRuntimeTargetCount(0);
    if (typeof window !== "undefined" && refreshThreadTimeoutRef.current !== null) {
      window.clearTimeout(refreshThreadTimeoutRef.current);
      refreshThreadTimeoutRef.current = null;
    }
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
      const activeLiveEventCount = liveProcessEvents.filter((event) => {
        const normalized = String(event.type ?? "").trim().toLowerCase();
        return !["run_done", "run_error", "stage_done", "stage_error"].includes(normalized);
      }).length;
      return isTasksThreadInterruptible({
        agentStatuses: activeThread.agents.map((agent) => agent.status),
        coordinationStatus: activeThreadCoordination?.status,
        runtimeTargetCount,
        activeLiveEventCount,
      });
    },
    [activeThread, activeThreadCoordination?.status, liveProcessEvents, runtimeTargetCount],
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
      revealProjectPath(selectedPath);
      setProjectPath(selectedPath);
      params.setStatus(`Tasks project selected: ${selectedPath}`);
    } catch (error) {
      params.setStatus(`Failed to open project: ${formatError(error)}`);
    }
  }, [params, revealProjectPath]);

  const selectProject = useCallback((nextProjectPath: string) => {
    const normalized = String(nextProjectPath ?? "").trim();
    if (!normalized || normalized === projectPath) {
      return;
    }
    revealProjectPath(normalized);
    setActiveThread(null);
    setActiveThreadId("");
    setSelectedAgentId("");
    setSelectedAgentDetail(null);
    setSelectedFilePath("");
    setSelectedFileDiff("");
    setSelectedComposerRoleIds([]);
    setProjectPath(normalized);
  }, [projectPath, revealProjectPath]);

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
    setLatestRunInternalBadges([]);
    const selectedProjectPath = String(projectPath || params.cwd || "/workspace").trim();
    try {
      const promptWithAttachments = await buildPromptWithAttachments(prompt);
      const taggedRoles = [...new Set([...selectedComposerRoleIds, ...parseTaskAgentTags(prompt)])];
      const resolvedModel = await resolveAutomaticResearchModel({
        invokeFn: params.invokeFn,
        cwd: params.cwd,
        currentModel: model,
        prompt,
        taggedRoles,
        hasTauriRuntime: params.hasTauriRuntime,
        preferredProviderModel: composerProviderOverride,
      });
      if (!params.hasTauriRuntime || !params.cwd) {
        const store = cloneStore(browserStoreRef.current);
        const existingDetail = activeThread ? store.details[activeThread.thread.threadId] : undefined;
        const detail: ThreadDetail = existingDetail
          ?? buildBrowserThread(params.cwd || "/workspace", selectedProjectPath, prompt, resolvedModel, reasoning, accessMode);
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
        detail.thread.model = resolvedModel;
        detail.thread.reasoning = reasoning;
        detail.thread.accessMode = accessMode;
        detail.task.goal = isPlaceholderTitle(detail.task.goal) ? prompt : detail.task.goal;
        detail.task.updatedAt = timestamp;
        detail.messages.push(
          createBrowserMessage(detail.thread.threadId, "user", prompt, timestamp, {
            eventKind: "user_prompt",
          }),
        );
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
        setComposerProviderOverride(null);
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
          model: resolvedModel,
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
      setComposerProviderOverride(null);
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
  }, [accessMode, activeThread, applyBrowserStore, buildPromptWithAttachments, clearAttachedFiles, composerCoordinationModeOverride, composerDraft, composerProviderOverride, hydrateThreadDetail, model, params, projectPath, reasoning, selectedComposerRoleIds, syncSpawnedThreadSelection, updateThreadCoordination]);

  const stopComposerRun = useCallback(async () => {
    if (!activeThread || stoppingComposerRun || !canInterruptCurrentThread) {
      return;
    }
    const runningAgents = activeThread.agents.filter((agent) => isLiveBackgroundAgentStatus(agent.status));
    const runtimeRoleIds = Object.keys(runtimeTargetsByRoleRef.current) as ThreadRoleId[];
    const orchestrationRoleIds = [
      ...(activeThreadCoordination?.assignedRoleIds ?? []),
      ...(activeThreadCoordination?.requestedRoleIds ?? []),
    ].filter(Boolean) as ThreadRoleId[];
    const runningRoleIds = new Set<ThreadRoleId>([
      ...runningAgents.map((agent) => agent.roleId),
      ...runtimeRoleIds,
      ...orchestrationRoleIds,
    ]);
    if (runningRoleIds.size === 0) {
      return;
    }

    setStoppingComposerRun(true);
    const timestamp = nowIso();
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
          runningRoleIds.has(agent.roleId)
            ? { ...agent, status: "idle", lastUpdatedAt: timestamp }
            : agent
        ));
        detail.messages.push(
          createBrowserMessage(
            detail.thread.threadId,
            "system",
            "현재 작업을 중단했습니다.",
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
        setRuntimeTargetCount(0);
        params.setStatus("현재 작업을 중단했습니다.");
        return;
      }

      const targetedAgents = activeThread.agents.filter((agent) => runningRoleIds.has(agent.roleId));
      const agentDetails = await Promise.all(
        targetedAgents.map((agent) => loadAgentDetail(activeThread.thread.threadId, agent.id).catch(() => null)),
      );
      const activeRuntimeTargets = [...runningRoleIds]
        .map((roleId) => runtimeTargetsByRoleRef.current[roleId])
        .filter(Boolean);
      const codexThreadIds = [...new Set(
        [
          ...agentDetails
          .map((detail) => String(detail?.codexThreadId ?? "").trim())
          .filter(Boolean),
          ...activeRuntimeTargets.flatMap((target) => target?.codexThreadIds ?? []),
        ],
      )];
      const runtimeProviders = activeRuntimeTargets
        .flatMap((target) => target?.providers ?? [])
        .filter(Boolean);
      const threadWebProvider = runtimeProviders[0] || resolveTasksThreadWebProvider(String(activeThread.thread.model ?? model));
      const cancelOperations: Promise<unknown>[] = [
        ...codexThreadIds.map((threadId) => params.invokeFn("turn_interrupt", { threadId })),
      ];
      if (threadWebProvider) {
        cancelOperations.push(
          params.invokeFn("web_provider_cancel", { provider: threadWebProvider }).catch(() => undefined),
        );
      }
      if (cancelOperations.length > 0) {
        await Promise.allSettled(cancelOperations);
      }
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
      const interruptedDetail = await params.invokeFn<ThreadDetail>("thread_interrupt_run", {
        cwd: params.cwd,
        threadId: activeThread.thread.threadId,
        roleIds: [...runningRoleIds],
        message: "현재 작업을 중단했습니다.",
      }).catch(() => null);
      setLiveRoleNotes((current) => Object.fromEntries(
        Object.entries(current).filter(([roleId]) => !runningRoleIds.has(roleId as ThreadRoleId)),
      ) as Partial<Record<ThreadRoleId, { message: string; updatedAt: string }>>);
      setLiveProcessEvents((current) => current.filter((event) => !runningRoleIds.has(event.roleId)));
      runtimeTargetsByRoleRef.current = Object.fromEntries(
        Object.entries(runtimeTargetsByRoleRef.current).filter(([roleId]) => !runningRoleIds.has(roleId as ThreadRoleId)),
      ) as Partial<Record<ThreadRoleId, RuntimeTarget>>;
      setRuntimeTargetCount(Object.keys(runtimeTargetsByRoleRef.current).length);
      setActiveThread((current) => {
        if (!current || current.thread.threadId !== activeThread.thread.threadId) {
          return current;
        }
        if (interruptedDetail) {
          return withTaskCoordination(interruptedDetail, interruptedCoordination ?? interruptedDetail.orchestration ?? null);
        }
        return withTaskCoordination({
          ...current,
          thread: {
            ...current.thread,
            status: "idle",
            updatedAt: timestamp,
          },
          agents: current.agents.map((agent) => (
            runningRoleIds.has(agent.roleId)
              ? { ...agent, status: "idle", lastUpdatedAt: timestamp, summary: "중단되었습니다." }
              : agent
          )),
          messages: [
            ...current.messages,
            createBrowserMessage(
              current.thread.threadId,
              "system",
              "현재 작업을 중단했습니다.",
              timestamp,
              { eventKind: "run_interrupted" },
            ),
          ],
        }, interruptedCoordination ?? current.orchestration ?? null);
      });
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
                intent: "planning",
                candidateRoleIds: [targetRole],
                participantRoleIds: [targetRole],
                requestedRoleIds: [targetRole],
                primaryRoleId: targetRole,
                synthesisRoleId: targetRole,
                maxParticipants: 1,
                maxRounds: 1,
                cappedParticipantCount: false,
                rolePrompts: {},
                orchestrationSummary: "",
                useAdaptiveOrchestrator: false,
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
    composerProviderOverride,
    projectPath,
    composerDraft,
    setComposerDraft,
    setComposerProviderOverride,
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
    latestRunInternalBadges,
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
    externalProviderReadiness,
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
