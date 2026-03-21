import { adaptationStorageDir, normalizeAdaptiveWorkspaceKey } from "./workspace";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type TaskRoleLearningRunStatus = "done" | "error";

export type TaskRoleLearningRecord = {
  id: string;
  runId: string;
  workspace: string;
  roleId: string;
  status: TaskRoleLearningRunStatus;
  promptExcerpt: string;
  promptTerms: string[];
  summaryExcerpt: string;
  artifactCount: number;
  failureKind?: string;
  failureReason?: string;
  createdAt: string;
};

export type TaskRoleLearningData = {
  version: 1;
  workspace: string;
  updatedAt: string;
  runs: TaskRoleLearningRecord[];
};

type RecordTaskRoleLearningOutcomeInput = {
  cwd: string;
  invokeFn?: InvokeFn;
  runId: string;
  roleId: string;
  prompt?: string;
  summary?: string;
  artifactPaths?: string[];
  runStatus: TaskRoleLearningRunStatus;
  failureReason?: string;
};

type BuildTaskRoleLearningPromptContextInput = {
  cwd: string;
  roleId: string;
  prompt?: string;
};

const TASK_ROLE_LEARNING_STORAGE_KEY_PREFIX = "rail.studio.taskRoleLearning.v1";
const TASK_ROLE_LEARNING_FILE_NAME = "task_role_learning.json";
const MAX_STORED_RUNS = 160;
const MAX_SIMILAR_ROWS = 2;
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "about",
  "then",
  "than",
  "using",
  "please",
  "give",
  "make",
  "show",
  "just",
  "need",
  "would",
  "could",
  "should",
  "해야",
  "해줘",
  "해라",
  "대한",
  "기준",
  "관련",
  "조사",
  "분석",
  "정리",
  "요청",
  "질문",
  "사용자",
  "현재",
  "가장",
]);

const memoryTaskRoleLearningByWorkspace = new Map<string, TaskRoleLearningData>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeWorkspace(cwd: string): string {
  return normalizeAdaptiveWorkspaceKey(cwd);
}

function storageKey(cwd: string): string {
  return `${TASK_ROLE_LEARNING_STORAGE_KEY_PREFIX}:${encodeURIComponent(normalizeWorkspace(cwd))}`;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function trimLine(value: unknown, maxLength = 220): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function normalizeTerms(value: unknown): string[] {
  const tokens = String(value ?? "")
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣一-龥ぁ-んァ-ン]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  return [...new Set(tokens)].slice(0, 24);
}

function normalizeRecord(workspace: string, raw: unknown): TaskRoleLearningRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = trimLine(row.id, 120);
  const runId = trimLine(row.runId, 120);
  const roleId = trimLine(row.roleId, 80);
  if (!id || !runId || !roleId) {
    return null;
  }
  return {
    id,
    runId,
    workspace,
    roleId,
    status: row.status === "done" ? "done" : "error",
    promptExcerpt: trimLine(row.promptExcerpt),
    promptTerms: Array.isArray(row.promptTerms) ? row.promptTerms.map((item) => trimLine(item, 48)).filter(Boolean) : [],
    summaryExcerpt: trimLine(row.summaryExcerpt),
    artifactCount: Math.max(0, Number(row.artifactCount ?? 0) || 0),
    failureKind: trimLine(row.failureKind, 80) || undefined,
    failureReason: trimLine(row.failureReason, 220) || undefined,
    createdAt: trimLine(row.createdAt, 80) || nowIso(),
  };
}

function normalizeData(cwd: string, raw: unknown): TaskRoleLearningData {
  const workspace = normalizeWorkspace(cwd);
  if (!raw || typeof raw !== "object") {
    return createEmptyTaskRoleLearningData(cwd);
  }
  const row = raw as Record<string, unknown>;
  const runs = Array.isArray(row.runs)
    ? row.runs.map((item) => normalizeRecord(workspace, item)).filter((item): item is TaskRoleLearningRecord => item !== null)
    : [];
  return {
    version: 1,
    workspace,
    updatedAt: trimLine(row.updatedAt, 80) || nowIso(),
    runs: trimRuns(runs),
  };
}

