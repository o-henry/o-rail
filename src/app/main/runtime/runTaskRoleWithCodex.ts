import { getWebProviderFromExecutor, toTurnModelDisplayName, toTurnModelEngineId } from "../../../features/workflow/domain";
import { findRuntimeModelOption } from "../../../features/workflow/runtimeModelOptions";
import { extractFinalAnswer } from "../../../features/workflow/labels";
import { toTurnReasoningEffort } from "../../../features/workflow/reasoningLevels";
import { extractCompletedStatus, extractDeltaText, extractUsageStats } from "../../mainAppUtils";
import { extractStringByPaths } from "../../../shared/lib/valueUtils";
import { prepareResearcherCollectionContext } from "./researcherCollection";
import { ensureResearcherCollectionArtifacts } from "./researcherCollectionArtifacts";
import { buildTaskRoleLearningPromptContext } from "../../adaptation/taskRoleLearning";
import type { WebProviderRunResult } from "../types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TaskAgentPromptPack = {
  id: string;
  label: string;
  studioRoleId: string;
  model: string;
  modelReasoningEffort: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | string;
  outputArtifactName: string;
  promptDocFile: string;
  developerInstructions: string;
};

type ThreadStartResult = {
  threadId: string;
  raw?: unknown;
};

type ThreadLoadShape = {
  thread: {
    model?: string | null;
    reasoning?: string | null;
  };
  task: {
    workspacePath?: string | null;
    worktreePath?: string | null;
  };
};

type TaskLoadShape = {
  record: {
    workspacePath?: string | null;
    worktreePath?: string | null;
  };
};

type RunTaskRoleWithCodexInput = {
  invokeFn: InvokeFn;
  storageCwd: string;
  taskId: string;
  studioRoleId: string;
  prompt?: string;
  model?: string;
  reasoning?: string;
  outputArtifactName?: string;
  sourceTab: "tasks" | "tasks-thread";
  runId: string;
  onRuntimeSession?: (runtime: {
    codexThreadId?: string | null;
    codexTurnId?: string | null;
    provider?: string | null;
  }) => void;
};

export type TaskRoleCodexRunResult = {
  summary: string;
  artifactPaths: string[];
  usage?: ReturnType<typeof extractUsageStats>;
  codexThreadId?: string;
  codexTurnId?: string;
};

function resolvePreferredRuntimeModel(params: {
  inputModel?: string;
  threadModel?: string;
  packModel?: string;
}): string {
  const resolved = String(params.inputModel || params.threadModel || params.packModel || "GPT-5.4").trim();
  return toTurnModelDisplayName(resolved || "GPT-5.4");
}

const INCOMPLETE_TURN_STATUSES = new Set([
  "inprogress",
  "running",
  "queued",
  "pending",
  "starting",
  "processing",
  "streaming",
]);
const FAILED_TURN_STATUSES = new Set(["failed", "error", "cancelled", "rejected"]);
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 180000;
const RESEARCH_POLL_TIMEOUT_MS = 600000;
const MAX_POLL_READ_ERRORS = 6;
const MAX_TURN_START_ATTEMPTS = 3;
const MAX_THREAD_START_ATTEMPTS = 3;
const TURN_START_RECOVERY_WINDOW_MS = 12000;
const THREAD_START_TIMEOUT_MS = 15000;
const TURN_START_TIMEOUT_MS = 30000;
const THREAD_READ_TIMEOUT_MS = 30000;

type RoleContextLayerBudget = {
  researchChars: number;
  learningChars: number;
  totalChars: number;
};

const DEFAULT_ROLE_CONTEXT_LAYER_BUDGET: RoleContextLayerBudget = {
  researchChars: 1600,
  learningChars: 360,
  totalChars: 1900,
};

const ROLE_CONTEXT_LAYER_BUDGETS: Record<string, RoleContextLayerBudget> = {
  research_analyst: {
    researchChars: 1800,
    learningChars: 440,
    totalChars: 2200,
  },
  pm_planner: {
    researchChars: 0,
    learningChars: 420,
    totalChars: 420,
  },
  pm_creative_director: {
    researchChars: 0,
    learningChars: 520,
    totalChars: 520,
  },
  system_programmer: {
    researchChars: 0,
    learningChars: 360,
    totalChars: 360,
  },
  qa_engineer: {
    researchChars: 0,
    learningChars: 340,
    totalChars: 340,
  },
};

function normalizeSandboxMode(value: string | null | undefined): "read-only" | "workspace-write" | "danger-full-access" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "workspace-write" || normalized === "danger-full-access") {
    return normalized;
  }
  return "read-only";
}

