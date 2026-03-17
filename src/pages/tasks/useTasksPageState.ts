import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgenticAction } from "../../features/orchestration/agentic/actionBus";
import {
  TASK_ROLE_LABELS,
  TASK_ROLE_ORDER,
  type TaskArtifactKey,
  type TaskComposerTarget,
  type TaskDetail,
  type TaskIsolation,
  type TaskListItem,
  type TaskMode,
  type TaskRecord,
  type TaskRoleId,
  type TaskTeam,
} from "./taskTypes";

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

type CreateTaskInput = {
  goal: string;
  mode: TaskMode;
  team: TaskTeam;
  isolation: TaskIsolation;
};

const ROLE_STUDIO_ID: Record<TaskRoleId, string> = {
  explorer: "pm_planner",
  reviewer: "pm_feasibility_critic",
  worker: "client_programmer",
  qa: "qa_engineer",
};

function activeRoles(task: TaskRecord): TaskRoleId[] {
  return TASK_ROLE_ORDER.filter((roleId) => task.roles.find((role) => role.id === roleId)?.enabled);
}

function rolePrompt(task: TaskRecord, roleId: TaskRoleId, prompt?: string): string {
  const goal = String(task.goal ?? "").trim();
  const extra = String(prompt ?? "").trim();
  const base = extra || goal;
  if (roleId === "explorer") {
    return `${base}\n\nFocus: inspect the repo, locate the relevant files, and summarize root cause and constraints.`;
  }
  if (roleId === "reviewer") {
    return `${base}\n\nFocus: review risks, edge cases, architecture impact, and likely regressions.`;
  }
  if (roleId === "qa") {
    return `${base}\n\nFocus: define validation steps, regression checks, and test coverage gaps.`;
  }
  return `${base}\n\nFocus: implement the requested change safely and summarize modified files.`;
}

function defaultArtifactDraft(detail: TaskDetail | null, key: TaskArtifactKey): string {
  return detail?.artifacts?.[key] ?? `# ${key.toUpperCase()}\n\n`;
}