function trimRuns(rows: TaskRoleLearningRecord[]): TaskRoleLearningRecord[] {
  return [...rows]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, MAX_STORED_RUNS);
}

function writeCache(cwd: string, data: TaskRoleLearningData): void {
  const workspace = normalizeWorkspace(cwd);
  const normalized = normalizeData(cwd, data);
  memoryTaskRoleLearningByWorkspace.set(workspace, normalized);
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(cwd), JSON.stringify(normalized));
  } catch {
    // ignore storage failures
  }
}

export function createEmptyTaskRoleLearningData(cwd: string): TaskRoleLearningData {
  return {
    version: 1,
    workspace: normalizeWorkspace(cwd),
    updatedAt: nowIso(),
    runs: [],
  };
}

export function readTaskRoleLearningData(cwd: string): TaskRoleLearningData {
  const workspace = normalizeWorkspace(cwd);
  const memory = memoryTaskRoleLearningByWorkspace.get(workspace);
  if (memory) {
    return memory;
  }
  if (!canUseLocalStorage()) {
    return createEmptyTaskRoleLearningData(cwd);
  }
  try {
    const raw = window.localStorage.getItem(storageKey(cwd));
    const parsed = raw ? JSON.parse(raw) : null;
    const next = normalizeData(cwd, parsed);
    memoryTaskRoleLearningByWorkspace.set(workspace, next);
    return next;
  } catch {
    return createEmptyTaskRoleLearningData(cwd);
  }
}

export async function loadTaskRoleLearningData(cwd: string, invokeFn?: InvokeFn): Promise<TaskRoleLearningData> {
  const cached = readTaskRoleLearningData(cwd);
  if (!invokeFn || !String(cwd ?? "").trim()) {
    return cached;
  }
  try {
    const raw = await invokeFn<string>("workspace_read_text", {
      cwd,
      path: `${adaptationStorageDir(cwd)}/${TASK_ROLE_LEARNING_FILE_NAME}`,
    });
    const next = normalizeData(cwd, raw ? JSON.parse(raw) : null);
    writeCache(cwd, next);
    return next;
  } catch {
    return cached;
  }
}

function detectFailureKind(message: string): string {
  const lowered = message.toLowerCase();
  if (!lowered) {
    return "";
  }
  if (lowered.includes("role_kb_bootstrap 실패") || lowered.includes("bootstrap")) {
    return "bootstrap";
  }
  if (lowered.includes("timed out") || lowered.includes("timeout")) {
    return "timeout";
  }
  if (lowered.includes("unauthorized")) {
    return "auth";
  }
  if (lowered.includes("not materialized")) {
    return "materialization";
  }
  if (lowered.includes("no readable response")) {
    return "empty_response";
  }
  if (lowered.includes("failed")) {
    return "failure";
  }
  return "error";
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftSet.size, rightSet.size, 1);
}

function formatFailureGuidance(row: TaskRoleLearningRecord): string {
  const kind = row.failureKind === "bootstrap"
    ? "외부 근거 수집 실패"
    : row.failureKind === "timeout"
      ? "장시간 실행/타임아웃"
      : row.failureKind === "auth"
        ? "인증/권한 실패"
        : row.failureKind === "materialization"
          ? "세션 준비 race"
          : "실행 실패";
  const detail = row.failureReason ? ` — ${trimLine(row.failureReason, 120)}` : "";
  return `${kind}${detail}`;
}

export function buildTaskRoleLearningPromptContext(input: BuildTaskRoleLearningPromptContextInput): string {
  const promptTerms = normalizeTerms(input.prompt);
  const rows = readTaskRoleLearningData(input.cwd).runs.filter((row) => row.roleId === input.roleId);
  if (rows.length === 0) {
    return "";
  }
  const scored = rows
    .map((row) => ({
      row,
      score: overlapScore(promptTerms, row.promptTerms),
    }))
    .sort((left, right) => right.score - left.score || String(right.row.createdAt).localeCompare(String(left.row.createdAt)));
  const relevantScored = promptTerms.length > 0
    ? scored.filter(({ score }) => score > 0)
    : scored;
  const fallbackScored = relevantScored.length > 0 ? relevantScored : scored;
  const successes = fallbackScored
    .filter(({ row }) => row.status === "done")
    .slice(0, MAX_SIMILAR_ROWS)
    .map(({ row }) => `- 비슷한 성공 패턴: ${row.summaryExcerpt || row.promptExcerpt}`);
  const failures = fallbackScored
    .filter(({ row }) => row.status === "error")
    .slice(0, MAX_SIMILAR_ROWS)
    .map(({ row }) => `- 반복 금지: ${formatFailureGuidance(row)}`);
  if (successes.length === 0 && failures.length === 0) {
    return "";
  }
  return [
    "# TASK LEARNING MEMORY",
    ...successes,
    ...failures,
    "- 이전 실패를 반복하지 말고, 같은 유형의 성공 경로가 있으면 그 방식을 우선한다.",
  ].join("\n");
}

