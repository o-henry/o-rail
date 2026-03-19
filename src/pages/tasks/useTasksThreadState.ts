import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeFileRef } from "../../features/workflow/types";
import type { AgenticAction } from "../../features/orchestration/agentic/actionBus";
import { readKnowledgeEntries } from "../../features/studio/knowledgeIndex";
import {
  UNITY_DEFAULT_THREAD_PRESET_IDS,
  buildTaskAgentPrompt,
  getTaskAgentDiscussionLine,
  getTaskAgentLabel,
  getTaskAgentPresetIdByStudioRoleId,
  getTaskAgentStudioRoleId,
  getTaskAgentSummary,
  parseTaskAgentTags,
} from "./taskAgentPresets";
import { createTaskExecutionPlan } from "./taskExecutionPolicy";
import type {
  ApprovalDecision,
  ApprovalRecord,
  BackgroundAgentRecord,
  ThreadAgentDetail,
  ThreadDetail,
  ThreadDetailTab,
  ThreadListItem,
  ThreadMessage,
  ThreadRoleId,
} from "./threadTypes";
import { THREAD_DETAIL_TABS } from "./threadTypes";
import { buildProjectThreadGroups, filterBrowserThreadIdsByProject, filterThreadListByProject } from "./threadTree";
import { rememberThreadSelection, resolveThreadSelection } from "./threadSelectionState";
import { deriveThreadWorkflow, deriveThreadWorkflowSummary } from "./threadWorkflow";
import { extractCodexThreadStatus, extractTaskCodexThreadRuntime } from "./taskCodexThreadRuntime";

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

type BrowserStore = {
  order: string[];
  details: Record<string, ThreadDetail>;
};

