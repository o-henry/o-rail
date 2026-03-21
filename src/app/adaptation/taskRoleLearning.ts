import { adaptationStorageDir, normalizeAdaptiveWorkspaceKey } from "./workspace";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type TaskRoleLearningRunStatus = "done" | "error";
export type TaskRoleLearningFailureKind =
  | "bootstrap"
  | "auth"
  | "timeout"
  | "source_sparsity"
  | "materialization"
  | "empty_response"
  | "failure"
  | "error";

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

type TaskRoleLearningPromptBudget = {
  maxPromptContextChars: number;
  maxSimilarRows: number;
  maxAgeDays: number;
  successLineMaxChars: number;
  failureLineMaxChars: number;
  keepFailureIfOlderThanRecentSuccessDays: number;
};

const TASK_ROLE_LEARNING_STORAGE_KEY_PREFIX = "rail.studio.taskRoleLearning.v1";
const TASK_ROLE_LEARNING_FILE_NAME = "task_role_learning.json";
const MAX_STORED_RUNS = 160;
const MAX_SIMILAR_ROWS = 2;
const MAX_PROMPT_CONTEXT_CHARS = 640;
const IMPROVEMENT_WINDOW_SIZE = 6;
const DEFAULT_PROMPT_BUDGET: TaskRoleLearningPromptBudget = {
  maxPromptContextChars: MAX_PROMPT_CONTEXT_CHARS,
  maxSimilarRows: MAX_SIMILAR_ROWS,
  maxAgeDays: 30,
  successLineMaxChars: 140,
  failureLineMaxChars: 120,
  keepFailureIfOlderThanRecentSuccessDays: 5,
};
const TASK_ROLE_PROMPT_BUDGETS: Record<string, TaskRoleLearningPromptBudget> = {
  research_analyst: {
    maxPromptContextChars: 440,
    maxSimilarRows: 1,
    maxAgeDays: 14,
    successLineMaxChars: 130,
    failureLineMaxChars: 110,
    keepFailureIfOlderThanRecentSuccessDays: 3,
  },
  system_programmer: {
    maxPromptContextChars: 360,
    maxSimilarRows: 1,
    maxAgeDays: 21,
    successLineMaxChars: 120,
    failureLineMaxChars: 110,
    keepFailureIfOlderThanRecentSuccessDays: 4,
  },
  qa_engineer: {
    maxPromptContextChars: 340,
    maxSimilarRows: 1,
    maxAgeDays: 21,
    successLineMaxChars: 110,
    failureLineMaxChars: 110,
    keepFailureIfOlderThanRecentSuccessDays: 4,
  },
  pm_planner: {
    maxPromptContextChars: 420,
    maxSimilarRows: 2,
    maxAgeDays: 21,
    successLineMaxChars: 130,
    failureLineMaxChars: 110,
    keepFailureIfOlderThanRecentSuccessDays: 4,
  },
  pm_creative_director: {
    maxPromptContextChars: 520,
    maxSimilarRows: 2,
    maxAgeDays: 28,
    successLineMaxChars: 150,
    failureLineMaxChars: 120,
    keepFailureIfOlderThanRecentSuccessDays: 5,
  },
  art_pipeline: {
    maxPromptContextChars: 380,
    maxSimilarRows: 1,
    maxAgeDays: 21,
    successLineMaxChars: 120,
    failureLineMaxChars: 110,
    keepFailureIfOlderThanRecentSuccessDays: 4,
  },
  tooling_engineer: {
    maxPromptContextChars: 380,
    maxSimilarRows: 1,
    maxAgeDays: 21,
    successLineMaxChars: 120,
    failureLineMaxChars: 110,
    keepFailureIfOlderThanRecentSuccessDays: 4,
  },
};
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