export async function recordTaskRoleLearningOutcome(input: RecordTaskRoleLearningOutcomeInput): Promise<TaskRoleLearningData> {
  const current = readTaskRoleLearningData(input.cwd);
  const promptExcerpt = trimLine(input.prompt, 220);
  const summaryExcerpt = trimLine(input.summary, 240);
  const failureReason = trimLine(input.failureReason, 220);
  const nextRecord: TaskRoleLearningRecord = {
    id: `${trimLine(input.runId, 80)}:${trimLine(input.roleId, 80)}`,
    runId: trimLine(input.runId, 80),
    workspace: normalizeWorkspace(input.cwd),
    roleId: trimLine(input.roleId, 80),
    status: input.runStatus,
    promptExcerpt,
    promptTerms: normalizeTerms(input.prompt),
    summaryExcerpt,
    artifactCount: Array.isArray(input.artifactPaths) ? input.artifactPaths.filter(Boolean).length : 0,
    failureKind: input.runStatus === "error" ? detectFailureKind(failureReason) : undefined,
    failureReason: input.runStatus === "error" ? failureReason : undefined,
    createdAt: nowIso(),
  };
  const next: TaskRoleLearningData = {
    version: 1,
    workspace: normalizeWorkspace(input.cwd),
    updatedAt: nowIso(),
    runs: trimRuns([
      nextRecord,
      ...current.runs.filter((row) => row.id !== nextRecord.id),
    ]),
  };
  writeCache(input.cwd, next);
  if (input.invokeFn && String(input.cwd ?? "").trim()) {
    try {
      await input.invokeFn<string>("workspace_write_text", {
        cwd: adaptationStorageDir(input.cwd),
        name: TASK_ROLE_LEARNING_FILE_NAME,
        content: `${JSON.stringify(next, null, 2)}\n`,
      });
    } catch {
      // ignore workspace persistence failures
    }
  }
  return next;
}

export function summarizeTaskRoleLearningByRole(cwd: string): Array<{
  roleId: string;
  successCount: number;
  failureCount: number;
  lastFailureReason: string;
}> {
  const grouped = new Map<string, { successCount: number; failureCount: number; lastFailureReason: string; lastSeenAt: string }>();
  for (const row of readTaskRoleLearningData(cwd).runs) {
    const current = grouped.get(row.roleId) ?? {
      successCount: 0,
      failureCount: 0,
      lastFailureReason: "",
      lastSeenAt: "",
    };
    if (row.status === "done") {
      current.successCount += 1;
    } else {
      current.failureCount += 1;
      if (!current.lastFailureReason) {
        current.lastFailureReason = row.failureReason ?? row.failureKind ?? "";
      }
    }
    current.lastSeenAt = row.createdAt;
    grouped.set(row.roleId, current);
  }
  return [...grouped.entries()]
    .map(([roleId, value]) => ({
      roleId,
      successCount: value.successCount,
      failureCount: value.failureCount,
      lastFailureReason: value.lastFailureReason,
      lastSeenAt: value.lastSeenAt,
    }))
    .sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)))
    .map(({ lastSeenAt: _lastSeenAt, ...rest }) => rest);
}

export function clearTaskRoleLearningDataForTest(): void {
  memoryTaskRoleLearningByWorkspace.clear();
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    const keysToDelete: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(TASK_ROLE_LEARNING_STORAGE_KEY_PREFIX)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore storage failures
  }
}
