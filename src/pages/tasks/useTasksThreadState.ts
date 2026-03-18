import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgenticAction } from "../../features/orchestration/agentic/actionBus";
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
import { THREAD_DETAIL_TABS, THREAD_ROLE_LABELS } from "./threadTypes";

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

const ROLE_STUDIO_ID: Record<ThreadRoleId, string> = {
  explorer: "pm_planner",
  reviewer: "pm_feasibility_critic",
  worker: "client_programmer",
  qa: "qa_engineer",
};

const BROWSER_STORE_KEY = "rail.tasks.browser-state.v4";

function parseTaggedRoles(input: string): ThreadRoleId[] {
  const matches = String(input ?? "").toLowerCase().match(/@(explorer|reviewer|worker|qa)\b/g) ?? [];
  return [...new Set(matches.map((entry) => entry.replace(/^@/, "") as ThreadRoleId))];
}

function truncateTitle(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "NEW THREAD";
  return trimmed.length > 52 ? `${trimmed.slice(0, 52)}…` : trimmed;
}

function defaultRunRoles(detail: ThreadDetail, taggedRoles: ThreadRoleId[]): ThreadRoleId[] {
  if (taggedRoles.length > 0) {
    return taggedRoles.filter((roleId) => detail.agents.some((agent) => agent.roleId === roleId));
  }
  return detail.agents.length > 0 ? detail.agents.map((agent) => agent.roleId) : ["worker"];
}

