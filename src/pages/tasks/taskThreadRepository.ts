import { startTransition } from "react";
import { defaultSelectedAgent, defaultSelectedFile, toThreadListItem, withDerivedWorkflow } from "./taskThreadBrowserState";
import { persistBrowserStore, type BrowserStore } from "./taskThreadStorageState";
import { resolveThreadSelection } from "./threadSelectionState";
import { filterBrowserThreadIdsByProject, filterThreadListByProject } from "./threadTree";
import type {
  ApprovalRecord,
  BackgroundAgentRecord,
  ThreadAgentDetail,
  ThreadDetail,
  ThreadListItem,
  ThreadRecord,
  ThreadWorkflow,
} from "./threadTypes";
import { withTaskCoordination } from "./taskOrchestrationState";
import type { AgenticCoordinationState } from "../../features/orchestration/agentic/coordinationTypes";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type SetState<T> = (value: T | ((current: T) => T)) => void;

type ThreadSelectionDeps = {
  detail: ThreadDetail;
  selectedAgentIdsByThread: Record<string, string>;
  selectedFilePathsByThread: Record<string, string>;
  rememberSelectedAgent: (threadId: string, agentId: string) => void;
  rememberSelectedFile: (threadId: string, filePath: string) => void;
};

type ApplyBrowserStoreParams = {
  store: BrowserStore;
  browserStoreRef: { current: BrowserStore };
  hydrateThreadDetail: (detail: ThreadDetail | null) => ThreadDetail | null;
  preferredThreadId?: string;
  activeThreadId: string;
  projectPath: string;
  cwd: string;
  selectedAgentIdsByThread: Record<string, string>;
  selectedFilePathsByThread: Record<string, string>;
  rememberSelectedAgent: (threadId: string, agentId: string) => void;
  rememberSelectedFile: (threadId: string, filePath: string) => void;
  setActiveThread: SetState<ThreadDetail | null>;
  setActiveThreadId: SetState<string>;
  setSelectedAgentId: SetState<string>;
  setSelectedAgentDetail: SetState<ThreadAgentDetail | null>;
  setSelectedFilePath: SetState<string>;
  setSelectedFileDiff: SetState<string>;
  setThreadItems: SetState<ThreadListItem[]>;
};

type LoadThreadParams = {
  threadId: string;
  hasTauriRuntime: boolean;
  cwd: string;
  projectPath: string;
  invokeFn: InvokeFn;
  browserStoreRef: { current: BrowserStore };
  applyBrowserStore: (store: BrowserStore, preferredThreadId?: string) => ThreadDetail | null;
  hydrateThreadDetail: (detail: ThreadDetail | null) => ThreadDetail | null;
  hydratePersistedCoordination: (threadId: string) => Promise<AgenticCoordinationState | null>;
  selectedAgentIdsByThread: Record<string, string>;
  selectedFilePathsByThread: Record<string, string>;
  rememberProjectPath: (path: string) => void;
  rememberSelectedAgent: (threadId: string, agentId: string) => void;
  rememberSelectedFile: (threadId: string, filePath: string) => void;
  setActiveThread: SetState<ThreadDetail | null>;
  setActiveThreadId: SetState<string>;
  setProjectPath: SetState<string>;
  setSelectedAgentId: SetState<string>;
  setSelectedAgentDetail: SetState<ThreadAgentDetail | null>;
  setSelectedFilePath: SetState<string>;
  setSelectedFileDiff: SetState<string>;
  onError: (message: string) => void;
};

type ReloadThreadsParams = {
  preferredThreadId?: string;
  hasTauriRuntime: boolean;
  cwd: string;
  projectPath: string;
  invokeFn: InvokeFn;
  browserStoreRef: { current: BrowserStore };
  applyBrowserStore: (store: BrowserStore, preferredThreadId?: string) => ThreadDetail | null;
  activeThreadId: string;
  loadThread: (threadId: string) => Promise<ThreadDetail | null>;
  setActiveThread: SetState<ThreadDetail | null>;
  setActiveThreadId: SetState<string>;
  setLoading: SetState<boolean>;
  setSelectedAgentId: SetState<string>;
  setSelectedAgentDetail: SetState<ThreadAgentDetail | null>;
  setSelectedFilePath: SetState<string>;
  setSelectedFileDiff: SetState<string>;
  setThreadItems: SetState<ThreadListItem[]>;
  onError: (message: string) => void;
};