function detectFailureKind(params: {
  message: string;
  summary: string;
  artifactCount: number;
}): TaskRoleLearningFailureKind {
  const lowered = params.message.toLowerCase();
  const summaryLowered = params.summary.toLowerCase();
  if (!lowered) {
    return params.artifactCount === 0 && summaryLowered.includes("근거") && summaryLowered.includes("0")
      ? "source_sparsity"
      : "error";
  }
  if (lowered.includes("role_kb_bootstrap 실패") || lowered.includes("bootstrap")) {
    return "bootstrap";
  }
  if (
    lowered.includes("unauthorized") ||
    lowered.includes("forbidden") ||
    lowered.includes("401") ||
    lowered.includes("403") ||
    lowered.includes("auth")
  ) {
    return "auth";
  }
  if (lowered.includes("timed out") || lowered.includes("timeout")) {
    return "timeout";
  }
  if (
    lowered.includes("0개") ||
    lowered.includes("근거가 없어") ||
    lowered.includes("no sources") ||
    lowered.includes("no source") ||
    lowered.includes("no evidence") ||
    lowered.includes("source sparsity") ||
    lowered.includes("insufficient sources") ||
    lowered.includes("search hit 0")
  ) {
    return "source_sparsity";
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

function failureKindLabel(kind?: string): string {
  if (kind === "bootstrap") {
    return "외부 근거 수집 실패";
  }
  if (kind === "auth") {
    return "인증/권한 실패";
  }
  if (kind === "timeout") {
    return "장시간 실행/타임아웃";
  }
  if (kind === "source_sparsity") {
    return "근거 희소/출처 부족";
  }
  if (kind === "materialization") {
    return "세션 준비 race";
  }
  if (kind === "empty_response") {
    return "응답 비어 있음";
  }
  return "실행 실패";
}

function failureAvoidanceHint(kind?: string): string {
  if (kind === "bootstrap") {
    return "동일 사이트만 반복하지 말고, 공식 문서·검색 인덱스·공개 커뮤니티로 소스 풀을 넓힌다.";
  }
  if (kind === "auth") {
    return "로그인/권한이 필요한 소스는 피하고, 공개 접근 가능한 문서형 페이지와 검색 인덱스를 우선한다.";
  }
  if (kind === "timeout") {
    return "초기 범위를 줄여 먼저 핵심 지표를 확보하고, 이후 지역/커뮤니티 축을 단계적으로 확장한다.";
  }
  if (kind === "source_sparsity") {
    return "동의어·영문명·지역명으로 질의를 넓히고, 공식/언론/커뮤니티 출처 비중을 분산한다.";
  }
  if (kind === "materialization") {
    return "첫 응답 전 준비 구간을 전제로 하고, 즉시 재시도보다는 준비 완료 후 계속 진행한다.";
  }
  if (kind === "empty_response") {
    return "최종 결론 전에 최소 근거와 링크를 먼저 확보한 뒤 요약한다.";
  }
  return "최근 실패 원인을 반복하지 않도록 접근 경로를 바꾼다.";
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
  const kind = failureKindLabel(row.failureKind);
  const detail = row.failureReason ? ` — ${trimLine(row.failureReason, 120)}` : "";
  return `${kind}${detail}`;
}

function resolvePromptBudget(roleId: string): TaskRoleLearningPromptBudget {
  return TASK_ROLE_PROMPT_BUDGETS[String(roleId ?? "").trim()] ?? DEFAULT_PROMPT_BUDGET;
}

function ageInDays(createdAt: string): number {
  const time = Date.parse(String(createdAt ?? ""));
  if (!Number.isFinite(time)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (Date.now() - time) / 86_400_000);
}

function trimPromptContextWithBudget(context: string, maxChars: number): string {
  const normalized = String(context ?? "").trim();
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function buildTaskRoleLearningPromptContext(input: BuildTaskRoleLearningPromptContextInput): string {
  const budget = resolvePromptBudget(input.roleId);
  const promptTerms = normalizeTerms(input.prompt);
  const rows = readTaskRoleLearningData(input.cwd).runs
    .filter((row) => row.roleId === input.roleId)
    .filter((row) => ageInDays(row.createdAt) <= budget.maxAgeDays);
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
  const mostRecentSuccessAge = fallbackScored
    .filter(({ row }) => row.status === "done")
    .map(({ row }) => ageInDays(row.createdAt))
    .sort((left, right) => left - right)[0];
  const successes = fallbackScored
    .filter(({ row }) => row.status === "done")
    .slice(0, budget.maxSimilarRows)
    .map(({ row }) => `- 비슷한 성공 패턴: ${trimLine(row.summaryExcerpt || row.promptExcerpt, budget.successLineMaxChars)}`);
  const failures = fallbackScored
    .filter(({ row }) => row.status === "error")
    .filter(({ row }) => {
      if (!Number.isFinite(mostRecentSuccessAge)) {
        return true;
      }
      return ageInDays(row.createdAt) <= mostRecentSuccessAge + budget.keepFailureIfOlderThanRecentSuccessDays;
    })
    .slice(0, budget.maxSimilarRows)
    .map(({ row }) => `- 반복 금지: ${formatFailureGuidance(row)}`);
  const avoidances = fallbackScored
    .filter(({ row }) => row.status === "error")
    .filter(({ row }) => {
      if (!Number.isFinite(mostRecentSuccessAge)) {
        return true;
      }
      return ageInDays(row.createdAt) <= mostRecentSuccessAge + budget.keepFailureIfOlderThanRecentSuccessDays;
    })
    .slice(0, 1)
    .map(({ row }) => `- 회피 전략: ${failureAvoidanceHint(row.failureKind)}`);
  if (successes.length === 0 && failures.length === 0) {
    return "";
  }
  return trimPromptContextWithBudget([
    "# TASK LEARNING MEMORY",
    ...successes,
    ...failures,
    ...avoidances,
    "- 같은 유형의 성공 경로를 우선하되, 학습 메모리는 짧게 반영하고 현재 요청 범위를 넘겨 일반화하지 않는다.",
  ].join("\n"), budget.maxPromptContextChars);
}

export async function recordTaskRoleLearningOutcome(input: RecordTaskRoleLearningOutcomeInput): Promise<TaskRoleLearningData> {
  const current = readTaskRoleLearningData(input.cwd);
  const promptExcerpt = trimLine(input.prompt, 220);
  const summaryExcerpt = trimLine(input.summary, 240);
  const failureReason = trimLine(input.failureReason, 220);
  const failureKind = input.runStatus === "error"
    ? detectFailureKind({
      message: failureReason,
      summary: summaryExcerpt,
      artifactCount: Array.isArray(input.artifactPaths) ? input.artifactPaths.filter(Boolean).length : 0,
    })
    : undefined;
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
    failureKind,
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
  lastFailureKind: string;
}> {
  const grouped = new Map<string, {
    successCount: number;
    failureCount: number;
    lastFailureReason: string;
    lastFailureKind: string;
    lastSeenAt: string;
  }>();
  for (const row of readTaskRoleLearningData(cwd).runs) {
    const current = grouped.get(row.roleId) ?? {
      successCount: 0,
      failureCount: 0,
      lastFailureReason: "",
      lastFailureKind: "",
      lastSeenAt: "",
    };
    if (row.status === "done") {
      current.successCount += 1;
    } else {
      current.failureCount += 1;
      if (!current.lastFailureReason) {
        current.lastFailureReason = row.failureReason ?? row.failureKind ?? "";
        current.lastFailureKind = row.failureKind ?? "";
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
      lastFailureKind: value.lastFailureKind,
      lastSeenAt: value.lastSeenAt,
    }))
    .sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)))
    .map(({ lastSeenAt: _lastSeenAt, ...rest }) => rest);
}

