export type TaskMode = "safe" | "balanced" | "fast" | "yolo";
export type TaskTeam = "solo" | "duo" | "full-squad";
export type TaskIsolation = "auto" | "current-repo" | "branch" | "worktree";
export type TaskStatus = "active" | "queued" | "completed" | "archived";
export type TaskRoleId = "explorer" | "reviewer" | "worker" | "qa";
export type TaskComposerTarget = TaskRoleId | "all";

export type TaskPromptRecord = {
  id: string;
  target: string;
  prompt: string;
  createdAt: string;
};

export type TaskRoleState = {
  id: TaskRoleId;
  label: string;
  studioRoleId: string;
  enabled: boolean;
  status: string;
  lastPrompt?: string | null;
  lastPromptAt?: string | null;
  lastRunId?: string | null;
  artifactPaths: string[];
  updatedAt: string;
};

export type TaskRecord = {
  taskId: string;
  goal: string;
  mode: TaskMode | string;
  team: TaskTeam | string;
  isolationRequested: TaskIsolation | string;
  isolationResolved: TaskIsolation | string;
  status: TaskStatus | string;
  workspacePath: string;
  worktreePath?: string | null;
  branchName?: string | null;
  fallbackReason?: string | null;
  createdAt: string;
  updatedAt: string;
  roles: TaskRoleState[];
  prompts: TaskPromptRecord[];
};

export type TaskListItem = {
  record: TaskRecord;
  changedFileCount: number;
  changedFilesPreview: string[];
  validationState: string;
  riskLevel: string;
};

export type TaskDetail = {
  record: TaskRecord;
  artifacts: Record<string, string>;
  changedFiles: string[];
  validationState: string;
  riskLevel: string;
};

export const TASK_MODE_OPTIONS: Array<{ value: TaskMode; label: string }> = [
  { value: "safe", label: "SAFE" },
  { value: "balanced", label: "BALANCED" },
  { value: "fast", label: "FAST" },
  { value: "yolo", label: "YOLO" },
];

export const TASK_TEAM_OPTIONS: Array<{ value: TaskTeam; label: string }> = [
  { value: "solo", label: "SOLO" },
  { value: "duo", label: "DUO" },
  { value: "full-squad", label: "FULL SQUAD" },
];

export const TASK_ISOLATION_OPTIONS: Array<{ value: TaskIsolation; label: string }> = [
  { value: "auto", label: "AUTO" },
  { value: "current-repo", label: "CURRENT REPO" },
  { value: "branch", label: "BRANCH" },
  { value: "worktree", label: "WORKTREE" },
];

export const TASK_ARTIFACT_KEYS = ["brief", "findings", "plan", "patch", "validation", "handoff"] as const;
export type TaskArtifactKey = (typeof TASK_ARTIFACT_KEYS)[number];

export const TASK_ROLE_ORDER: TaskRoleId[] = ["explorer", "reviewer", "worker", "qa"];

export const TASK_ROLE_LABELS: Record<TaskRoleId, string> = {
  explorer: "EXPLORER",
  reviewer: "REVIEWER",
  worker: "WORKER",
  qa: "QA",
};

export const TASK_STATUS_GROUPS = ["active", "queued", "completed"] as const;
export type TaskStatusGroup = (typeof TASK_STATUS_GROUPS)[number];