export function useTasksPageState(params: Params) {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeTask, setActiveTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createInput, setCreateInput] = useState<CreateTaskInput>({
    goal: "",
    mode: "balanced",
    team: "full-squad",
    isolation: "auto",
  });
  const [artifactKey, setArtifactKey] = useState<TaskArtifactKey>("brief");
  const [artifactDraft, setArtifactDraft] = useState("# BRIEF\n\n");
  const [composerTarget, setComposerTarget] = useState<TaskComposerTarget>("all");
  const [composerDraft, setComposerDraft] = useState("");

  const reloadTasks = useCallback(async (preferredTaskId?: string) => {
    if (!params.hasTauriRuntime || !params.cwd) {
      setTasks([]);
      setActiveTask(null);
      setActiveTaskId("");
      return;
    }
    setLoading(true);
    try {
      const nextTasks = await params.invokeFn<TaskListItem[]>("task_list", { cwd: params.cwd });
      setTasks(nextTasks);
      const nextActiveId =
        (preferredTaskId && nextTasks.some((item) => item.record.taskId === preferredTaskId) ? preferredTaskId : "") ||
        (activeTaskId && nextTasks.some((item) => item.record.taskId === activeTaskId) ? activeTaskId : "") ||
        nextTasks[0]?.record.taskId ||
        "";
      setActiveTaskId(nextActiveId);
      if (nextActiveId) {
        const detail = await params.invokeFn<TaskDetail>("task_load", { cwd: params.cwd, taskId: nextActiveId });
        setActiveTask(detail);
      } else {
        setActiveTask(null);
      }
    } finally {
      setLoading(false);
    }
  }, [activeTaskId, params]);

  const reloadActiveTask = useCallback(async (taskId = activeTaskId) => {
    if (!params.hasTauriRuntime || !params.cwd || !taskId) {
      setActiveTask(null);
      return;
    }
    const detail = await params.invokeFn<TaskDetail>("task_load", { cwd: params.cwd, taskId });
    setActiveTask(detail);
  }, [activeTaskId, params]);

  useEffect(() => {
    void reloadTasks();
  }, [reloadTasks]);

  useEffect(() => {
    setArtifactDraft(defaultArtifactDraft(activeTask, artifactKey));
  }, [activeTask, artifactKey]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: string }>).detail;
      void reloadTasks(detail?.taskId);
    };
    window.addEventListener("rail:task-updated", handler as EventListener);
    return () => window.removeEventListener("rail:task-updated", handler as EventListener);
  }, [reloadTasks]);

  const groupedTasks = useMemo(() => {
    return {
      active: tasks.filter((item) => item.record.status === "active"),
      queued: tasks.filter((item) => item.record.status === "queued"),
      completed: tasks.filter((item) => item.record.status === "completed"),
    };
  }, [tasks]);

  const enabledRoleTargets = useMemo(() => {
    const roles = activeTask ? activeRoles(activeTask.record) : [];
    return ["all", ...roles] as TaskComposerTarget[];
  }, [activeTask]);

  const runPromptForRole = useCallback(async (task: TaskRecord, roleId: TaskRoleId, promptText: string) => {
    await params.invokeFn("task_send_prompt", {
      cwd: params.cwd,
      taskId: task.taskId,
      target: roleId,
      prompt: promptText,
    });
    params.publishAction({
      type: "run_role",
      payload: {
        roleId: ROLE_STUDIO_ID[roleId],
        taskId: task.taskId,
        prompt: promptText,
        sourceTab: "tasks",
      },
    });
    params.appendWorkspaceEvent({
      source: "tasks",
      actor: "user",
      level: "info",
      message: `TASK ${task.taskId} · ${TASK_ROLE_LABELS[roleId]} 실행`,
    });
  }, [params]);

  const createTask = useCallback(async () => {
    if (!params.hasTauriRuntime || !params.cwd) {
      return;
    }
    const goal = createInput.goal.trim();
    if (!goal) {
      params.setStatus("TASK 목표를 먼저 입력하세요.");
      return;
    }
    setLoading(true);
    try {
      const created = await params.invokeFn<TaskDetail>("task_create", {
        cwd: params.cwd,
        goal,
        mode: createInput.mode,
        team: createInput.team,
        isolation: createInput.isolation,
      });
      setIsCreateModalOpen(false);
      setCreateInput((current) => ({ ...current, goal: "" }));
      setActiveTaskId(created.record.taskId);
      setActiveTask(created);
      await reloadTasks(created.record.taskId);
      for (const roleId of activeRoles(created.record)) {
        await runPromptForRole(created.record, roleId, rolePrompt(created.record, roleId));
      }
      await reloadTasks(created.record.taskId);
      params.setStatus(`TASK 생성: ${created.record.taskId}`);
    } finally {
      setLoading(false);
    }
  }, [createInput, params, reloadTasks, runPromptForRole]);

  const sendComposer = useCallback(async () => {
    if (!activeTask || !composerDraft.trim()) {
      return;
    }
    const targets = composerTarget === "all" ? activeRoles(activeTask.record) : [composerTarget];
    for (const roleId of targets) {
      await runPromptForRole(activeTask.record, roleId, rolePrompt(activeTask.record, roleId, composerDraft));
    }
    setComposerDraft("");
    await reloadTasks(activeTask.record.taskId);
  }, [activeTask, composerDraft, composerTarget, reloadTasks, runPromptForRole]);

  const saveArtifact = useCallback(async () => {
    if (!activeTask) {
      return;
    }
    const detail = await params.invokeFn<TaskDetail>("task_update_artifact", {
      cwd: params.cwd,
      taskId: activeTask.record.taskId,
      artifact: artifactKey,
      content: artifactDraft,
    });
    setActiveTask(detail);
    setArtifactDraft(defaultArtifactDraft(detail, artifactKey));
    await reloadTasks(activeTask.record.taskId);
    params.setStatus(`TASK ${activeTask.record.taskId} · ${artifactKey.toUpperCase()} 저장`);
  }, [activeTask, artifactDraft, artifactKey, params, reloadTasks]);

  const markTaskStatus = useCallback(async (status: "active" | "queued" | "completed" | "archived") => {
    if (!activeTask) {
      return;
    }
    const detail = await params.invokeFn<TaskDetail>(status === "archived" ? "task_archive" : "task_mark_status", {
      cwd: params.cwd,
      taskId: activeTask.record.taskId,
      ...(status === "archived" ? {} : { status }),
    });
    setActiveTask(detail);
    await reloadTasks(detail.record.taskId);
  }, [activeTask, params, reloadTasks]);

  const selectTask = useCallback(async (taskId: string) => {
    setActiveTaskId(taskId);
    await reloadActiveTask(taskId);
  }, [reloadActiveTask]);

  return {
    activeTask,
    activeTaskId,
    artifactDraft,
    artifactKey,
    composerDraft,
    composerTarget,
    createInput,
    enabledRoleTargets,
    groupedTasks,
    isCreateModalOpen,
    loading,
    saveArtifact,
    sendComposer,
    selectTask,
    setArtifactDraft,
    setArtifactKey,
    setComposerDraft,
    setComposerTarget,
    setCreateInput,
    setIsCreateModalOpen,
    createTask,
    markTaskStatus,
  };
}