function buildRoleTurnPrompt(
  pack: TaskAgentPromptPack,
  userPrompt: string,
  projectPath: string,
  precollectedContext = "",
): string {
  const trimmedPrompt = String(userPrompt ?? "").trim();
  return [
    `# ROLE`,
    `${pack.label}`,
    ``,
    `# WORKSPACE`,
    projectPath,
    ``,
    `# DEVELOPER INSTRUCTIONS`,
    pack.developerInstructions.trim(),
    ``,
    `# USER REQUEST`,
    trimmedPrompt,
    precollectedContext.trim() ? `\n${precollectedContext.trim()}` : "",
    ``,
    `# OUTPUT RULES`,
    `- 한국어로만 답변한다.`,
    `- 실제로 수정한 파일이 있으면 파일 경로와 변경 이유를 짧게 적는다.`,
    `- 작업을 못 했다면 못 한 이유를 숨기지 않는다.`,
  ].join("\n");
}

function resolveRoleContextLayerBudget(roleId: string): RoleContextLayerBudget {
  return ROLE_CONTEXT_LAYER_BUDGETS[String(roleId ?? "").trim()] ?? DEFAULT_ROLE_CONTEXT_LAYER_BUDGET;
}

function trimContextLayer(value: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || maxChars <= 0) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function buildRolePromptContextLayers(params: {
  roleId: string;
  researchPromptContext?: string;
  learningPromptContext?: string;
}): string {
  const budget = resolveRoleContextLayerBudget(params.roleId);
  const researchLayer = trimContextLayer(params.researchPromptContext ?? "", budget.researchChars);
  const learningLayer = trimContextLayer(params.learningPromptContext ?? "", budget.learningChars);
  const joined = [researchLayer, learningLayer].filter(Boolean).join("\n\n");
  return trimContextLayer(joined, budget.totalChars);
}

function resolveTurnText(raw: unknown): string {
  if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)) {
    const items = (raw as { items: unknown[] }).items;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const type = String(record.type ?? "").trim().toLowerCase();
      const phase = String(record.phase ?? "").trim().toLowerCase();
      const text = String(record.text ?? "").trim() || [...new Set(collectNestedText(record.content))].join("\n").trim();
      if (!text) {
        continue;
      }
      if (type === "agentmessage" || phase === "final_answer") {
        return text;
      }
    }
  }
  return (
    extractFinalAnswer(raw) ||
    (extractStringByPaths(raw, [
      "text",
      "output_text",
      "result.output.0.content.0.text",
      "result.output.0.content.0.output_text",
      "result.output.0.text",
      "output.0.content.0.text",
      "output.0.content.0.output_text",
      "output.0.text",
      "response.output.0.content.0.text",
      "response.output.0.content.0.output_text",
      "response.output.0.text",
      "completion.output.0.content.0.text",
      "completion.output.0.content.0.output_text",
      "completion.output.0.text",
      "turn.output_text",
      "turn.response.output_text",
      "turn.response.text",
      "response.output_text",
      "response.text",
    ]) ?? extractDeltaText(raw))
  ).trim();
}

function collectNestedText(input: unknown, depth = 0): string[] {
  if (depth > 8 || input == null) {
    return [];
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item) => collectNestedText(item, depth + 1));
  }
  if (typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  const directKeys = ["text", "output_text", "outputText", "summary", "message", "content"];
  const direct = directKeys.flatMap((key) => {
    const value = record[key];
    return typeof value === "string" ? collectNestedText(value, depth + 1) : [];
  });
  const nestedKeys = ["output", "outputs", "content", "response", "result", "turn", "completion", "data"];
  const nested = nestedKeys.flatMap((key) => collectNestedText(record[key], depth + 1));
  return [...direct, ...nested];
}

function normalizeTurnStatus(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
  return normalized || null;
}

function normalizeErrorText(error: unknown): string {
  return String(error ?? "").trim().toLowerCase();
}

function isRetryableThreadReadError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return (
    text.includes("empty session file") ||
    text.includes("failed to load rollout") ||
    text.includes("not materialized yet") ||
    text.includes("includeturns is unavailable before first user message") ||
    text.includes("temporarily unavailable") ||
    text.includes("rpc error -32600") ||
    text.includes("rpc error -32603") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("busy") ||
    text.includes("econnreset") ||
    text.includes("socket hang up")
  );
}

function isRetryableTurnStartError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return (
    text.includes("empty session file") ||
    text.includes("failed to load rollout") ||
    text.includes("not materialized yet") ||
    text.includes("includeturns is unavailable before first user message") ||
    text.includes("rpc error -32600") ||
    text.includes("rpc error -32603") ||
    text.includes("temporarily unavailable") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("busy") ||
    text.includes("econnreset") ||
    text.includes("socket hang up")
  );
}