export function summarizeTaskRoleLearningImprovementByRole(cwd: string): Array<{
  roleId: string;
  currentSuccessRate: number;
  previousSuccessRate: number | null;
  successRateDelta: number | null;
  recentSampleSize: number;
  previousSampleSize: number;
}> {
  const grouped = new Map<string, TaskRoleLearningRecord[]>();
  for (const row of readTaskRoleLearningData(cwd).runs) {
    const current = grouped.get(row.roleId) ?? [];
    current.push(row);
    grouped.set(row.roleId, current);
  }
  return [...grouped.entries()]
    .map(([roleId, rows]) => {
      const sorted = [...rows].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      const recent = sorted.slice(0, IMPROVEMENT_WINDOW_SIZE);
      const previous = sorted.slice(IMPROVEMENT_WINDOW_SIZE, IMPROVEMENT_WINDOW_SIZE * 2);
      const recentSuccesses = recent.filter((row) => row.status === "done").length;
      const previousSuccesses = previous.filter((row) => row.status === "done").length;
      const currentSuccessRate = recent.length > 0 ? recentSuccesses / recent.length : 0;
      const previousSuccessRate = previous.length > 0 ? previousSuccesses / previous.length : null;
      return {
        roleId,
        currentSuccessRate,
        previousSuccessRate,
        successRateDelta: previousSuccessRate === null ? null : currentSuccessRate - previousSuccessRate,
        recentSampleSize: recent.length,
        previousSampleSize: previous.length,
        lastSeenAt: sorted[0]?.createdAt ?? "",
      };
    })
    .sort((left, right) => String(right.lastSeenAt).localeCompare(String(left.lastSeenAt)))
    .map(({ lastSeenAt: _lastSeenAt, ...rest }) => rest);
}

export function formatTaskRoleLearningRoleLabel(roleId: string): string {
  const normalized = String(roleId ?? "").trim();
  if (normalized === "research_analyst") {
    return "리서처";
  }
  if (normalized === "system_programmer") {
    return "시스템";
  }
  if (normalized === "client_programmer") {
    return "클라이언트";
  }
  if (normalized === "qa_engineer") {
    return "QA";
  }
  if (normalized === "tooling_engineer") {
    return "툴링";
  }
  return normalized.replace(/_/g, " ") || "에이전트";
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