type RefreshCurrentThreadParams = {
  threadId: string;
  currentDetail: ThreadDetail | null;
  hasTauriRuntime: boolean;
  cwd: string;
  projectPath: string;
  invokeFn: InvokeFn;
  hydratePersistedCoordination: (threadId: string) => Promise<AgenticCoordinationState | null>;
  selectedAgentIdsByThread: Record<string, string>;
  selectedFilePathsByThread: Record<string, string>;
  rememberSelectedAgent: (threadId: string, agentId: string) => void;
  rememberSelectedFile: (threadId: string, filePath: string) => void;
  setActiveThread: SetState<ThreadDetail | null>;
  setActiveThreadId: SetState<string>;
  setThreadItems: SetState<ThreadListItem[]>;
};

export type RefreshThreadStateResult = {
  ok: boolean;
  refreshedAt: string;
};

type RefreshThreadListSilentlyParams = {
  hasTauriRuntime: boolean;
  cwd: string;
  projectPath: string;
  invokeFn: InvokeFn;
  setThreadItems: SetState<ThreadListItem[]>;
};

type ThreadRuntimeSnapshot = {
  thread: ThreadRecord;
  task: ThreadDetail["task"];
  agents: BackgroundAgentRecord[];
  approvals: ApprovalRecord[];
  artifacts: ThreadDetail["artifacts"];
  changedFiles: string[];
  validationState: string;
  riskLevel: string;
  workflow: ThreadWorkflow;
  messageCount: number;
};

type ThreadMessageDelta = {
  messages: ThreadDetail["messages"];
  totalCount: number;
  resetRequired: boolean;
};

function canReuseCurrentDetailForSnapshot(currentDetail: ThreadDetail | null, snapshot: ThreadRuntimeSnapshot) {
  if (!currentDetail || currentDetail.thread.threadId !== snapshot.thread.threadId) {
    return false;
  }
  return currentDetail.messages.length === snapshot.messageCount;
}

function mergeSnapshotIntoThreadDetail(currentDetail: ThreadDetail, snapshot: ThreadRuntimeSnapshot): ThreadDetail {
  return {
    ...currentDetail,
    thread: snapshot.thread,
    task: snapshot.task,
    agents: snapshot.agents,
    approvals: snapshot.approvals,
    artifacts: snapshot.artifacts,
    changedFiles: snapshot.changedFiles,
    validationState: snapshot.validationState,
    riskLevel: snapshot.riskLevel,
    workflow: snapshot.workflow,
  };
}

function mergeMessageDeltaIntoThreadDetail(currentDetail: ThreadDetail, delta: ThreadMessageDelta): ThreadDetail {
  return {
    ...currentDetail,
    messages: [...currentDetail.messages, ...delta.messages],
  };
}

function syncSelectedState(params: ThreadSelectionDeps) {
  params.rememberSelectedAgent(
    params.detail.thread.threadId,
    resolveThreadSelection(
      params.selectedAgentIdsByThread,
      params.detail.thread.threadId,
      params.detail.agents.map((agent) => agent.id),
      defaultSelectedAgent(params.detail),
    ),
  );
  params.rememberSelectedFile(
    params.detail.thread.threadId,
    resolveThreadSelection(
      params.selectedFilePathsByThread,
      params.detail.thread.threadId,
      params.detail.files.map((file) => file.path),
      defaultSelectedFile(params.detail),
    ),
  );
}