function resolveTurnStatus(raw: unknown): string | null {
  const completedStatus = extractCompletedStatus(raw);
  if (completedStatus) {
    return completedStatus.toLowerCase();
  }
  return normalizeTurnStatus(
    extractStringByPaths(raw, [
      "status",
      "turn.status",
      "response.status",
      "result.status",
      "completion.status",
    ]),
  );
}

function extractLatestTurn(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const root = raw as Record<string, unknown>;
  const candidates = [
    root.turns,
    (root.thread as Record<string, unknown> | undefined)?.turns,
    (root.response as Record<string, unknown> | undefined)?.turns,
    (root.result as Record<string, unknown> | undefined)?.turns,
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length > 0) {
      return value[value.length - 1];
    }
  }
  return raw;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      globalThis.clearTimeout(timer);
    }
  }
}

async function startCodexThreadWithRecovery(params: {
  invokeFn: InvokeFn;
  model: string;
  cwd: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
}): Promise<ThreadStartResult> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_THREAD_START_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(
        params.invokeFn<ThreadStartResult>("thread_start", {
          model: params.model,
          cwd: params.cwd,
          sandboxMode: params.sandboxMode,
        }),
        THREAD_START_TIMEOUT_MS,
        "thread_start",
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableTurnStartError(error) || attempt >= MAX_THREAD_START_ATTEMPTS) {
        throw error;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("thread_start failed");
}

async function recoverThreadStateAfterTurnStartError(params: {
  invokeFn: InvokeFn;
  threadId: string;
}): Promise<unknown | null> {
  const deadline = Date.now() + TURN_START_RECOVERY_WINDOW_MS;
  let readErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const threadState = await withTimeout(
        params.invokeFn<unknown>("codex_thread_read", {
          threadId: params.threadId,
          includeTurns: true,
        }),
        THREAD_READ_TIMEOUT_MS,
        "codex_thread_read",
      );
      const latestTurn = extractLatestTurn(threadState);
      const recoveredStatus = resolveTurnStatus(latestTurn) ?? resolveTurnStatus(threadState) ?? "";
      const recoveredText = resolveTurnText(latestTurn) || resolveTurnText(threadState);
      if (recoveredStatus || recoveredText) {
        return latestTurn === threadState ? threadState : latestTurn;
      }
    } catch (error) {
      if (!isRetryableThreadReadError(error) || readErrors >= MAX_POLL_READ_ERRORS) {
        throw error;
      }
      readErrors += 1;
    }
  }
  return null;
}

async function startCodexTurnWithRecovery(params: {
  invokeFn: InvokeFn;
  threadId: string;
  text: string;
  reasoningEffort: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
}): Promise<{
  rawResponse: unknown;
  turnError: unknown;
}> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_TURN_START_ATTEMPTS; attempt += 1) {
    try {
      const rawResponse = await withTimeout(
        params.invokeFn<unknown>("turn_start_blocking", {
          threadId: params.threadId,
          text: params.text,
          reasoningEffort: params.reasoningEffort,
          sandboxMode: params.sandboxMode,
        }),
        TURN_START_TIMEOUT_MS,
        "turn_start_blocking",
      );
      return {
        rawResponse,
        turnError: null,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableTurnStartError(error)) {
        return {
          rawResponse: null,
          turnError: error,
        };
      }
      const recoveredState = await recoverThreadStateAfterTurnStartError({
        invokeFn: params.invokeFn,
        threadId: params.threadId,
      });
      if (recoveredState) {
        return {
          rawResponse: recoveredState,
          turnError: null,
        };
      }
      if (attempt < MAX_TURN_START_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }
  return {
    rawResponse: null,
    turnError: lastError,
  };
}

async function waitForCodexTurnCompletion(params: {
  invokeFn: InvokeFn;
  threadId: string;
  initialResponse: unknown;
  pollTimeoutMs: number;
}): Promise<{
  raw: unknown;
  completedStatus: string;
}> {
  let currentRaw = params.initialResponse;
  let currentStatus = resolveTurnStatus(extractLatestTurn(currentRaw)) ?? resolveTurnStatus(currentRaw) ?? "";
  if (!INCOMPLETE_TURN_STATUSES.has(currentStatus)) {
    return {
      raw: currentRaw,
      completedStatus: currentStatus || "done",
    };
  }

  const deadline = Date.now() + params.pollTimeoutMs;
  let readErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let threadState: unknown;
    try {
      threadState = await withTimeout(
        params.invokeFn<unknown>("codex_thread_read", {
          threadId: params.threadId,
          includeTurns: true,
        }),
        THREAD_READ_TIMEOUT_MS,
        "codex_thread_read",
      );
      readErrors = 0;
    } catch (error) {
      if (!isRetryableThreadReadError(error) || readErrors >= MAX_POLL_READ_ERRORS) {
        throw error;
      }
      readErrors += 1;
      continue;
    }
    const latestTurn = extractLatestTurn(threadState);
    const nextStatus = resolveTurnStatus(latestTurn) ?? resolveTurnStatus(threadState) ?? currentStatus;
    const nextText = resolveTurnText(latestTurn) || resolveTurnText(threadState);
    currentRaw = latestTurn === threadState ? threadState : latestTurn;
    currentStatus = nextStatus;
    if (FAILED_TURN_STATUSES.has(currentStatus)) {
      return {
        raw: currentRaw,
        completedStatus: currentStatus,
      };
    }
    if (!INCOMPLETE_TURN_STATUSES.has(currentStatus) && (nextText || currentStatus)) {
      return {
        raw: currentRaw,
        completedStatus: currentStatus,
      };
    }
  }

  throw new Error(`Codex turn did not complete (${currentStatus || "timeout"})`);
}

