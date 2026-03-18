import { toTurnModelEngineId } from "../../../features/workflow/domain";
import { toTurnReasoningEffort } from "../../../features/workflow/reasoningLevels";
import { extractCompletedStatus, extractDeltaText, extractUsageStats } from "../../mainAppUtils";
import { extractStringByPaths } from "../../../shared/lib/valueUtils";

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

function normalizeSandboxMode(value: string | null | undefined): "read-only" | "workspace-write" | "danger-full-access" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "workspace-write" || normalized === "danger-full-access") {
    return normalized;
  }
  return "read-only";
}

function buildRoleTurnPrompt(pack: TaskAgentPromptPack, userPrompt: string, projectPath: string): string {
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
    ``,
    `# OUTPUT RULES`,
    `- 한국어로만 답변한다.`,
    `- 실제로 수정한 파일이 있으면 파일 경로와 변경 이유를 짧게 적는다.`,
    `- 작업을 못 했다면 못 한 이유를 숨기지 않는다.`,
  ].join("\n");
}

function resolveTurnText(raw: unknown): string {
  return (
    extractStringByPaths(raw, [
      "text",
      "output_text",
      "turn.output_text",
      "turn.response.output_text",
      "turn.response.text",
      "response.output_text",
      "response.text",
    ]) ?? extractDeltaText(raw)
  ).trim();
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
  const sandboxMode = normalizeSandboxMode(pack.sandboxMode);
  const modelEngine = toTurnModelEngineId(input.model || pack.model || context.threadModel || "GPT-5.4");
  const reasoningEffort = toTurnReasoningEffort(
    input.reasoning || pack.modelReasoningEffort || context.threadReasoning || "중간",
  );
  const promptText = buildRoleTurnPrompt(pack, input.prompt ?? "", context.projectPath);

  const threadStart = await input.invokeFn<ThreadStartResult>("thread_start", {
    model: modelEngine,
    cwd: context.projectPath,
    sandboxMode,
  });
  const rawResponse = await input.invokeFn<unknown>("turn_start_blocking", {
    threadId: threadStart.threadId,
    text: promptText,
    reasoningEffort,
    sandboxMode,
  });

  const completedStatus = (extractCompletedStatus(rawResponse) ?? "done").toLowerCase();
  if (["failed", "error", "cancelled", "rejected"].includes(completedStatus)) {
    throw new Error(`Codex turn failed (${completedStatus})`);
  }

  const summary = resolveTurnText(rawResponse);
  if (!summary) {
    throw new Error("Codex turn finished without a readable response");
  }

  const artifactDir = `${input.storageCwd.replace(/[\\/]+$/, "")}/.rail/tasks/${input.taskId}/codex_runs/${input.runId}`;
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
        raw: rawResponse,
      },
      null,
      2,
    )}\n`,
  });

  return {
    summary,
    artifactPaths: [promptArtifactPath, responseArtifactPath, responseJsonPath],
    usage: extractUsageStats(rawResponse),
    codexThreadId: threadStart.threadId,
    codexTurnId:
      extractStringByPaths(rawResponse, ["turnId", "turn_id", "id", "turn.id", "response.id"]) ?? undefined,
  };
}