type KnowledgeRetrieveResult = {
  snippets: Array<{
    fileId: string;
    fileName: string;
    chunkIndex: number;
    text: string;
    score: number;
  }>;
  warnings: string[];
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

const BROWSER_STORE_KEY = "rail.tasks.browser-state.v4";
const TASKS_PROJECT_PATH_KEY = "rail.tasks.project-path.v1";
const TASKS_PROJECT_LIST_KEY = "rail.tasks.project-list.v1";
const TASKS_HIDDEN_PROJECT_LIST_KEY = "rail.tasks.hidden-project-list.v1";

function truncateTitle(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "NEW THREAD";
  return trimmed.length > 52 ? `${trimmed.slice(0, 52)}…` : trimmed;
}

function isPlaceholderTitle(input: string): boolean {
  const normalized = String(input ?? "").trim().toLowerCase();
  return !normalized || normalized === "new thread" || normalized === "새 thread" || normalized === "새 스레드";
}

function shouldAutoReplaceTitle(currentTitle: string, currentPrompt: string): boolean {
  const title = String(currentTitle ?? "").trim();
  if (!title || isPlaceholderTitle(title)) {
    return true;
  }
  const prompt = String(currentPrompt ?? "").trim();
  return Boolean(prompt) && title === truncateTitle(prompt);
}

function rolePrompt(detail: ThreadDetail, roleId: ThreadRoleId, prompt: string): string {
  const goal = String(detail.task.goal ?? "").trim();
  const userPrompt = String(prompt ?? "").trim() || goal;
  return buildTaskAgentPrompt(roleId, userPrompt);
}

function defaultSelectedFile(detail: ThreadDetail | null): string {
  if (!detail) return "";
  return detail.changedFiles[0] ?? detail.files[0]?.path ?? "";
}

function defaultSelectedAgent(detail: ThreadDetail | null): string {
  if (!detail) return "";
  return detail.agents[0]?.id ?? "";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function cloneStore(store: BrowserStore): BrowserStore {
  return JSON.parse(JSON.stringify(store)) as BrowserStore;
}

function emptyBrowserStore(): BrowserStore {
  return { order: [], details: {} };
}

function loadBrowserStore(): BrowserStore {
  if (typeof window === "undefined") {
    return emptyBrowserStore();
  }
  try {
    const raw = window.localStorage.getItem(BROWSER_STORE_KEY);
    if (!raw) {
      return emptyBrowserStore();
    }
    const parsed = JSON.parse(raw) as BrowserStore;
    if (!parsed || !Array.isArray(parsed.order) || typeof parsed.details !== "object") {
      return emptyBrowserStore();
    }
    return parsed;
  } catch {
    return emptyBrowserStore();
  }
}

function persistBrowserStore(store: BrowserStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BROWSER_STORE_KEY, JSON.stringify(store));
}

function loadTasksProjectPath(defaultValue: string): string {
  if (typeof window === "undefined") {
    return defaultValue;
  }
  try {
    const raw = window.localStorage.getItem(TASKS_PROJECT_PATH_KEY);
    const value = String(raw ?? "").trim();
    return value || defaultValue;
  } catch {
    return defaultValue;
  }
}

function persistTasksProjectPath(path: string) {
  if (typeof window === "undefined") return;
  const normalized = String(path ?? "").trim();
  if (!normalized) {
    window.localStorage.removeItem(TASKS_PROJECT_PATH_KEY);
    return;
  }
  window.localStorage.setItem(TASKS_PROJECT_PATH_KEY, normalized);
}

function loadTasksProjectList(defaultValue: string): string[] {
  if (typeof window === "undefined") {
    return defaultValue.trim() ? [defaultValue.trim()] : [];
  }
  try {
    const raw = window.localStorage.getItem(TASKS_PROJECT_LIST_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const values = Array.isArray(parsed) ? parsed : [];
    const normalized = values
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (defaultValue.trim() && !normalized.includes(defaultValue.trim())) {
      normalized.push(defaultValue.trim());
    }
    return normalized;
  } catch {
    return defaultValue.trim() ? [defaultValue.trim()] : [];
  }
}

function persistTasksProjectList(paths: string[]) {
  if (typeof window === "undefined") return;
  const normalized = [...new Set(paths.map((path) => String(path ?? "").trim()).filter(Boolean))];
  window.localStorage.setItem(TASKS_PROJECT_LIST_KEY, JSON.stringify(normalized));
}

function loadHiddenTasksProjectList(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(TASKS_HIDDEN_PROJECT_LIST_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map((value) => String(value ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function persistHiddenTasksProjectList(paths: string[]) {
  if (typeof window === "undefined") return;
  const normalized = [...new Set(paths.map((path) => String(path ?? "").trim()).filter(Boolean))];
  window.localStorage.setItem(TASKS_HIDDEN_PROJECT_LIST_KEY, JSON.stringify(normalized));
}

function withDerivedWorkflow(detail: ThreadDetail): ThreadDetail {
  return {
    ...detail,
    workflow: deriveThreadWorkflow(detail),
  };
}

function toThreadListItem(detail: ThreadDetail): ThreadListItem {
  const workflow = detail.workflow ?? deriveThreadWorkflow(detail);
  return {
    thread: detail.thread,
    projectPath: detail.task.projectPath || detail.task.workspacePath,
    agentCount: detail.agents.length,
    pendingApprovalCount: detail.approvals.filter((approval) => approval.status === "pending").length,
    workflowSummary: deriveThreadWorkflowSummary({ ...detail, workflow }),
  };
}

function buildBrowserFiles(): Array<{ path: string; changed: boolean }> {
  return [
    { path: "README.md", changed: false },
    { path: "src/pages/tasks/TasksPage.tsx", changed: true },
    { path: "src/pages/tasks/useTasksThreadState.ts", changed: true },
    { path: "src/app/MainApp.tsx", changed: false },
  ];
}

function buildBrowserArtifacts(taskId: string, prompt: string): Record<string, string> {
  const brief = prompt || "Start by describing the change you want to make.";
  return {
    brief,
    findings: "Design pass pending.",
    plan: "1. Brief the Unity task\n2. Capture design notes\n3. Implement and integrate\n4. Playtest and lock",
    patch: "No patch yet.",
    validation: "Validation pending.",
    handoff: `Artifacts live under .rail/tasks/${taskId}/...`,
  };
}

function buildBrowserAgents(threadId: string, workspacePath: string, createdAt: string): BackgroundAgentRecord[] {
  return UNITY_DEFAULT_THREAD_PRESET_IDS.map((roleId) => ({
    id: `${threadId}:${roleId}`,
    threadId,
    label: getTaskAgentLabel(roleId),
    roleId,
    status: "idle",
    summary: getTaskAgentSummary(roleId),
    worktreePath: workspacePath,
    lastUpdatedAt: createdAt,
  }));
}

function latestBrowserArtifact(detail: ThreadDetail) {
  const artifactEntries = Object.entries(detail.artifacts).filter(([, content]) => String(content ?? "").trim());
  const latestEntry = artifactEntries[artifactEntries.length - 1];
  if (!latestEntry) {
    return { path: null, preview: null };
  }
  const [artifactKey, artifactContent] = latestEntry;
  return {
    path: `.rail/tasks/${detail.task.taskId}/${artifactKey}.md`,
    preview: artifactContent,
  };
}

function createBrowserMessage(
  threadId: string,
  role: ThreadMessage["role"],
  content: string,
  createdAt: string,
  options?: Partial<Pick<ThreadMessage, "agentId" | "agentLabel" | "sourceRoleId" | "eventKind" | "artifactPath">>,
): ThreadMessage {
  return {
    id: nextId("msg"),
    threadId,
    role,
    content,
    agentId: options?.agentId ?? null,
    agentLabel: options?.agentLabel ?? null,
    sourceRoleId: options?.sourceRoleId ?? null,
    eventKind: options?.eventKind ?? null,
    artifactPath: options?.artifactPath ?? null,
    createdAt,
  };
}

function buildBrowserThread(
  storageRoot: string,
  projectPath: string,
  prompt: string,
  model: string,
  reasoning: string,
  accessMode: string,
): ThreadDetail {
  const createdAt = nowIso();
  const threadId = nextId("thread");
  const taskId = nextId("task");
  const roles = UNITY_DEFAULT_THREAD_PRESET_IDS.map((roleId) => ({
    id: roleId,
    label: getTaskAgentLabel(roleId),
    studioRoleId: getTaskAgentStudioRoleId(roleId) || "",
    enabled: true,
    status: "ready",
    lastPrompt: null,
    lastPromptAt: null,
    lastRunId: null,
    artifactPaths: [],
    updatedAt: createdAt,
  }));
  const detail = {
    thread: {
      threadId,
      taskId,
      title: truncateTitle(prompt),
      userPrompt: prompt,
      status: "idle",
      cwd: projectPath,
      branchLabel: "main",
      accessMode,
      model,
      reasoning,
      createdAt,
      updatedAt: createdAt,
    },
    task: {
      taskId,
      goal: prompt || "NEW THREAD",
      mode: "balanced",
      team: "full-squad",
      isolationRequested: "auto",
      isolationResolved: "current-repo",
      status: "active",
      projectPath,
      workspacePath: projectPath,
      worktreePath: projectPath,
      branchName: "main",
      fallbackReason: null,
      createdAt,
      updatedAt: createdAt,
      roles,
      prompts: [],
    },
    messages: [],
    agents: buildBrowserAgents(threadId, projectPath, createdAt),
    approvals: [],
    agentDetail: null,
    artifacts: {
      ...buildBrowserArtifacts(taskId, prompt),
      handoff: `Artifacts live under ${storageRoot.replace(/[\/]+$/, "")}/.rail/tasks/${taskId}/...`,
    },
    changedFiles: [],
    validationState: "pending",
    riskLevel: "medium",
    files: buildBrowserFiles(),
  } as unknown as ThreadDetail;
  detail.workflow = deriveThreadWorkflow(detail);
  return detail;
}

function buildBrowserAgentDetail(detail: ThreadDetail, agent: BackgroundAgentRecord): ThreadAgentDetail {
  const lastUserMessage = [...detail.messages].reverse().find((message) => message.role === "user");
  const latestArtifact = latestBrowserArtifact(detail);
  return {
    agent,
    studioRoleId: getTaskAgentStudioRoleId(agent.roleId),
    lastPrompt: lastUserMessage?.content ?? null,
    lastPromptAt: lastUserMessage?.createdAt ?? null,
    lastRunId: `${detail.thread.threadId}:${agent.roleId}`,
    artifactPaths: Object.keys(detail.artifacts).map((key) => `.rail/tasks/${detail.task.taskId}/${key}.md`),
    latestArtifactPath: latestArtifact.path,
    latestArtifactPreview: latestArtifact.preview,
    worktreePath: detail.task.worktreePath || detail.task.workspacePath,
  };
}

function findLatestCodexResponseJsonPath(paths: string[]): string {
  return [...paths]
    .reverse()
    .find((path) => /(?:^|[\\/])response\.json$/i.test(String(path ?? "").trim())) ?? "";
}

function browserDiffContent(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,5 @@",
    "+ simulated browser fallback diff",
    "+ agent output will appear here after file integration",
  ].join("\n");
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
  const browserStoreRef = useRef<BrowserStore>(loadBrowserStore());
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
    (store: BrowserStore, preferredThreadId?: string) => {
      browserStoreRef.current = store;
      persistBrowserStore(store);
      const normalizedDetails = Object.fromEntries(
        Object.entries(store.details).map(([threadId, detail]) => [threadId, withDerivedWorkflow(detail)]),
      ) as Record<string, ThreadDetail>;
      store.details = normalizedDetails;
      const allItems = store.order.map((threadId) => store.details[threadId]).filter(Boolean).map(toThreadListItem);
      setThreadItems(allItems);
      const visibleOrder = filterBrowserThreadIdsByProject(store.details, store.order, projectPath || params.cwd);
      const nextId =
        (preferredThreadId && visibleOrder.includes(preferredThreadId) ? preferredThreadId : "") ||
        (activeThreadId && visibleOrder.includes(activeThreadId) ? activeThreadId : "") ||
        visibleOrder[0] ||
        "";
      if (!nextId) {
        setActiveThread(null);
        setActiveThreadId("");
        setSelectedAgentId("");
        setSelectedAgentDetail(null);
        setSelectedFilePath("");
        setSelectedFileDiff("");
        return null;
      }
      const detail = withDerivedWorkflow(store.details[nextId]);
      setActiveThread(detail);
      setActiveThreadId(nextId);
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
      return detail;
    },
    [activeThreadId, params.cwd, projectPath],
  );

  const loadThread = useCallback(
    async (threadId: string) => {
      if (!threadId) {
        setActiveThread(null);
        setSelectedAgentId("");
        setSelectedAgentDetail(null);
        setSelectedFilePath("");
        setSelectedFileDiff("");
        return null;
      }
      if (!params.hasTauriRuntime || !params.cwd) {
        const detail = browserStoreRef.current.details[threadId] ? withDerivedWorkflow(browserStoreRef.current.details[threadId]!) : null;
        if (!detail) {
          return applyBrowserStore(browserStoreRef.current);
        }
        const nextProjectPath = String(detail.task.projectPath || detail.task.workspacePath || projectPath || params.cwd).trim() || params.cwd;
        rememberProjectPath(nextProjectPath);
        setProjectPath(nextProjectPath);
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
        return detail;
      }
      try {
        const detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_load", { cwd: params.cwd, threadId }));
        const nextProjectPath = String(detail.task.projectPath || detail.task.workspacePath || projectPath || params.cwd).trim() || params.cwd;
        rememberProjectPath(nextProjectPath);
        setProjectPath(nextProjectPath);
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
        return detail;
      } catch (error) {
        params.setStatus(`THREAD load failed: ${formatError(error)}`);
        params.appendWorkspaceEvent({
          source: "tasks-thread",
          actor: "system",
          level: "error",
          message: `THREAD load failed: ${formatError(error)}`,
        });
        return null;
      }
    },
    [applyBrowserStore, params, rememberSelectedAgent, rememberSelectedFile, selectedAgentIdsByThread, selectedFilePathsByThread],
  );

  const reloadThreads = useCallback(
    async (preferredThreadId?: string) => {
      if (!params.hasTauriRuntime || !params.cwd) {
        applyBrowserStore(browserStoreRef.current, preferredThreadId);
        return;
      }
      setLoading(true);
      try {
        const items = await params.invokeFn<ThreadListItem[]>("thread_list", { cwd: params.cwd });
        setThreadItems(items);
        const visibleItems = filterThreadListByProject(items, projectPath || params.cwd);
        const nextId =
          (preferredThreadId && visibleItems.some((item) => item.thread.threadId === preferredThreadId) ? preferredThreadId : "") ||
          (activeThreadId && visibleItems.some((item) => item.thread.threadId === activeThreadId) ? activeThreadId : "") ||
          visibleItems[0]?.thread.threadId ||
          "";
        if (nextId) {
          await loadThread(nextId);
        } else {
          setActiveThread(null);
          setActiveThreadId("");
          setSelectedAgentId("");
          setSelectedAgentDetail(null);
          setSelectedFilePath("");
          setSelectedFileDiff("");
        }
      } catch (error) {
        params.setStatus(`Failed to load threads: ${formatError(error)}`);
      } finally {
        setLoading(false);
      }
    },
    [activeThreadId, applyBrowserStore, loadThread, params, projectPath],
  );

  const refreshCurrentThreadSilently = useCallback(
    async (threadId: string) => {
      const normalizedThreadId = String(threadId ?? "").trim();
      if (!normalizedThreadId || !params.hasTauriRuntime || !params.cwd) {
        return;
      }
      try {
        const [items, detail] = await Promise.all([
          params.invokeFn<ThreadListItem[]>("thread_list", { cwd: params.cwd }),
          params.invokeFn<ThreadDetail>("thread_load", { cwd: params.cwd, threadId: normalizedThreadId }),
        ]);
        const nextDetail = withDerivedWorkflow(detail);
        setThreadItems(items);
        setActiveThread(nextDetail);
        setActiveThreadId(nextDetail.thread.threadId);
        rememberSelectedAgent(
          nextDetail.thread.threadId,
          resolveThreadSelection(
            selectedAgentIdsByThread,
            nextDetail.thread.threadId,
            nextDetail.agents.map((agent) => agent.id),
            defaultSelectedAgent(nextDetail),
          ),
        );
        rememberSelectedFile(
          nextDetail.thread.threadId,
          resolveThreadSelection(
            selectedFilePathsByThread,
            nextDetail.thread.threadId,
            nextDetail.files.map((file) => file.path),
            defaultSelectedFile(nextDetail),
          ),
        );
      } catch {
        // Keep silent polling failures from interrupting the Tasks UI.
      }
    },
    [params, projectPath, rememberSelectedAgent, rememberSelectedFile, selectedAgentIdsByThread, selectedFilePathsByThread],
  );

  const hydrateAgentDetailWithCodexRuntime = useCallback(
    async (detail: ThreadAgentDetail): Promise<ThreadAgentDetail> => {
      if (!params.hasTauriRuntime || !params.cwd) {
        return detail;
      }
      const responseJsonPath = findLatestCodexResponseJsonPath(detail.artifactPaths);
      if (!responseJsonPath) {
        return detail;
      }
      try {
        const responseJson = await params.invokeFn<string>("workspace_read_text", { path: responseJsonPath });
        const runtime = extractTaskCodexThreadRuntime(responseJson);
        if (!runtime?.codexThreadId) {
          return detail;
        }
        let codexThreadStatus = runtime.codexThreadStatus ?? null;
        try {
          const threadState = await params.invokeFn<unknown>("codex_thread_read", {
            threadId: runtime.codexThreadId,
            includeTurns: false,
          });
          codexThreadStatus = extractCodexThreadStatus(threadState) || codexThreadStatus;
        } catch {
          // Keep the last known status from response.json if live read is unavailable.
        }
        return {
          ...detail,
          codexThreadId: runtime.codexThreadId,
          codexTurnId: runtime.codexTurnId ?? null,
          codexThreadStatus,
        };
      } catch {
        return detail;
      }
    },
    [params],
  );

  const loadAgentDetail = useCallback(
    async (threadId: string, agentId: string): Promise<ThreadAgentDetail | null> => {
      if (!threadId || !agentId || !params.hasTauriRuntime || !params.cwd) {
        return null;
      }
      const detail = await params.invokeFn<ThreadAgentDetail>("thread_open_agent_detail", {
        cwd: params.cwd,
        threadId,
        agentId,
      });
      return hydrateAgentDetailWithCodexRuntime(detail);
    },
    [hydrateAgentDetailWithCodexRuntime, params],
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
  }, [activeThreadId]);

  useEffect(() => {
    setLiveProcessEvents([]);
  }, [activeThreadId]);

  useEffect(() => {
    const liveRoleIds = new Set((activeThread?.agents ?? []).filter((agent) => agent.status !== "idle" && agent.status !== "done").map((agent) => agent.roleId));
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
    () => Boolean(activeThread && activeThread.agents.some((agent) => agent.status !== "idle" && agent.status !== "done")),
    [activeThread],
  );

  useEffect(() => {
    const hasLiveAgents = (activeThread?.agents ?? []).some((agent) => agent.status !== "idle" && agent.status !== "done");
    if (!hasLiveAgents || !activeThreadId || !params.hasTauriRuntime || !params.cwd) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshCurrentThreadSilently(activeThreadId);
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [activeThread?.agents, activeThreadId, params, refreshCurrentThreadSilently]);

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
    const normalizedPath = String(artifactPath ?? "").trim();
    if (!normalizedPath) {
      return;
    }
    const matched = readKnowledgeEntries().find((entry) =>
      String(entry.markdownPath ?? "").trim() === normalizedPath ||
      String(entry.jsonPath ?? "").trim() === normalizedPath ||
      String(entry.sourceFile ?? "").trim() === normalizedPath,
    );
    if (!matched) {
      params.setStatus("데이터베이스에서 연결된 문서를 찾지 못했습니다.");
      return;
    }
    params.publishAction({
      type: "open_knowledge_doc",
      payload: {
        entryId: matched.id,
      },
    });
  }, [params]);

  const buildPromptWithAttachments = useCallback(async (prompt: string) => {
    const normalizedPrompt = String(prompt ?? "").trim();
    if (!normalizedPrompt || attachedFiles.length === 0 || !params.hasTauriRuntime || !params.cwd) {
      return normalizedPrompt;
    }
    try {
      const retrieved = await params.invokeFn<KnowledgeRetrieveResult>("knowledge_retrieve", {
        files: attachedFiles,
        query: normalizedPrompt,
        topK: 4,
        maxChars: 3600,
      });
      const fileList = attachedFiles.map((file) => `- ${file.path}`).join("\n");
      const snippetBlock = retrieved.snippets
        .map((snippet, index) => `## ${index + 1}. ${snippet.fileName}\n${snippet.text}`)
        .join("\n\n");
      const warningBlock = retrieved.warnings.length > 0
        ? `\n\nWarnings:\n${retrieved.warnings.map((warning) => `- ${warning}`).join("\n")}`
        : "";
      return [
        normalizedPrompt,
        "",
        "Attached project files:",
        fileList,
        snippetBlock ? `\nRelevant snippets:\n\n${snippetBlock}` : "",
        warningBlock,
      ]
        .filter(Boolean)
        .join("\n");
    } catch (error) {
      params.setStatus(`Failed to read attached files: ${formatError(error)}`);
      return normalizedPrompt;
    }
  }, [attachedFiles, params]);

  const openNewThread = useCallback(async () => {
    setComposerDraft("");
    setSelectedComposerRoleIds([]);
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
      params.setStatus(`Thread created: ${detail.thread.title}`);
      return;
    }
    try {
      const detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_create", {
        cwd: params.cwd,
        projectPath: selectedProjectPath,
        prompt: "NEW THREAD",
        mode: "balanced",
        team: "full-squad",
        isolation: "worktree",
        model,
        reasoning,
        accessMode,
      }));
      setActiveThread(detail);
      setActiveThreadId(detail.thread.threadId);
      rememberSelectedAgent(detail.thread.threadId, defaultSelectedAgent(detail));
      rememberSelectedFile(detail.thread.threadId, defaultSelectedFile(detail));
      await reloadThreads(detail.thread.threadId);
      params.setStatus(`Thread created: ${truncateTitle(detail.thread.title)}`);
    } catch (error) {
      setActiveThread(null);
      setActiveThreadId("");
      params.setStatus(`Failed to create thread: ${formatError(error)}`);
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

  const dispatchExecutionPlan = useCallback(
    async (
      detail: ThreadDetail,
      prompt: string,
      plan: ReturnType<typeof createTaskExecutionPlan>,
    ) => {
      if (plan.mode === "single") {
        const roleId = plan.participantRoleIds[0];
        const studioRoleId = getTaskAgentStudioRoleId(roleId);
        if (!studioRoleId) {
          return;
        }
        params.publishAction({
          type: "run_role",
          payload: {
            roleId: studioRoleId,
            taskId: detail.task.taskId,
            prompt: rolePrompt(detail, roleId, prompt),
            sourceTab: "tasks-thread",
          },
        });
        return;
      }

      params.publishAction({
        type: "run_task_collaboration",
        payload: {
          taskId: detail.task.taskId,
          prompt,
          sourceTab: "tasks-thread",
          roleIds: plan.participantRoleIds.map((roleId) => getTaskAgentStudioRoleId(roleId)).filter(Boolean) as string[],
          primaryRoleId: String(getTaskAgentStudioRoleId(plan.primaryRoleId) ?? "").trim(),
          synthesisRoleId: String(getTaskAgentStudioRoleId(plan.synthesisRoleId) ?? "").trim(),
          criticRoleId: String(getTaskAgentStudioRoleId(plan.criticRoleId ?? "") ?? "").trim() || undefined,
          cappedParticipantCount: plan.cappedParticipantCount,
        },
      });
    },
    [params],
  );

  const submitComposer = useCallback(async () => {
    const prompt = composerDraft.trim();
    if (!prompt) {
      return;
    }
    const selectedProjectPath = String(projectPath || params.cwd || "/workspace").trim();
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
      detail.task.goal = detail.task.goal === "NEW THREAD" ? prompt : detail.task.goal;
      detail.task.updatedAt = timestamp;
      detail.messages.push(
        createBrowserMessage(detail.thread.threadId, "user", prompt, timestamp, {
          eventKind: "user_prompt",
        }),
      );
      const taggedRoles = [...new Set([...selectedComposerRoleIds, ...parseTaskAgentTags(prompt)])];
      const plan = createTaskExecutionPlan({
        enabledRoleIds: detail.agents.map((agent) => agent.roleId),
        requestedRoleIds: taggedRoles,
        prompt,
      });
      const finalRoles = plan.participantRoleIds;
      for (const roleId of finalRoles) {
        if (!detail.agents.some((agent) => agent.roleId === roleId)) {
          detail.agents.push({
            id: `${detail.thread.threadId}:${roleId}`,
            threadId: detail.thread.threadId,
            label: getTaskAgentLabel(roleId),
            roleId,
            status: "idle",
            summary: getTaskAgentSummary(roleId),
            worktreePath: detail.task.worktreePath || detail.task.workspacePath,
            lastUpdatedAt: timestamp,
          });
          detail.messages.push(
            createBrowserMessage(
              detail.thread.threadId,
              "assistant",
              `Created ${getTaskAgentLabel(roleId)} with instructions: ${rolePrompt(detail, roleId, promptWithAttachments)}`,
              timestamp,
              {
                agentId: `${detail.thread.threadId}:${roleId}`,
                agentLabel: getTaskAgentLabel(roleId),
                sourceRoleId: roleId,
                eventKind: "agent_created",
              },
            ),
          );
        }
      }
      detail.agents = detail.agents.map((agent) => {
        const activeIndex = finalRoles.indexOf(agent.roleId);
        if (!finalRoles.includes(agent.roleId)) {
          return { ...agent, status: "idle", lastUpdatedAt: timestamp };
        }
        return {
          ...agent,
          status: plan.mode === "discussion" || activeIndex === 0 ? "thinking" : "awaiting_approval",
          summary: getTaskAgentSummary(agent.roleId),
          lastUpdatedAt: timestamp,
        };
      });
      for (const roleId of finalRoles) {
        detail.messages.push(
          createBrowserMessage(detail.thread.threadId, "assistant", getTaskAgentDiscussionLine(roleId), timestamp, {
            agentId: `${detail.thread.threadId}:${roleId}`,
            agentLabel: getTaskAgentLabel(roleId),
            sourceRoleId: roleId,
            eventKind: "agent_status",
          }),
        );
      }
      if (finalRoles.length > 1 && plan.mode !== "discussion") {
        const sourceRole = finalRoles[0];
        const targetRole = finalRoles[1] as ThreadRoleId;
        detail.approvals = [
          {
            id: nextId("approval"),
            threadId: detail.thread.threadId,
            agentId: `${detail.thread.threadId}:${sourceRole}`,
            kind: "handoff",
            summary: `Approve handoff from ${getTaskAgentLabel(sourceRole)} to ${getTaskAgentLabel(targetRole)}.`,
            payload: {
              targetRole,
              prompt: `Continue the thread based on ${getTaskAgentLabel(sourceRole)} findings: ${promptWithAttachments}`,
            },
            status: "pending",
            createdAt: timestamp,
            updatedAt: null,
          },
        ];
      }
      detail.messages.push(
        createBrowserMessage(
          detail.thread.threadId,
          "assistant",
          plan.mode === "discussion"
            ? `${finalRoles.length} background agents are running a bounded discussion now. I will synthesize the answer after they exchange short briefs.`
            : `${finalRoles.length} background agent is running now. I will synthesize the answer after its update arrives.`,
          timestamp,
          { eventKind: "agent_batch_running" },
        ),
      );
      detail.changedFiles = ["src/pages/tasks/TasksPage.tsx", "src/pages/tasks/useTasksThreadState.ts"];
      detail.files = buildBrowserFiles();
      detail.validationState = finalRoles.includes("qa_playtester") ? "in review" : "pending";
      detail.riskLevel = finalRoles.includes("unity_architect") ? "reviewing" : "medium";
      detail.artifacts = {
        ...detail.artifacts,
        brief: prompt,
        findings: finalRoles.map((roleId) => `${getTaskAgentLabel(roleId)}: ${getTaskAgentSummary(roleId)}`).join("\n"),
        plan: plan.mode === "discussion"
          ? `1. Run ${finalRoles.map((roleId) => getTaskAgentLabel(roleId)).join(", ")} brief\n2. Exchange a bounded critique\n3. Synthesize one answer`
          : `1. Run ${finalRoles.map((roleId) => getTaskAgentLabel(roleId)).join(", ")}\n2. Review files\n3. Synthesize answer`,
      };
      detail.workflow = deriveThreadWorkflow(detail);
      store.details[detail.thread.threadId] = detail;
      applyBrowserStore(store, detail.thread.threadId);
      rememberSelectedAgent(detail.thread.threadId, `${detail.thread.threadId}:${finalRoles[0]}`);
      rememberSelectedFile(detail.thread.threadId, detail.changedFiles[0] ?? defaultSelectedFile(detail));
      setComposerDraft("");
      setSelectedComposerRoleIds([]);
      clearAttachedFiles();
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "user",
        level: "info",
        message: `Thread ${detail.thread.threadId} · ${finalRoles.map((roleId) => getTaskAgentLabel(roleId)).join(", ")} dispatched${plan.cappedParticipantCount ? " (participant cap applied)" : ""}`,
      });
      params.setStatus(`Thread updated: ${truncateTitle(detail.thread.title)}`);
      return;
    }

    try {
      let detail = activeThread;
      if (!detail) {
        detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_create", {
          cwd: params.cwd,
          projectPath: selectedProjectPath,
          prompt: promptWithAttachments,
          mode: "balanced",
          team: "full-squad",
          isolation: "worktree",
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
      const plan = createTaskExecutionPlan({
        enabledRoleIds: detail.agents.map((agent) => agent.roleId),
        requestedRoleIds: taggedRoles,
        prompt,
      });
      for (const roleId of plan.participantRoleIds) {
        if (!detail.agents.some((agent) => agent.roleId === roleId)) {
          detail = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_add_agent", {
            cwd: params.cwd,
            threadId: detail.thread.threadId,
            roleId,
            label: getTaskAgentLabel(roleId),
          }));
        }
      }
      const rolesToRun = plan.participantRoleIds;
      if (rolesToRun.length === 0) {
        setActiveThread(detail);
        await reloadThreads(detail.thread.threadId);
        params.setStatus("No task agents selected. Add an agent or use @researcher, @designer, @architect, @implementer, @playtest, and related tags.");
        return;
      }
      const spawned = withDerivedWorkflow(await params.invokeFn<ThreadDetail>("thread_spawn_agents", {
        cwd: params.cwd,
        threadId: detail.thread.threadId,
        prompt: promptWithAttachments,
        roles: rolesToRun,
        suppressApproval: plan.mode === "discussion",
      }));
      setActiveThread(spawned);
      setActiveThreadId(spawned.thread.threadId);
      rememberSelectedAgent(
        spawned.thread.threadId,
        resolveThreadSelection(
          selectedAgentIdsByThread,
          spawned.thread.threadId,
          spawned.agents.map((agent) => agent.id),
          defaultSelectedAgent(spawned),
        ),
      );
      rememberSelectedFile(
        spawned.thread.threadId,
        resolveThreadSelection(
          selectedFilePathsByThread,
          spawned.thread.threadId,
          spawned.files.map((file) => file.path),
          defaultSelectedFile(spawned),
        ),
      );
      await reloadThreads(spawned.thread.threadId);
      await dispatchExecutionPlan(spawned, promptWithAttachments, plan);
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "user",
        level: "info",
        message: `Thread ${spawned.thread.threadId} · ${rolesToRun.map((roleId) => getTaskAgentLabel(roleId)).join(", ")} dispatched${plan.cappedParticipantCount ? " (participant cap applied)" : ""}`,
      });
      params.setStatus(`Thread updated: ${truncateTitle(spawned.thread.title)}`);
      setComposerDraft("");
      setSelectedComposerRoleIds([]);
      clearAttachedFiles();
    } catch (error) {
      params.setStatus(`Thread submit failed: ${formatError(error)}`);
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "system",
        level: "error",
        message: `Thread submit failed: ${formatError(error)}`,
      });
    }
  }, [accessMode, activeThread, applyBrowserStore, buildPromptWithAttachments, clearAttachedFiles, composerDraft, dispatchExecutionPlan, model, params, projectPath, reasoning, reloadThreads, rememberSelectedAgent, rememberSelectedFile, selectedAgentIdsByThread, selectedComposerRoleIds, selectedFilePathsByThread]);

  const stopComposerRun = useCallback(async () => {
    if (!activeThread || stoppingComposerRun || !canInterruptCurrentThread) {
      return;
    }
    const runningAgents = activeThread.agents.filter((agent) => agent.status !== "idle" && agent.status !== "done");
    if (runningAgents.length === 0) {
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
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
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
      await refreshCurrentThreadSilently(activeThread.thread.threadId);
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
            await dispatchExecutionPlan(detail, followupPrompt, {
              mode: "single",
              participantRoleIds: [targetRole],
              primaryRoleId: targetRole,
              synthesisRoleId: targetRole,
              maxParticipants: 1,
              maxRounds: 1,
              cappedParticipantCount: false,
            });
          }
        }
      } catch (error) {
        params.setStatus(`Failed to resolve approval: ${formatError(error)}`);
      }
    },
    [activeThread, applyBrowserStore, dispatchExecutionPlan, params, reloadThreads],
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
      try {
        await params.invokeFn<boolean>("thread_delete", { cwd: params.cwd, threadId: targetThreadId });
        if (activeThreadId === targetThreadId) {
          setActiveThread(null);
          setActiveThreadId("");
          setSelectedAgentId("");
          setSelectedAgentDetail(null);
          setSelectedFilePath("");
          setSelectedFileDiff("");
          setComposerDraft("");
        }
        await reloadThreads();
        params.setStatus(`Thread deleted: ${targetThreadId}`);
      } catch (error) {
        params.setStatus(`Failed to delete thread: ${formatError(error)}`);
      }
    },
    [activeThreadId, applyBrowserStore, params, reloadThreads],
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

  return {
    loading,
    threads,
    projectGroups,
    activeThread,
    activeThreadId,
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
    setSelectedFilePath: selectFilePath,
    addComposerRole,
    removeComposerRole,
    openProjectDirectory,
    removeProject,
    openKnowledgeEntryForArtifact,
    openAttachmentPicker,
    removeAttachedFile,
    openNewThread,
    selectProject,
    selectThread,
    submitComposer,
    stopComposerRun,
    canInterruptCurrentThread,
    stoppingComposerRun,
    openAgent,
    resolveApproval,
    compactSelectedAgentCodexThread,
    deleteThread,
    addAgent,
    renameThread,
    updateAgent,
    removeAgent,
  };
}
