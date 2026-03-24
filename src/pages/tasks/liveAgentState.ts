import type { ThreadDetail, ThreadRoleId, BackgroundAgentStatus } from "./threadTypes";

const LIVE_RUNTIME_STALE_WINDOW_MS = 4 * 60 * 1000;

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
export type LiveServiceState =
  | "idle"
  | "running"
  | "approval_required"
  | "failed"
  | "completed"
  | "cancelled";

export type LiveServiceStatus = {
  state: LiveServiceState;
  detail: string;
  updatedAt: string;
};

export type LiveAgentEvent = {
  type: string;
  stage: string;
  message: string;
  at: string;
};

const LIVE_STAGE_ORDER = ["crawler", "rag", "codex", "critic", "save", "approval"] as const;

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

  const orchestrationStatus = String(detail.orchestration?.status ?? "").trim().toLowerCase();
  const taskStatus = String(detail.task.status ?? "").trim().toLowerCase();
  const threadStatus = String(detail.thread.status ?? "").trim().toLowerCase();
  const interrupted =
    orchestrationStatus === "needs_resume"
    || orchestrationStatus === "cancelled";
  const interruptedSummary =
    detail.orchestration?.blockedReason === "Interrupted by operator."
      ? "중단되었습니다."
      : String(detail.orchestration?.blockedReason ?? "").trim() || "중단되었습니다.";

  const liveAgents = detail.agents.filter((agent) => isLiveBackgroundAgentStatus(agent.status));
  const freshestAgentUpdateMs = liveAgents
    .map((agent) => Date.parse(String(agent.lastUpdatedAt ?? "").trim()))
    .filter(Number.isFinite)
    .reduce<number | null>((latest, current) => (latest === null || current > latest ? current : latest), null);
  const coordinationUpdatedMs = Date.parse(String(detail.orchestration?.updatedAt ?? "").trim());
  const referenceMs = freshestAgentUpdateMs ?? (Number.isFinite(coordinationUpdatedMs) ? coordinationUpdatedMs : null);
  const staleRunningRuntime =
    orchestrationStatus === "running"
    && liveAgents.length > 0
    && typeof referenceMs === "number"
    && Date.now() - referenceMs >= LIVE_RUNTIME_STALE_WINDOW_MS;
  const taskLooksSettled = taskStatus === "archived" || taskStatus === "completed" || taskStatus === "cancelled" || taskStatus === "failed";
  const threadLooksSettled = threadStatus === "completed" || threadStatus === "cancelled" || threadStatus === "failed" || threadStatus === "error";

  if (
    !interrupted
    && (
      orchestrationStatus === "blocked"
      || orchestrationStatus === "completed"
      || staleRunningRuntime
      || (liveAgents.length > 0 && (taskLooksSettled || threadLooksSettled))
    )
  ) {
    return [];
  }

  return liveAgents
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

export function shouldShowRelativeLiveSignalAge(params: {
  activityState: LiveActivityState;
  signalDisconnected: boolean;
}): boolean {
  return params.activityState !== "stalled" && !params.signalDisconnected;
}