export function applyBrowserStoreSnapshot(params: ApplyBrowserStoreParams): ThreadDetail | null {
  params.browserStoreRef.current = params.store;
  persistBrowserStore(params.store);
  const normalizedDetails = Object.fromEntries(
    Object.entries(params.store.details).map(([threadId, detail]) => [threadId, params.hydrateThreadDetail(detail) ?? withDerivedWorkflow(detail)]),
  ) as Record<string, ThreadDetail>;
  params.store.details = normalizedDetails;
  const allItems = params.store.order.map((threadId) => params.store.details[threadId]).filter(Boolean).map(toThreadListItem);
  startTransition(() => {
    params.setThreadItems(allItems);
  });
  const visibleOrder = filterBrowserThreadIdsByProject(params.store.details, params.store.order, params.projectPath);
  const nextId =
    (params.preferredThreadId && visibleOrder.includes(params.preferredThreadId) ? params.preferredThreadId : "") ||
    (params.activeThreadId && visibleOrder.includes(params.activeThreadId) ? params.activeThreadId : "") ||
    visibleOrder[0] ||
    "";
  if (!nextId) {
    params.setActiveThread(null);
    params.setActiveThreadId("");
    params.setSelectedAgentId("");
    params.setSelectedAgentDetail(null);
    params.setSelectedFilePath("");
    params.setSelectedFileDiff("");
    return null;
  }
  const detail = params.hydrateThreadDetail(params.store.details[nextId]) ?? withDerivedWorkflow(params.store.details[nextId]);
  params.setActiveThread(detail);
  params.setActiveThreadId(nextId);
  syncSelectedState({
    detail,
    selectedAgentIdsByThread: params.selectedAgentIdsByThread,
    selectedFilePathsByThread: params.selectedFilePathsByThread,
    rememberSelectedAgent: params.rememberSelectedAgent,
    rememberSelectedFile: params.rememberSelectedFile,
  });
  return detail;
}

export async function loadThreadState(params: LoadThreadParams): Promise<ThreadDetail | null> {
  if (!params.threadId) {
    params.setActiveThread(null);
    params.setSelectedAgentId("");
    params.setSelectedAgentDetail(null);
    params.setSelectedFilePath("");
    params.setSelectedFileDiff("");
    return null;
  }
  if (!params.hasTauriRuntime || !params.cwd) {
    const detail = params.browserStoreRef.current.details[params.threadId]
      ? params.hydrateThreadDetail(params.browserStoreRef.current.details[params.threadId]!)
      : null;
    if (!detail) {
      return params.applyBrowserStore(params.browserStoreRef.current);
    }
    const nextProjectPath = String(detail.task.projectPath || detail.task.workspacePath || params.projectPath || params.cwd).trim() || params.cwd;
    params.rememberProjectPath(nextProjectPath);
    params.setProjectPath(nextProjectPath);
    params.setActiveThread(detail);
    params.setActiveThreadId(detail.thread.threadId);
    syncSelectedState({
      detail,
      selectedAgentIdsByThread: params.selectedAgentIdsByThread,
      selectedFilePathsByThread: params.selectedFilePathsByThread,
      rememberSelectedAgent: params.rememberSelectedAgent,
      rememberSelectedFile: params.rememberSelectedFile,
    });
    return detail;
  }
  try {
    const loadedDetail = await params.invokeFn<ThreadDetail>("thread_load", { cwd: params.cwd, threadId: params.threadId });
    const persistedCoordination = await params.hydratePersistedCoordination(loadedDetail?.thread?.threadId ?? params.threadId);
    const detail = loadedDetail ? withTaskCoordination(withDerivedWorkflow(loadedDetail), persistedCoordination) : null;
    if (!detail) {
      return null;
    }
    const nextProjectPath = String(detail.task.projectPath || detail.task.workspacePath || params.projectPath || params.cwd).trim() || params.cwd;
    params.rememberProjectPath(nextProjectPath);
    params.setProjectPath(nextProjectPath);
    params.setActiveThread(detail);
    params.setActiveThreadId(detail.thread.threadId);
    syncSelectedState({
      detail,
      selectedAgentIdsByThread: params.selectedAgentIdsByThread,
      selectedFilePathsByThread: params.selectedFilePathsByThread,
      rememberSelectedAgent: params.rememberSelectedAgent,
      rememberSelectedFile: params.rememberSelectedFile,
    });
    return detail;
  } catch (error) {
    params.onError(error instanceof Error ? error.message : String(error ?? "Unknown error"));
    return null;
  }
}

export async function reloadThreadList(params: ReloadThreadsParams) {
  if (!params.hasTauriRuntime || !params.cwd) {
    params.applyBrowserStore(params.browserStoreRef.current, params.preferredThreadId);
    return;
  }
  params.setLoading(true);
  try {
    const items = await params.invokeFn<ThreadListItem[]>("thread_list", {
      cwd: params.cwd,
      projectPath: params.projectPath || undefined,
    });
    startTransition(() => {
      params.setThreadItems(items);
    });
    const visibleItems = filterThreadListByProject(items, params.projectPath);
    const nextId =
      (params.preferredThreadId && visibleItems.some((item) => item.thread.threadId === params.preferredThreadId) ? params.preferredThreadId : "") ||
      (params.activeThreadId && visibleItems.some((item) => item.thread.threadId === params.activeThreadId) ? params.activeThreadId : "") ||
      visibleItems[0]?.thread.threadId ||
      "";
    if (nextId) {
      await params.loadThread(nextId);
    } else {
      params.setActiveThread(null);
      params.setActiveThreadId("");
      params.setSelectedAgentId("");
      params.setSelectedAgentDetail(null);
      params.setSelectedFilePath("");
      params.setSelectedFileDiff("");
    }
  } catch (error) {
    params.onError(error instanceof Error ? error.message : String(error ?? "Unknown error"));
  } finally {
    params.setLoading(false);
  }
}

