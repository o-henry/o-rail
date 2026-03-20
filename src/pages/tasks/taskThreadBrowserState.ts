import { t as translate } from "../../i18n";
import {
  UNITY_DEFAULT_THREAD_PRESET_IDS,
  buildTaskAgentPrompt,
  getTaskAgentLabel,
  getTaskAgentStudioRoleId,
  getTaskAgentSummary,
} from "./taskAgentPresets";
import type { BackgroundAgentRecord, ThreadAgentDetail, ThreadDetail, ThreadListItem, ThreadMessage, ThreadRoleId } from "./threadTypes";
import { deriveThreadWorkflow, deriveThreadWorkflowSummary } from "./threadWorkflow";

export function truncateTitle(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return translate("tasks.thread.new");
  return trimmed.length > 52 ? `${trimmed.slice(0, 52)}…` : trimmed;
}

export function isPlaceholderTitle(input: string): boolean {
  const normalized = String(input ?? "").trim().toLowerCase();
  return !normalized || normalized === "new thread" || normalized === "새 thread" || normalized === "새 스레드";
}

export function shouldAutoReplaceTitle(currentTitle: string, currentPrompt: string): boolean {
  const title = String(currentTitle ?? "").trim();
  if (!title || isPlaceholderTitle(title)) {
    return true;
  }
  const prompt = String(currentPrompt ?? "").trim();
  return Boolean(prompt) && title === truncateTitle(prompt);
}

export function rolePrompt(detail: ThreadDetail, roleId: ThreadRoleId, prompt: string): string {
  const goal = String(detail.task.goal ?? "").trim();
  const userPrompt = String(prompt ?? "").trim() || goal;
  return buildTaskAgentPrompt(roleId, userPrompt);
}

export function defaultSelectedFile(detail: ThreadDetail | null): string {
  if (!detail) return "";
  return detail.changedFiles[0] ?? detail.files[0]?.path ?? "";
}

export function defaultSelectedAgent(detail: ThreadDetail | null): string {
  if (!detail) return "";
  return detail.agents[0]?.id ?? "";
}

export function withDerivedWorkflow(detail: ThreadDetail): ThreadDetail {
  return {
    ...detail,
    workflow: deriveThreadWorkflow(detail),
  };
}

export function toThreadListItem(detail: ThreadDetail): ThreadListItem {
  const workflow = detail.workflow ?? deriveThreadWorkflow(detail);
  return {
    thread: detail.thread,
    projectPath: detail.task.projectPath || detail.task.workspacePath,
    agentCount: detail.agents.length,
    pendingApprovalCount: detail.approvals.filter((approval) => approval.status === "pending").length,
    workflowSummary: deriveThreadWorkflowSummary({ ...detail, workflow }),
  };
}

export function buildBrowserFiles(): Array<{ path: string; changed: boolean }> {
  return [
    { path: "README.md", changed: false },
    { path: "src/pages/tasks/TasksPage.tsx", changed: true },
    { path: "src/pages/tasks/useTasksThreadState.ts", changed: true },
    { path: "src/app/MainApp.tsx", changed: false },
  ];
}

function buildBrowserArtifacts(taskId: string, prompt: string): Record<string, string> {
  const brief = prompt || translate("tasks.empty.title");
  return {
    brief,
    findings: translate("tasks.workflow.validationPending"),
    plan: "1. Brief the Unity task\n2. Capture design notes\n3. Implement and integrate\n4. Playtest and lock",
    patch: "No patch yet.",
    validation: translate("tasks.workflow.validationPending"),
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

export function createBrowserMessage(
  threadId: string,
  role: ThreadMessage["role"],
  content: string,
  createdAt: string,
  options?: Partial<Pick<ThreadMessage, "agentId" | "agentLabel" | "sourceRoleId" | "eventKind" | "artifactPath">>,
): ThreadMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
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

export function buildBrowserThread(
  storageRoot: string,
  projectPath: string,
  prompt: string,
  model: string,
  reasoning: string,
  accessMode: string,
): ThreadDetail {
  const createdAt = new Date().toISOString();
  const threadId = `thread_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  const taskId = `task_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
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
      goal: prompt || translate("tasks.thread.new"),
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

export function buildBrowserAgentDetail(detail: ThreadDetail, agent: BackgroundAgentRecord): ThreadAgentDetail {
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

export function findLatestCodexResponseJsonPath(paths: string[]): string {
  return [...paths].reverse().find((path) => /(?:^|[\\/])response\.json$/i.test(String(path ?? "").trim())) ?? "";
}

export function browserDiffContent(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,5 @@",
    "+ simulated browser fallback diff",
    "+ agent output will appear here after file integration",
  ].join("\n");
}
