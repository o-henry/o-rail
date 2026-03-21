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