function normalizeRoleExecutionStatus(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function isRunningRoleExecutionStatus(value: string | null | undefined): boolean {
  const normalized = normalizeRoleExecutionStatus(value);
  return normalized === "running" || normalized === "thinking" || normalized === "queued" || normalized === "awaiting_approval";
}

function isFailedRoleExecutionStatus(value: string | null | undefined): boolean {
  const normalized = normalizeRoleExecutionStatus(value);
  return normalized === "error" || normalized === "failed";
}

function isCompletedRoleExecutionStatus(value: string | null | undefined): boolean {
  const normalized = normalizeRoleExecutionStatus(value);
  return normalized === "done" || normalized === "completed";
}

export function resolveLiveServiceStatus(detail: ThreadDetail | null): LiveServiceStatus | null {
  if (!detail) {
    return null;
  }

  const taskStatus = String(detail.task.status ?? "").trim().toLowerCase();
  const threadStatus = String(detail.thread.status ?? "").trim().toLowerCase();
  const pendingApprovalCount = detail.approvals.filter((approval) => approval.status === "pending").length;
  const enabledRoles = detail.task.roles.filter((role) => role.enabled);
  const runningRoles = enabledRoles.filter((role) => isRunningRoleExecutionStatus(role.status));
  const failedRoles = enabledRoles.filter((role) => isFailedRoleExecutionStatus(role.status));
  const completedRoles = enabledRoles.filter((role) => isCompletedRoleExecutionStatus(role.status));
  const freshestUpdate = [
    detail.task.updatedAt,
    detail.thread.updatedAt,
    ...enabledRoles.map((role) => role.updatedAt),
    ...detail.agents.map((agent) => agent.lastUpdatedAt),
    ...detail.approvals.map((approval) => approval.updatedAt || approval.createdAt),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || "";

  if (taskStatus === "completed" || threadStatus === "completed") {
    return {
      state: "completed",
      detail: "서비스 기준으로 실행이 완료되었습니다.",
      updatedAt: freshestUpdate,
    };
  }
  if (taskStatus === "cancelled" || taskStatus === "archived" || threadStatus === "cancelled") {
    return {
      state: "cancelled",
      detail: "서비스 기준으로 실행이 중단되었거나 종료되었습니다.",
      updatedAt: freshestUpdate,
    };
  }
  if (pendingApprovalCount > 0) {
    return {
      state: "approval_required",
      detail: `서비스 기준으로 승인 대기 ${pendingApprovalCount}건이 남아 있습니다.`,
      updatedAt: freshestUpdate,
    };
  }
  if (runningRoles.length > 0) {
    return {
      state: "running",
      detail: `서비스 기준으로 ${runningRoles.map((role) => role.label).join(", ")} 실행 중입니다.`,
      updatedAt: freshestUpdate,
    };
  }
  if (failedRoles.length === enabledRoles.length && enabledRoles.length > 0) {
    return {
      state: "failed",
      detail: "서비스 기준으로 모든 내부 브리프 또는 역할 실행이 실패했습니다.",
      updatedAt: freshestUpdate,
    };
  }
  if (failedRoles.length > 0) {
    return {
      state: "failed",
      detail: `서비스 기준으로 ${failedRoles.map((role) => role.label).join(", ")} 실행이 실패했습니다.`,
      updatedAt: freshestUpdate,
    };
  }
  if (completedRoles.length === enabledRoles.length && enabledRoles.length > 0) {
    return {
      state: "completed",
      detail: "서비스 기준으로 모든 역할 실행이 끝났습니다.",
      updatedAt: freshestUpdate,
    };
  }
  return {
    state: "idle",
    detail: "서비스 기준으로 현재 실행 상태를 갱신 중입니다.",
    updatedAt: freshestUpdate,
  };
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
    if (/(retry|재시도|timeout|timed out|unauthorized|failed|error|not materialized|실패)/i.test(message)) {
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
  recentSourceCount?: number | null;
}): string {
  const failureReason = String(params.failureReason ?? "").trim();
  if (failureReason.includes("ROLE_KB_BOOTSTRAP 실패")) {
    return "외부 근거 없이 진행 중이라 품질이 낮을 수 있습니다. 잠시 더 기다리거나 재시도하는 편이 좋습니다.";
  }
  if ((params.recentSourceCount ?? null) === 0 && String(params.stage ?? "").trim().toLowerCase() === "codex") {
    return "외부 근거 없이 응답을 생성 중입니다. 이 질문은 재시도하거나 수집 성공 후 다시 실행하는 편이 좋습니다.";
  }
  if (failureReason) {
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

export function describeLiveCurrentWork(params: {
  stage: string | null | undefined;
  eventType?: string | null | undefined;
  failureReason?: string | null;
  recentSourceCount?: number | null;
}): string {
  const stage = String(params.stage ?? "").trim().toLowerCase();
  const eventType = String(params.eventType ?? "").trim().toLowerCase();
  const failureReason = String(params.failureReason ?? "").trim();

  if (failureReason) {
    if (failureReason.includes("ROLE_KB_BOOTSTRAP 실패") && (params.recentSourceCount ?? null) === 0) {
      return "외부 근거 수집이 비어 있어, 현재는 내부 문맥만으로 초안을 만들거나 대체 경로를 준비하고 있습니다.";
    }
    return "직전 시도에서 문제가 생겨 원인을 정리하고 다시 시도할 준비를 하고 있습니다.";
  }

  if (stage === "crawler") {
    if (eventType === "stage_done") {
      return "외부 소스 후보를 정리했고, 다음으로 실제로 쓸 근거만 추려서 읽기 단계로 넘깁니다.";
    }
    return params.recentSourceCount != null
      ? `외부 자료 후보를 읽고 선별하는 중입니다. 지금까지 ${params.recentSourceCount}개 소스를 확보했거나 확인했습니다.`
      : "외부 자료 후보를 찾고, 읽을 가치가 있는 링크와 문서를 선별하는 중입니다.";
  }
  if (stage === "rag") {
    return eventType === "stage_done"
      ? "수집한 문서를 역할별 입력 자료로 정리했고, 이제 실제 응답 생성 단계로 넘깁니다."
      : "수집한 문서에서 핵심 주장, 근거, 리스크를 추려 역할별 입력 컨텍스트로 정리하는 중입니다.";
  }
  if (stage === "codex") {
    if (eventType === "stage_done" || eventType === "run_done") {
      return "응답 초안 생성을 마쳤고, 결과를 검토하거나 다음 합성 단계로 넘기고 있습니다.";
    }
    return "역할 프롬프트를 바탕으로 실제 응답을 생성하고, 나오는 텍스트를 수집하면서 다음 단계에 넘길 초안을 만드는 중입니다.";
  }
  if (stage === "critic") {
    return eventType === "stage_done"
      ? "충돌과 누락 검토를 마쳤고, 반영된 최종안으로 넘어가고 있습니다."
      : "여러 역할의 초안을 대조해 충돌, 누락, 과장, 구현 리스크를 검토하는 중입니다.";
  }
  if (stage === "save") {
    return eventType === "stage_done"
      ? "산출물 저장을 마쳤고, 스레드와 문서 인덱스를 갱신하고 있습니다."
      : "완성된 답변과 산출물을 스레드, 문서, 인덱스에 기록하는 중입니다.";
  }
  if (stage === "approval") {
    return eventType === "stage_done"
      ? "승인 처리가 끝났고, 후속 단계 반영을 마무리하고 있습니다."
      : "사용자 승인이나 후속 결정 결과를 기다리면서 반영 준비를 하고 있습니다.";
  }
  return "현재 단계에 맞는 작업을 계속 진행하면서 다음 단계로 넘길 준비를 하고 있습니다.";
}

export function resolveLiveStageProgress(stage: string | null | undefined): { current: number; total: number } | null {
  const normalized = String(stage ?? "").trim().toLowerCase();
  const index = LIVE_STAGE_ORDER.indexOf(normalized as (typeof LIVE_STAGE_ORDER)[number]);
  if (index < 0) {
    return null;
  }
  return {
    current: index + 1,
    total: LIVE_STAGE_ORDER.length,
  };
}
