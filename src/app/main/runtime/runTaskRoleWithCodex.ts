import { toTurnModelEngineId } from "../../../features/workflow/domain";
import { extractFinalAnswer } from "../../../features/workflow/labels";
import { toTurnReasoningEffort } from "../../../features/workflow/reasoningLevels";
import { extractCompletedStatus, extractDeltaText, extractUsageStats } from "../../mainAppUtils";
import { extractStringByPaths } from "../../../shared/lib/valueUtils";
import { prepareResearcherCollectionContext } from "./researcherCollection";

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
};

export type TaskRoleCodexRunResult = {
  summary: string;
  artifactPaths: string[];
  usage?: ReturnType<typeof extractUsageStats>;
  codexThreadId?: string;
  codexTurnId?: string;
};

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
const POLL_TIMEOUT_MS = 45000;

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

function resolveTurnText(raw: unknown): string {
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

function buildSuccessfulEmptyResponseSummary(pack: TaskAgentPromptPack, raw: unknown): string {
  const nestedText = [...new Set(collectNestedText(raw))].filter(Boolean).join("\n").trim();
  if (nestedText) {
    return nestedText;
  }
  return `${pack.label} 작업을 완료했습니다. 응답 본문이 비어 있어 산출물과 response.json을 기준으로 후속 합성을 진행합니다.`;
}

function normalizeTurnStatus(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
  return normalized || null;
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

async function waitForCodexTurnCompletion(params: {
  invokeFn: InvokeFn;
  threadId: string;
  initialResponse: unknown;
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

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const threadState = await params.invokeFn<unknown>("codex_thread_read", {
      threadId: params.threadId,
      includeTurns: true,
    });
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
  const modelEngine = toTurnModelEngineId(input.model || pack.model || context.threadModel || "GPT-5.4");
  const reasoningEffort = toTurnReasoningEffort(
    input.reasoning || pack.modelReasoningEffort || context.threadReasoning || "중간",
  );
  const promptText = buildRoleTurnPrompt(pack, input.prompt ?? "", context.projectPath, researcherCollection.promptContext);

  const threadStart = await input.invokeFn<ThreadStartResult>("thread_start", {
    model: modelEngine,
    cwd: context.projectPath,
    sandboxMode,
  });
  let rawResponse: unknown = null;
  let turnError: unknown = null;
  try {
    rawResponse = await input.invokeFn<unknown>("turn_start_blocking", {
      threadId: threadStart.threadId,
      text: promptText,
      reasoningEffort,
      sandboxMode,
    });
  } catch (error) {
    turnError = error;
  }

  let completedStatus = turnError ? "error" : (resolveTurnStatus(rawResponse) ?? "done");
  if (!turnError && INCOMPLETE_TURN_STATUSES.has(completedStatus)) {
    const completion = await waitForCodexTurnCompletion({
      invokeFn: input.invokeFn,
      threadId: threadStart.threadId,
      initialResponse: rawResponse,
    });
    rawResponse = completion.raw;
    completedStatus = completion.completedStatus;
  }
  const fallbackSummary = String(researcherCollection.fallbackSummary ?? "").trim();
  if (FAILED_TURN_STATUSES.has(completedStatus) && !fallbackSummary) {
    if (turnError instanceof Error) {
      throw turnError;
    }
    throw new Error(`Codex turn failed (${completedStatus})`);
  }

  const summary = (
    (!turnError ? resolveTurnText(rawResponse) : "")
    || fallbackSummary
    || (!turnError && !FAILED_TURN_STATUSES.has(completedStatus)
      ? buildSuccessfulEmptyResponseSummary(pack, rawResponse)
      : "")
  ).trim();
  if (!summary) {
    if (turnError instanceof Error) {
      throw turnError;
    }
    throw new Error("Codex turn finished without a readable response");
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
        model: modelEngine,
        reasoningEffort,
        sandboxMode,
        codexThreadId: threadStart.threadId,
        codexTurnId:
          extractStringByPaths(rawResponse, ["turnId", "turn_id", "id", "turn.id", "response.id"]) ?? null,
        completedStatus,
        turnError: turnError instanceof Error ? turnError.message : turnError ?? null,
        raw: rawResponse,
      },
      null,
      2,
    )}\n`,
  });

  return {
    summary,
    artifactPaths: [...researcherCollection.artifactPaths, promptArtifactPath, responseArtifactPath, responseJsonPath],
    usage: extractUsageStats(rawResponse),
    codexThreadId: threadStart.threadId,
    codexTurnId:
      extractStringByPaths(rawResponse, ["turnId", "turn_id", "id", "turn.id", "response.id"]) ?? undefined,
  };
}
