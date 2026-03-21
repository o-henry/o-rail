import type { ThreadDetail, ThreadRoleId, BackgroundAgentStatus } from "./threadTypes";

export type LiveRoleNote = {
  message: string;
  updatedAt: string;
};

export type LiveAgentCard = {
  agentId: string;
  label: string;
  roleId: ThreadRoleId;
  status: BackgroundAgentStatus;
  summary: string;
  latestArtifactPath: string;
  lastRunId: string;
  updatedAt: string;
};

export type LiveActivityState = "active" | "delayed" | "stalled";
export type LiveAgentEvent = {
  type: string;
  stage: string;
  message: string;
  at: string;
};

function latestArtifactPath(paths: string[] | null | undefined): string {
  const normalized = [...(paths ?? [])]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return normalized[normalized.length - 1] ?? "";
}

export function isLiveBackgroundAgentStatus(status: BackgroundAgentStatus | string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized !== "idle" && normalized !== "done" && normalized !== "failed";
}

export function buildLiveAgentCards(
  detail: ThreadDetail | null,
  liveNotes?: Partial<Record<ThreadRoleId, LiveRoleNote>>,
): LiveAgentCard[] {
  if (!detail) {
    return [];
  }

  const interrupted =
    detail.orchestration?.status === "needs_resume"
    || detail.orchestration?.status === "cancelled";
  const interruptedSummary =
    detail.orchestration?.blockedReason === "Interrupted by operator."
      ? "중단되었습니다."
      : String(detail.orchestration?.blockedReason ?? "").trim() || "중단되었습니다.";

  return detail.agents
    .filter((agent) => isLiveBackgroundAgentStatus(agent.status))
    .map((agent) => {
      const roleState = detail.task.roles.find((role) => role.id === agent.roleId);
      const note = liveNotes?.[agent.roleId];
      return {
        agentId: agent.id,
        label: agent.label,
        roleId: agent.roleId,
        status: agent.status,
        summary: interrupted
          ? interruptedSummary
          : String(note?.message ?? "").trim()
            || String(agent.summary ?? "").trim()
            || String(roleState?.lastPrompt ?? "").trim(),
        latestArtifactPath: interrupted ? "" : latestArtifactPath(roleState?.artifactPaths),
        lastRunId: String(roleState?.lastRunId ?? "").trim(),
        updatedAt: String(note?.updatedAt ?? agent.lastUpdatedAt ?? "").trim(),
      };
    });
}

export function displayArtifactName(path: string | null | undefined): string {
  const normalized = String(path ?? "").trim();
  if (!normalized) {
    return "";
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function resolveLiveActivityState(updatedAt: string | null | undefined, nowMs = Date.now()): LiveActivityState {
  const parsed = Date.parse(String(updatedAt ?? "").trim());
  if (!Number.isFinite(parsed)) {
    return "active";
  }
  const ageMs = Math.max(0, nowMs - parsed);
  if (ageMs >= 2 * 60 * 1000) {
    return "stalled";
  }
  if (ageMs >= 30 * 1000) {
    return "delayed";
  }
  return "active";
}

export function formatRelativeUpdateAge(updatedAt: string | null | undefined, labels: {
  justNow: string;
  minutesAgo: (value: number) => string;
  hoursAgo: (value: number) => string;
  daysAgo: (value: number) => string;
}): string {
  const parsed = Date.parse(String(updatedAt ?? "").trim());
  if (!Number.isFinite(parsed)) {
    return labels.justNow;
  }
  const ageMs = Math.max(0, Date.now() - parsed);
  if (ageMs < 60 * 1000) {
    return labels.justNow;
  }
  const minutes = Math.floor(ageMs / (60 * 1000));
  if (minutes < 60) {
    return labels.minutesAgo(minutes);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return labels.hoursAgo(hours);
  }
  return labels.daysAgo(Math.floor(hours / 24));
}

export function resolveRecentSourceCount(events: LiveAgentEvent[]): number | null {
  for (const event of [...events].reverse()) {
    const message = String(event.message ?? "").trim();
    const ratioMatch = message.match(/\((\d+)\s*\/\s*\d+\)/);
    if (ratioMatch) {
      return Number.parseInt(ratioMatch[1] ?? "", 10) || 0;
    }
    const countMatch = message.match(/(?:근거 수|sources?|items?)\s*:?\s*(\d+)/i);
    if (countMatch) {
      return Number.parseInt(countMatch[1] ?? "", 10) || 0;
    }
  }
  return null;
}

export function resolveLatestFailureReason(events: LiveAgentEvent[]): string {
  for (const event of [...events].reverse()) {
    const normalizedType = String(event.type ?? "").trim().toLowerCase();
    const message = String(event.message ?? "").trim();
    if (!message) {
      continue;
    }
    if (normalizedType === "stage_error" || normalizedType === "run_error") {
      return message;
    }
    if (/(retry|재시도|timeout|timed out|unauthorized|failed|error|not materialized)/i.test(message)) {
      return message;
    }
  }
  return "";
}

export function inferNextLiveAction(params: {
  stage: string | null | undefined;
  activityState: LiveActivityState;
  failureReason?: string | null;
  interrupted?: boolean;
}): string {
  if (String(params.failureReason ?? "").trim()) {
    return "실패 원인을 정리한 뒤 같은 요청을 재시도합니다.";
  }
  if (params.interrupted) {
    return "중단된 지점부터 다시 실행할지 결정합니다.";
  }
  if (params.activityState === "stalled") {
    return "현재 단계를 계속 기다리거나, 필요하면 중단 후 다시 실행합니다.";
  }
  const stage = String(params.stage ?? "").trim().toLowerCase();
  if (stage === "crawler") {
    return "후보 소스를 더 모으고 읽을 수 있는 페이지를 선별합니다.";
  }
  if (stage === "rag") {
    return "수집한 근거를 정리해 조사 프롬프트를 보강합니다.";
  }
  if (stage === "codex") {
    return "응답을 생성하고 결과 문서를 정리합니다.";
  }
  if (stage === "critic") {
    return "누락이나 충돌을 검토한 뒤 최종안을 다듬습니다.";
  }
  if (stage === "save") {
    return "산출물을 저장하고 스레드에 결과를 반영합니다.";
  }
  if (stage === "approval") {
    return "승인 결과를 반영한 뒤 다음 실행을 이어갑니다.";
  }
  return "다음 단계를 계속 진행합니다.";
}
