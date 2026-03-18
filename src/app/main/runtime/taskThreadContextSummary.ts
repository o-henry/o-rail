type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type ThreadMessageLike = {
  role?: string | null;
  content?: string | null;
  eventKind?: string | null;
  agentLabel?: string | null;
};

type ThreadDetailLike = {
  task?: {
    goal?: string | null;
    workspacePath?: string | null;
    worktreePath?: string | null;
  };
  workflow?: {
    currentStageId?: string | null;
  };
  approvals?: Array<unknown>;
  changedFiles?: string[];
  artifacts?: Record<string, string>;
  messages?: ThreadMessageLike[];
};

function trimLine(value: string, maxChars: number): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function trimBlock(value: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

export function formatTaskThreadContextSummary(detail: ThreadDetailLike, maxChars = 2600): string {
  const lines: string[] = [];
  const worktreePath = String(detail.task?.worktreePath || detail.task?.workspacePath || "").trim();
  if (worktreePath) {
    lines.push(`- 작업 경로: ${trimLine(worktreePath, 120)}`);
  }

  const goal = String(detail.task?.goal ?? "").trim();
  if (goal) {
    lines.push(`- 현재 목표: ${trimLine(goal, 120)}`);
  }

  const stageId = String(detail.workflow?.currentStageId ?? "").trim();
  if (stageId) {
    lines.push(`- 현재 단계: ${stageId}`);
  }

  if (Array.isArray(detail.approvals) && detail.approvals.length > 0) {
    lines.push(`- 대기 승인: ${detail.approvals.length}건`);
  }

  const changedFiles = Array.isArray(detail.changedFiles) ? detail.changedFiles.slice(0, 8) : [];
  if (changedFiles.length > 0) {
    lines.push(`- 변경 파일 후보: ${changedFiles.join(", ")}`);
  }

  const artifactEntries = Object.entries(detail.artifacts ?? {})
    .filter(([, content]) => String(content ?? "").trim().length > 0)
    .slice(0, 3)
    .map(([key, content]) => `- ${key}: ${trimBlock(content, 220)}`);
  if (artifactEntries.length > 0) {
    lines.push("- 기존 산출물 요약:");
    lines.push(...artifactEntries);
  }

  const recentMessages = (detail.messages ?? [])
    .filter((message) => {
      const eventKind = String(message.eventKind ?? "").trim();
      return !["agent_status", "agent_created", "thread_synthesis_ready"].includes(eventKind);
    })
    .slice(-4)
    .map((message) => {
      const speaker = String(message.agentLabel || message.role || "system").trim().toUpperCase();
      return `- ${speaker}: ${trimBlock(String(message.content ?? ""), 220)}`;
    });
  if (recentMessages.length > 0) {
    lines.push("- 최근 대화:");
    lines.push(...recentMessages);
  }

  const summary = lines.join("\n").trim();
  return trimBlock(summary, maxChars);
}

export async function buildTaskThreadContextSummary(params: {
  invokeFn: InvokeFn;
  cwd: string;
  threadId: string;
  maxChars?: number;
}): Promise<string> {
  const detail = await params.invokeFn<ThreadDetailLike>("thread_load", {
    cwd: params.cwd,
    threadId: params.threadId,
  });
  return formatTaskThreadContextSummary(detail, params.maxChars);
}