async function resolveTaskRunContext(input: RunTaskRoleWithCodexInput): Promise<{
  projectPath: string;
  threadModel: string;
  threadReasoning: string;
}> {
  if (input.sourceTab === "tasks-thread") {
    const detail = await input.invokeFn<ThreadLoadShape>("thread_load", {
      cwd: input.storageCwd,
      threadId: input.taskId,
    });
    return {
      projectPath: String(detail.task.worktreePath || detail.task.workspacePath || input.storageCwd).trim(),
      threadModel: String(detail.thread.model || "GPT-5.4").trim(),
      threadReasoning: String(detail.thread.reasoning || "중간").trim(),
    };
  }

  const detail = await input.invokeFn<TaskLoadShape>("task_load", {
    cwd: input.storageCwd,
    taskId: input.taskId,
  });
  return {
    projectPath: String(detail.record.worktreePath || detail.record.workspacePath || input.storageCwd).trim(),
    threadModel: "GPT-5.4",
    threadReasoning: "중간",
  };
}

export async function runTaskRoleWithCodex(input: RunTaskRoleWithCodexInput): Promise<TaskRoleCodexRunResult> {
  const pack = await input.invokeFn<TaskAgentPromptPack>("task_agent_pack_read", {
    roleId: input.studioRoleId,
  });
  const context = await resolveTaskRunContext(input);
  const artifactDir = `${input.storageCwd.replace(/[\\/]+$/, "")}/.rail/tasks/${input.taskId}/codex_runs/${input.runId}`;
  const researcherCollection = await prepareResearcherCollectionContext({
    artifactDir,
    invokeFn: input.invokeFn,
    pack,
    prompt: input.prompt ?? "",
    storageCwd: input.storageCwd,
  });
  const sandboxMode = normalizeSandboxMode(pack.sandboxMode);
  const selectedModel = resolvePreferredRuntimeModel({
    inputModel: input.model,
    threadModel: context.threadModel,
    packModel: pack.model,
  });
  const runtimeModelOption = findRuntimeModelOption(selectedModel);
  const webProvider = getWebProviderFromExecutor(runtimeModelOption.executor);
  const modelEngine = toTurnModelEngineId(selectedModel);
  const reasoningEffort = toTurnReasoningEffort(
    input.reasoning || context.threadReasoning || pack.modelReasoningEffort || "중간",
  );
  const learningPromptContext = buildTaskRoleLearningPromptContext({
    cwd: input.storageCwd,
    roleId: pack.studioRoleId || input.studioRoleId,
    prompt: input.prompt ?? "",
  });
  const layeredPromptContext = buildRolePromptContextLayers({
    roleId: pack.studioRoleId || input.studioRoleId,
    researchPromptContext: researcherCollection.promptContext,
    learningPromptContext,
  });
  const promptText = buildRoleTurnPrompt(
    pack,
    input.prompt ?? "",
    context.projectPath,
    layeredPromptContext,
  );

  let rawResponse: unknown = null;
  let turnError: unknown = null;
  let completedStatus = "done";
  let summary = "";
  let codexThreadId: string | undefined;
  let codexTurnId: string | undefined;

  if (webProvider) {
    input.onRuntimeSession?.({
      provider: webProvider,
      codexThreadId: null,
      codexTurnId: null,
    });
    const webResult = await input.invokeFn<WebProviderRunResult>("web_provider_run", {
      provider: webProvider,
      prompt: promptText,
      timeoutMs: pack.studioRoleId === "research_analyst" ? RESEARCH_POLL_TIMEOUT_MS : POLL_TIMEOUT_MS,
      mode: "bridgeAssisted",
      cwd: context.projectPath,
    });
    rawResponse = webResult.raw ?? webResult;
    if (!webResult.ok || !String(webResult.text ?? "").trim()) {
      throw new Error(webResult.error || `${webProvider} web provider returned no usable response`);
    }
    summary = String(webResult.text ?? "").trim();
    completedStatus = "completed";
  } else {
    const threadStart = await startCodexThreadWithRecovery({
      invokeFn: input.invokeFn,
      model: modelEngine,
      cwd: context.projectPath,
      sandboxMode,
    });
    codexThreadId = threadStart.threadId;
    input.onRuntimeSession?.({
      codexThreadId,
      codexTurnId: null,
      provider: null,
    });
    const turnStart = await startCodexTurnWithRecovery({
      invokeFn: input.invokeFn,
      threadId: threadStart.threadId,
      text: promptText,
      reasoningEffort,
      sandboxMode,
    });
    rawResponse = turnStart.rawResponse;
    turnError = turnStart.turnError;

    completedStatus = turnError ? "error" : (resolveTurnStatus(rawResponse) ?? "done");
    if (!turnError && INCOMPLETE_TURN_STATUSES.has(completedStatus)) {
      const completion = await waitForCodexTurnCompletion({
        invokeFn: input.invokeFn,
        threadId: threadStart.threadId,
        initialResponse: rawResponse,
        pollTimeoutMs: pack.studioRoleId === "research_analyst" ? RESEARCH_POLL_TIMEOUT_MS : POLL_TIMEOUT_MS,
      });
      rawResponse = completion.raw;
      completedStatus = completion.completedStatus;
    }
    if (FAILED_TURN_STATUSES.has(completedStatus)) {
      if (turnError instanceof Error) {
        throw turnError;
      }
      throw new Error(`Codex turn failed (${completedStatus})`);
    }

    summary = (!turnError ? resolveTurnText(rawResponse) : "").trim();
    if (!summary) {
      if (turnError instanceof Error) {
        throw turnError;
      }
      throw new Error("Codex turn finished without a readable response");
    }
    codexTurnId = extractStringByPaths(rawResponse, ["turnId", "turn_id", "id", "turn.id", "response.id"]) ?? undefined;
    input.onRuntimeSession?.({
      codexThreadId: codexThreadId ?? null,
      codexTurnId: codexTurnId ?? null,
      provider: null,
    });
  }

  const promptArtifactPath = await input.invokeFn<string>("workspace_write_text", {
    cwd: artifactDir,
    name: "prompt.md",
    content: `${promptText}\n`,
  });
  const responseArtifactPath = await input.invokeFn<string>("workspace_write_text", {
    cwd: artifactDir,
    name: String(input.outputArtifactName || pack.outputArtifactName || `${pack.id}.md`).trim(),
    content: `${summary}\n`,
  });
  const responseJsonPath = await input.invokeFn<string>("workspace_write_text", {
    cwd: artifactDir,
    name: "response.json",
    content: `${JSON.stringify(
      {
        taskId: input.taskId,
        studioRoleId: input.studioRoleId,
        projectPath: context.projectPath,
        model: selectedModel,
        executor: runtimeModelOption.executor,
        webProvider: webProvider ?? null,
        modelEngine: webProvider ? null : modelEngine,
        reasoningEffort,
        sandboxMode,
        codexThreadId: codexThreadId ?? null,
        codexTurnId: codexTurnId ?? null,
        completedStatus,
        turnError: turnError instanceof Error ? turnError.message : turnError ?? null,
        raw: rawResponse,
      },
      null,
      2,
    )}\n`,
  });

  const ensuredResearcherArtifactPaths =
    pack.id === "researcher" || pack.studioRoleId === "research_analyst"
      ? await ensureResearcherCollectionArtifacts({
          invokeFn: input.invokeFn,
          artifactDir,
          existingArtifactPaths: researcherCollection.artifactPaths,
          findingsMarkdown: summary,
          fallbackSummary: researcherCollection.fallbackSummary,
        })
      : researcherCollection.artifactPaths;

  return {
    summary,
    artifactPaths: [...ensuredResearcherArtifactPaths, promptArtifactPath, responseArtifactPath, responseJsonPath],
    usage: webProvider ? undefined : extractUsageStats(rawResponse),
    codexThreadId,
    codexTurnId,
  };
}