function rolePrompt(detail: ThreadDetail, roleId: ThreadRoleId, prompt: string): string {
  const goal = String(detail.task.goal ?? "").trim();
  const userPrompt = String(prompt ?? "").trim() || goal;
  if (roleId === "explorer") {
    return `${userPrompt}\n\nFocus: inspect the repo, locate relevant files, and summarize root cause and constraints.`;
  }
  if (roleId === "reviewer") {
    return `${userPrompt}\n\nFocus: review risks, edge cases, architecture impact, and likely regressions.`;
  }
  if (roleId === "qa") {
    return `${userPrompt}\n\nFocus: define validation steps, regression checks, and test coverage gaps.`;
  }
  return `${userPrompt}\n\nFocus: implement the requested change safely and summarize modified files.`;
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

function toThreadListItem(detail: ThreadDetail): ThreadListItem {
  return {
    thread: detail.thread,
    agentCount: detail.agents.length,
    pendingApprovalCount: detail.approvals.filter((approval) => approval.status === "pending").length,
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
    findings: "Repo scan pending.",
    plan: "1. Create or select the right agents\n2. Gather repo context\n3. Review changed files and diff\n4. Synthesize the answer",
    patch: "No patch yet.",
    validation: "Validation pending.",
    handoff: `Artifacts live under .rail/tasks/${taskId}/...`,
  };
}

function buildBrowserThread(cwd: string, prompt: string, model: string, reasoning: string, accessMode: string): ThreadDetail {
  const createdAt = nowIso();
  const threadId = nextId("thread");
  const taskId = nextId("task");
  return {
    thread: {
      threadId,
      taskId,
      title: truncateTitle(prompt),
      userPrompt: prompt,
      status: "idle",
      cwd,
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
      team: "custom",
      isolationRequested: "auto",
      isolationResolved: "current-repo",
      status: "active",
      workspacePath: cwd,
      worktreePath: cwd,
      branchName: "main",
      fallbackReason: null,
      createdAt,
      updatedAt: createdAt,
      roles: [],
      prompts: [],
    },
    messages: [],
    agents: [],
    approvals: [],
    agentDetail: null,
    artifacts: buildBrowserArtifacts(taskId, prompt),
    changedFiles: [],
    validationState: "pending",
    riskLevel: "medium",
    files: buildBrowserFiles(),
  };
}

function buildBrowserAgentDetail(detail: ThreadDetail, agent: BackgroundAgentRecord): ThreadAgentDetail {
  const lastUserMessage = [...detail.messages].reverse().find((message) => message.role === "user");
  return {
    agent,
    studioRoleId: ROLE_STUDIO_ID[agent.roleId],
    lastPrompt: lastUserMessage?.content ?? null,
    lastPromptAt: lastUserMessage?.createdAt ?? null,
    lastRunId: `${detail.thread.threadId}:${agent.roleId}`,
    artifactPaths: Object.keys(detail.artifacts).map((key) => `.rail/tasks/${detail.task.taskId}/${key}.md`),
    worktreePath: detail.task.worktreePath || detail.task.workspacePath,
  };
}

function browserPreviewContent(path: string): string {
  return ["// Browser preview", `// ${path}`, "", "This preview is generated for TASKS browser verification."].join("\n");
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

function roleSummary(roleId: ThreadRoleId): string {
  if (roleId === "explorer") return "Mapping the repo and identifying relevant files.";
  if (roleId === "reviewer") return "Reviewing risks, tradeoffs, and likely regressions.";
  if (roleId === "qa") return "Preparing validation steps and regression checks.";
  return "Preparing an implementation plan and likely code changes.";
}

function roleDiscussionLine(roleId: ThreadRoleId): string {
  if (roleId === "explorer") return "EXPLORER: I am exploring the repo structure and tracing entry points.";
  if (roleId === "reviewer") return "REVIEWER: I am comparing options and highlighting architectural risks.";
  if (roleId === "qa") return "QA: I am drafting validation coverage and regression checks.";
  return "WORKER: I am mapping the implementation path and likely file edits.";
}

export function useTasksThreadState(params: Params) {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
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
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [selectedFileDiff, setSelectedFileDiff] = useState("");
  const browserStoreRef = useRef<BrowserStore>(loadBrowserStore());

  const applyBrowserStore = useCallback(
    (store: BrowserStore, preferredThreadId?: string) => {
      browserStoreRef.current = store;
      persistBrowserStore(store);
      const items = store.order.map((threadId) => store.details[threadId]).filter(Boolean).map(toThreadListItem);
      setThreads(items);
      const nextId =
        (preferredThreadId && store.details[preferredThreadId] ? preferredThreadId : "") ||
        (activeThreadId && store.details[activeThreadId] ? activeThreadId : "") ||
        store.order[0] ||
        "";
      if (!nextId) {
        setActiveThread(null);
        setActiveThreadId("");
        setSelectedAgentId("");
        setSelectedAgentDetail(null);
        setSelectedFilePath("");
        setSelectedFileContent("");
        setSelectedFileDiff("");
        return null;
      }
      const detail = store.details[nextId];
      setActiveThread(detail);
      setActiveThreadId(nextId);
      setSelectedAgentId((current) => (current && detail.agents.some((agent) => agent.id === current) ? current : defaultSelectedAgent(detail)));
      setSelectedFilePath((current) => (current && detail.files.some((file) => file.path === current) ? current : defaultSelectedFile(detail)));
      return detail;
    },
    [activeThreadId],
  );

  const loadThread = useCallback(
    async (threadId: string) => {
      if (!threadId) {
        setActiveThread(null);
        setSelectedAgentId("");
        setSelectedAgentDetail(null);
        setSelectedFilePath("");
        setSelectedFileContent("");
        setSelectedFileDiff("");
        return null;
      }
      if (!params.hasTauriRuntime || !params.cwd) {
        const detail = browserStoreRef.current.details[threadId] ?? null;
        if (!detail) {
          return applyBrowserStore(browserStoreRef.current);
        }
        setActiveThread(detail);
        setActiveThreadId(detail.thread.threadId);
        setSelectedAgentId((current) => (current && detail.agents.some((agent) => agent.id === current) ? current : defaultSelectedAgent(detail)));
        setSelectedFilePath((current) => (current && detail.files.some((file) => file.path === current) ? current : defaultSelectedFile(detail)));
        return detail;
      }
      try {
        const detail = await params.invokeFn<ThreadDetail>("thread_load", { cwd: params.cwd, threadId });
        setActiveThread(detail);
        setActiveThreadId(detail.thread.threadId);
        setSelectedAgentId((current) => current || defaultSelectedAgent(detail));
        setSelectedFilePath((current) => current || defaultSelectedFile(detail));
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
    [applyBrowserStore, params],
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
        setThreads(items);
        const nextId =
          (preferredThreadId && items.some((item) => item.thread.threadId === preferredThreadId) ? preferredThreadId : "") ||
          (activeThreadId && items.some((item) => item.thread.threadId === activeThreadId) ? activeThreadId : "") ||
          items[0]?.thread.threadId ||
          "";
        if (nextId) {
          await loadThread(nextId);
        } else {
          setActiveThread(null);
          setActiveThreadId("");
          setSelectedAgentId("");
          setSelectedAgentDetail(null);
          setSelectedFilePath("");
          setSelectedFileContent("");
          setSelectedFileDiff("");
        }
      } catch (error) {
        params.setStatus(`Failed to load threads: ${formatError(error)}`);
      } finally {
        setLoading(false);
      }
    },
    [activeThreadId, applyBrowserStore, loadThread, params],
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
    if (!activeThread || !selectedAgentId) {
      setSelectedAgentDetail(null);
      return;
    }
    if (!params.hasTauriRuntime || !params.cwd) {
      const agent = activeThread.agents.find((entry) => entry.id === selectedAgentId) ?? null;
      setSelectedAgentDetail(agent ? buildBrowserAgentDetail(activeThread, agent) : null);
      return;
    }
    void params
      .invokeFn<ThreadAgentDetail>("thread_open_agent_detail", {
        cwd: params.cwd,
        threadId: activeThread.thread.threadId,
        agentId: selectedAgentId,
      })
      .then(setSelectedAgentDetail)
      .catch((error) => {
        setSelectedAgentDetail(null);
        params.setStatus(`Failed to load agent detail: ${formatError(error)}`);
      });
  }, [activeThread, params, selectedAgentId]);

  useEffect(() => {
    if (!activeThread || !selectedFilePath) {
      setSelectedFileContent("");
      setSelectedFileDiff("");
      return;
    }
    if (!params.hasTauriRuntime || !params.cwd) {
      setSelectedFileContent(browserPreviewContent(selectedFilePath));
      setSelectedFileDiff(browserDiffContent(selectedFilePath));
      return;
    }
    const base = String(activeThread.task.workspacePath ?? "").trim().replace(/[\/]+$/, "");
    const fullPath = `${base}/${selectedFilePath}`;
    void params.invokeFn<string>("workspace_read_text", { path: fullPath }).then(setSelectedFileContent).catch(() => setSelectedFileContent(""));
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

  const openNewThread = useCallback(async () => {
    setComposerDraft("");
    setSelectedAgentId("");
    setSelectedAgentDetail(null);
    setSelectedFilePath("");
    setSelectedFileContent("");
    setSelectedFileDiff("");
    setDetailTab("files");
    if (!params.hasTauriRuntime || !params.cwd) {
      const store = cloneStore(browserStoreRef.current);
      const detail = buildBrowserThread(params.cwd || "/workspace", "", model, reasoning, accessMode);
      store.details[detail.thread.threadId] = detail;
      store.order = [detail.thread.threadId, ...store.order.filter((id) => id !== detail.thread.threadId)];
      applyBrowserStore(store, detail.thread.threadId);
      params.setStatus(`Thread created: ${detail.thread.title}`);
      return;
    }
    try {
      const detail = await params.invokeFn<ThreadDetail>("thread_create", {
        cwd: params.cwd,
        prompt: "NEW THREAD",
        mode: "balanced",
        team: "custom",
        isolation: "auto",
        model,
        reasoning,
        accessMode,
      });
      setActiveThread(detail);
      setActiveThreadId(detail.thread.threadId);
      setSelectedAgentId(defaultSelectedAgent(detail));
      setSelectedFilePath(defaultSelectedFile(detail));
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
  }, [accessMode, applyBrowserStore, model, params, reasoning, reloadThreads]);

  const selectThread = useCallback(async (threadId: string) => {
    setSelectedAgentId("");
    setSelectedFilePath("");
    await loadThread(threadId);
  }, [loadThread]);

  const dispatchRunRoles = useCallback(
    async (detail: ThreadDetail, prompt: string, roles: ThreadRoleId[]) => {
      for (const roleId of roles) {
        params.publishAction({
          type: "run_role",
          payload: {
            roleId: ROLE_STUDIO_ID[roleId],
            taskId: detail.task.taskId,
            prompt: rolePrompt(detail, roleId, prompt),
            sourceTab: "tasks-thread",
          },
        });
      }
    },
    [params],
  );

  const submitComposer = useCallback(async () => {
    const prompt = composerDraft.trim();
    if (!prompt) {
      return;
    }

    if (!params.hasTauriRuntime || !params.cwd) {
      const store = cloneStore(browserStoreRef.current);
      const existingDetail = activeThread ? store.details[activeThread.thread.threadId] : undefined;
      const detail: ThreadDetail = existingDetail ?? buildBrowserThread(params.cwd || "/workspace", prompt, model, reasoning, accessMode);
      if (!existingDetail) {
        store.details[detail.thread.threadId] = detail;
        store.order = [detail.thread.threadId, ...store.order.filter((id) => id !== detail.thread.threadId)];
      }
      const timestamp = nowIso();
      detail.thread.title = truncateTitle(detail.thread.userPrompt ? detail.thread.title : prompt);
      detail.thread.userPrompt = detail.thread.userPrompt || prompt;
      detail.thread.status = "running";
      detail.thread.updatedAt = timestamp;
      detail.thread.model = model;
      detail.thread.reasoning = reasoning;
      detail.thread.accessMode = accessMode;
      detail.task.goal = detail.task.goal === "NEW THREAD" ? prompt : detail.task.goal;
      detail.task.updatedAt = timestamp;
      detail.messages.push({
        id: nextId("msg"),
        threadId: detail.thread.threadId,
        role: "user",
        content: prompt,
        createdAt: timestamp,
      });
      const taggedRoles = parseTaggedRoles(prompt);
      const rolesToRun = taggedRoles.length > 0 ? taggedRoles : detail.agents.map((agent) => agent.roleId);
      const finalRoles: ThreadRoleId[] = rolesToRun.length > 0 ? rolesToRun : ["worker"];
      for (const roleId of finalRoles) {
        if (!detail.agents.some((agent) => agent.roleId === roleId)) {
          detail.agents.push({
            id: `${detail.thread.threadId}:${roleId}`,
            threadId: detail.thread.threadId,
            label: THREAD_ROLE_LABELS[roleId],
            roleId,
            status: "idle",
            summary: roleSummary(roleId),
            worktreePath: detail.task.worktreePath || detail.task.workspacePath,
            lastUpdatedAt: timestamp,
          });
          detail.messages.push({
            id: nextId("msg"),
            threadId: detail.thread.threadId,
            role: "assistant",
            content: `Created ${THREAD_ROLE_LABELS[roleId]} with instructions: ${rolePrompt(detail, roleId, prompt)}`,
            createdAt: timestamp,
          });
        }
      }
      detail.agents = detail.agents.map((agent, index) => {
        if (!finalRoles.includes(agent.roleId)) {
          return { ...agent, status: "idle", lastUpdatedAt: timestamp };
        }
        return {
          ...agent,
          status: index === 0 ? "thinking" : "awaiting_approval",
          summary: roleSummary(agent.roleId),
          lastUpdatedAt: timestamp,
        };
      });
      for (const roleId of finalRoles) {
        detail.messages.push({
          id: nextId("msg"),
          threadId: detail.thread.threadId,
          role: "assistant",
          content: roleDiscussionLine(roleId),
          createdAt: timestamp,
        });
      }
      if (finalRoles.length > 1) {
        const sourceRole = finalRoles[0];
        const targetRole = finalRoles[1] as ThreadRoleId;
        detail.approvals = [
          {
            id: nextId("approval"),
            threadId: detail.thread.threadId,
            agentId: `${detail.thread.threadId}:${sourceRole}`,
            kind: "handoff",
            summary: `Approve handoff from ${THREAD_ROLE_LABELS[sourceRole]} to ${THREAD_ROLE_LABELS[targetRole]}.`,
            payload: {
              targetRole,
              prompt: `Continue the thread based on ${THREAD_ROLE_LABELS[sourceRole]}'s findings: ${prompt}`,
            },
            status: "pending",
            createdAt: timestamp,
            updatedAt: null,
          },
        ];
      }
      detail.messages.push({
        id: nextId("msg"),
        threadId: detail.thread.threadId,
        role: "assistant",
        content: `${finalRoles.length} background agents are running now. I will wait for their updates and then synthesize the answer into one response.`,
        createdAt: timestamp,
      });
      detail.changedFiles = ["src/pages/tasks/TasksPage.tsx", "src/pages/tasks/useTasksThreadState.ts"];
      detail.files = buildBrowserFiles();
      detail.validationState = finalRoles.includes("qa") ? "in review" : "pending";
      detail.riskLevel = finalRoles.includes("reviewer") ? "reviewing" : "medium";
      detail.artifacts = {
        ...detail.artifacts,
        brief: prompt,
        findings: finalRoles.map((roleId) => `${THREAD_ROLE_LABELS[roleId]}: ${roleSummary(roleId)}`).join("\n"),
        plan: `1. Run ${finalRoles.map((roleId) => THREAD_ROLE_LABELS[roleId]).join(", ")}\n2. Review files\n3. Confirm approval\n4. Synthesize answer`,
      };
      store.details[detail.thread.threadId] = detail;
      applyBrowserStore(store, detail.thread.threadId);
      setSelectedAgentId(`${detail.thread.threadId}:${finalRoles[0]}`);
      setSelectedFilePath(detail.changedFiles[0] ?? defaultSelectedFile(detail));
      setComposerDraft("");
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "user",
        level: "info",
        message: `Thread ${detail.thread.threadId} · ${finalRoles.map((roleId) => THREAD_ROLE_LABELS[roleId]).join(", ")} dispatched`,
      });
      params.setStatus(`Thread updated: ${truncateTitle(detail.thread.title)}`);
      return;
    }

    try {
      let detail = activeThread;
      if (!detail) {
        detail = await params.invokeFn<ThreadDetail>("thread_create", {
          cwd: params.cwd,
          prompt,
          mode: "balanced",
          team: "custom",
          isolation: "auto",
          model,
          reasoning,
          accessMode,
        });
        setActiveThread(detail);
        setActiveThreadId(detail.thread.threadId);
        await reloadThreads(detail.thread.threadId);
      } else {
        detail = await params.invokeFn<ThreadDetail>("thread_append_message", {
          cwd: params.cwd,
          threadId: detail.thread.threadId,
          role: "user",
          content: prompt,
        });
        setActiveThread(detail);
      }

      const taggedRoles = parseTaggedRoles(prompt);
      for (const roleId of taggedRoles) {
        if (!detail.agents.some((agent) => agent.roleId === roleId)) {
          detail = await params.invokeFn<ThreadDetail>("thread_add_agent", {
            cwd: params.cwd,
            threadId: detail.thread.threadId,
            roleId,
            label: THREAD_ROLE_LABELS[roleId],
          });
        }
      }
      const rolesToRun = defaultRunRoles(detail, taggedRoles);
      if (rolesToRun.length === 0) {
        setActiveThread(detail);
        await reloadThreads(detail.thread.threadId);
        params.setStatus("No agents selected. Add an agent or use @explorer, @reviewer, @worker, or @qa.");
        return;
      }
      const spawned = await params.invokeFn<ThreadDetail>("thread_spawn_agents", {
        cwd: params.cwd,
        threadId: detail.thread.threadId,
        prompt,
        roles: rolesToRun,
      });
      setActiveThread(spawned);
      setActiveThreadId(spawned.thread.threadId);
      setSelectedAgentId((current) => current || defaultSelectedAgent(spawned));
      setSelectedFilePath((current) => current || defaultSelectedFile(spawned));
      await reloadThreads(spawned.thread.threadId);
      await dispatchRunRoles(spawned, prompt, rolesToRun);
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "user",
        level: "info",
        message: `Thread ${spawned.thread.threadId} · ${rolesToRun.map((roleId) => THREAD_ROLE_LABELS[roleId]).join(", ")} dispatched`,
      });
      params.setStatus(`Thread updated: ${truncateTitle(spawned.thread.title)}`);
      setComposerDraft("");
    } catch (error) {
      params.setStatus(`Thread submit failed: ${formatError(error)}`);
      params.appendWorkspaceEvent({
        source: "tasks-thread",
        actor: "system",
        level: "error",
        message: `Thread submit failed: ${formatError(error)}`,
      });
    }
  }, [accessMode, activeThread, applyBrowserStore, composerDraft, dispatchRunRoles, model, params, reasoning, reloadThreads]);

  const openAgent = useCallback(
    async (agent: BackgroundAgentRecord) => {
      setSelectedAgentId(agent.id);
      setDetailTab("agent");
      if (!activeThread) return;
      if (!params.hasTauriRuntime || !params.cwd) {
        setSelectedAgentDetail(buildBrowserAgentDetail(activeThread, agent));
        return;
      }
      try {
        const detail = await params.invokeFn<ThreadAgentDetail>("thread_open_agent_detail", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          agentId: agent.id,
        });
        setSelectedAgentDetail(detail);
      } catch (error) {
        params.setStatus(`Failed to open agent: ${formatError(error)}`);
      }
    },
    [activeThread, params],
  );

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
          detail.messages.push({
            id: nextId("msg"),
            threadId: detail.thread.threadId,
            role: "assistant",
            content: `Approval granted. ${THREAD_ROLE_LABELS[targetRole]} is continuing the work.`,
            createdAt: timestamp,
          });
        } else {
          detail.messages.push({
            id: nextId("msg"),
            threadId: detail.thread.threadId,
            role: "assistant",
            content: "Approval rejected. Waiting for a new direction.",
            createdAt: timestamp,
          });
        }
        detail.thread.updatedAt = timestamp;
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        return;
      }
      try {
        let detail = await params.invokeFn<ThreadDetail>("thread_resolve_approval", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          approvalId: approval.id,
          decision,
        });
        setActiveThread(detail);
        await reloadThreads(detail.thread.threadId);
        if (decision === "approved") {
          const payload = approval.payload ?? {};
          const targetRole = String(payload.targetRole ?? "").trim() as ThreadRoleId;
          const followupPrompt = String(payload.prompt ?? "").trim();
          if (targetRole && followupPrompt) {
            detail = await params.invokeFn<ThreadDetail>("thread_spawn_agents", {
              cwd: params.cwd,
              threadId: detail.thread.threadId,
              prompt: followupPrompt,
              roles: [targetRole],
            });
            setActiveThread(detail);
            await reloadThreads(detail.thread.threadId);
            await dispatchRunRoles(detail, followupPrompt, [targetRole]);
          }
        }
      } catch (error) {
        params.setStatus(`Failed to resolve approval: ${formatError(error)}`);
      }
    },
    [activeThread, applyBrowserStore, dispatchRunRoles, params, reloadThreads],
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
          setSelectedFileContent("");
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
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        params.setStatus("Agent updated");
        return;
      }
      try {
        const detail = await params.invokeFn<ThreadDetail>("thread_update_agent", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          agentId,
          label,
        });
        setActiveThread(detail);
        await reloadThreads(detail.thread.threadId);
        params.setStatus("Agent updated");
      } catch (error) {
        params.setStatus(`Failed to update agent: ${formatError(error)}`);
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
        detail.agents = detail.agents.filter((agent) => agent.id !== agentId);
        if (selectedAgentId === agentId) {
          setSelectedAgentId("");
          setSelectedAgentDetail(null);
        }
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        params.setStatus("Agent removed");
        return;
      }
      try {
        const detail = await params.invokeFn<ThreadDetail>("thread_remove_agent", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          agentId,
        });
        setActiveThread(detail);
        setSelectedAgentId((current) => (current === agentId ? "" : current));
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
            summary: roleSummary(roleId),
            worktreePath: detail.task.worktreePath || detail.task.workspacePath,
            lastUpdatedAt: nowIso(),
          });
          detail.messages.push({
            id: nextId("msg"),
            threadId: detail.thread.threadId,
            role: "assistant",
            content: `Added ${THREAD_ROLE_LABELS[roleId]} to this thread.`,
            createdAt: nowIso(),
          });
        }
        store.details[detail.thread.threadId] = detail;
        applyBrowserStore(store, detail.thread.threadId);
        setSelectedAgentId(`${detail.thread.threadId}:${roleId}`);
        setDetailTab("agent");
        params.setStatus(`Agent added: ${THREAD_ROLE_LABELS[roleId]}`);
        return;
      }
      try {
        const detail = await params.invokeFn<ThreadDetail>("thread_add_agent", {
          cwd: params.cwd,
          threadId: activeThread.thread.threadId,
          roleId,
          label,
        });
        setActiveThread(detail);
        setSelectedAgentId(`${detail.thread.threadId}:${roleId}`);
        setDetailTab("agent");
        await reloadThreads(detail.thread.threadId);
        params.setStatus(`Agent added: ${THREAD_ROLE_LABELS[roleId]}`);
      } catch (error) {
        params.setStatus(`Failed to add agent: ${formatError(error)}`);
      }
    },
    [activeThread, applyBrowserStore, params, reloadThreads],
  );

  return {
    loading,
    threads,
    activeThread,
    activeThreadId,
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
    selectedFileContent,
    selectedFileDiff,
    setSelectedFilePath,
    openNewThread,
    selectThread,
    submitComposer,
    openAgent,
    resolveApproval,
    deleteThread,
    addAgent,
    updateAgent,
    removeAgent,
  };
}