export async function refreshThreadStateSilently(params: RefreshCurrentThreadParams): Promise<RefreshThreadStateResult> {
  const normalizedThreadId = String(params.threadId ?? "").trim();
  if (!normalizedThreadId || !params.hasTauriRuntime || !params.cwd) {
    return { ok: false, refreshedAt: new Date().toISOString() } satisfies RefreshThreadStateResult;
  }
  try {
    const snapshot = await params.invokeFn<ThreadRuntimeSnapshot>("thread_runtime_snapshot", {
      cwd: params.cwd,
      threadId: normalizedThreadId,
    });
    let detail: ThreadDetail;
    if (canReuseCurrentDetailForSnapshot(params.currentDetail, snapshot)) {
      detail = mergeSnapshotIntoThreadDetail(params.currentDetail!, snapshot);
    } else if (
      params.currentDetail
      && params.currentDetail.thread.threadId === normalizedThreadId
      && snapshot.messageCount >= params.currentDetail.messages.length
    ) {
      const delta = await params.invokeFn<ThreadMessageDelta>("thread_message_delta", {
        cwd: params.cwd,
        threadId: normalizedThreadId,
        afterCount: params.currentDetail.messages.length,
      });
      detail = delta.resetRequired || delta.totalCount < params.currentDetail.messages.length
        ? await params.invokeFn<ThreadDetail>("thread_load", {
            cwd: params.cwd,
            threadId: normalizedThreadId,
          })
        : mergeSnapshotIntoThreadDetail(
            mergeMessageDeltaIntoThreadDetail(params.currentDetail, delta),
            snapshot,
          );
    } else {
      detail = await params.invokeFn<ThreadDetail>("thread_load", {
        cwd: params.cwd,
        threadId: normalizedThreadId,
      });
    }
    const persistedCoordination = await params.hydratePersistedCoordination(normalizedThreadId);
    const nextDetail = detail ? withTaskCoordination(withDerivedWorkflow(detail), persistedCoordination) : null;
    if (!nextDetail) {
      return {
        ok: false,
        refreshedAt: new Date().toISOString(),
      } satisfies RefreshThreadStateResult;
    }
    startTransition(() => {
      params.setThreadItems((current) => {
        const nextItem = toThreadListItem(nextDetail);
        let found = false;
        const nextItems = current.map((item) => {
          if (item.thread.threadId !== normalizedThreadId) {
            return item;
          }
          found = true;
          return nextItem;
        });
        return found ? nextItems : [nextItem, ...current];
      });
      params.setActiveThread(nextDetail);
      params.setActiveThreadId(nextDetail.thread.threadId);
    });
    syncSelectedState({
      detail: nextDetail,
      selectedAgentIdsByThread: params.selectedAgentIdsByThread,
      selectedFilePathsByThread: params.selectedFilePathsByThread,
      rememberSelectedAgent: params.rememberSelectedAgent,
      rememberSelectedFile: params.rememberSelectedFile,
    });
    return {
      ok: true,
      refreshedAt: new Date().toISOString(),
    } satisfies RefreshThreadStateResult;
  } catch {
    return {
      ok: false,
      refreshedAt: new Date().toISOString(),
    } satisfies RefreshThreadStateResult;
  }
}

export async function refreshThreadListSilently(params: RefreshThreadListSilentlyParams) {
  if (!params.hasTauriRuntime || !params.cwd) {
    return;
  }
  try {
    const items = await params.invokeFn<ThreadListItem[]>("thread_list", {
      cwd: params.cwd,
      projectPath: params.projectPath || undefined,
    });
    startTransition(() => {
      params.setThreadItems(items);
    });
  } catch {
    // silent by design
  }
}
