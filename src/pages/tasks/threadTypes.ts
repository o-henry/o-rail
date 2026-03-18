import type { TaskRecord } from "./taskTypes";

export type ThreadRoleId = "explorer" | "reviewer" | "worker" | "qa";
export type ThreadMessageRole = "user" | "assistant" | "system";
export type BackgroundAgentStatus = "thinking" | "awaiting_approval" | "done" | "failed" | "idle";
export type ApprovalDecision = "approved" | "rejected";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ThreadDetailTab = "files" | "diff" | "workflow" | "agent";

export type ThreadRecord = {
  threadId: string;
  taskId: string;
  title: string;
  userPrompt: string;
  status: string;
  cwd: string;
  branchLabel?: string | null;
  accessMode: string;
  model: string;
  reasoning: string;
  createdAt: string;
  updatedAt: string;
};

export type ThreadMessage = {
  id: string;
  threadId: string;
  role: ThreadMessageRole;
  content: string;
  createdAt: string;
};

export type BackgroundAgentRecord = {
  id: string;
  threadId: string;
  label: string;
  roleId: ThreadRoleId;
  status: BackgroundAgentStatus;
  summary?: string | null;
  worktreePath?: string | null;
  lastUpdatedAt: string;
};

export type ApprovalRecord = {
  id: string;
  threadId: string;
  agentId: string;
  kind: "handoff" | "edit" | "command" | "merge" | "reply";
  summary: string;
  payload?: Record<string, unknown> | null;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt?: string | null;
};

export type ThreadFileEntry = {
  path: string;
  changed: boolean;
};

export type ThreadAgentDetail = {
  agent: BackgroundAgentRecord;
  studioRoleId?: string | null;
  lastPrompt?: string | null;
  lastPromptAt?: string | null;
  lastRunId?: string | null;
  artifactPaths: string[];
  worktreePath?: string | null;
};

export type ThreadListItem = {
  thread: ThreadRecord;
  agentCount: number;
  pendingApprovalCount: number;
};

export type ThreadDetail = {
  thread: ThreadRecord;
  task: TaskRecord;
  messages: ThreadMessage[];
  agents: BackgroundAgentRecord[];
  approvals: ApprovalRecord[];
  agentDetail?: ThreadAgentDetail | null;
  artifacts: Record<string, string>;
  changedFiles: string[];
  validationState: string;
  riskLevel: string;
  files: ThreadFileEntry[];
};

export const THREAD_ROLE_LABELS: Record<ThreadRoleId, string> = {
  explorer: "EXPLORER",
  reviewer: "REVIEWER",
  worker: "WORKER",
  qa: "QA",
};

export const THREAD_MODEL_OPTIONS = ["5.4", "5.3-Codex", "5.1-Codex-Max"] as const;
export const THREAD_REASONING_OPTIONS = ["낮음", "중간", "높음"] as const;
export const THREAD_ACCESS_OPTIONS = ["Local"] as const;
export const THREAD_DETAIL_TABS: ThreadDetailTab[] = ["files", "diff", "workflow", "agent"];
