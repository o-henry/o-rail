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

function latestArtifactPath(paths: string[] | null | undefined): string {
  const normalized = [...(paths ?? [])]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return normalized[normalized.length - 1] ?? "";
}

export function buildLiveAgentCards(
  detail: ThreadDetail | null,
  liveNotes?: Partial<Record<ThreadRoleId, LiveRoleNote>>,
): LiveAgentCard[] {
  if (!detail) {
    return [];
  }

  return detail.agents
    .filter((agent) => agent.status !== "idle" && agent.status !== "done")
    .map((agent) => {
      const roleState = detail.task.roles.find((role) => role.id === agent.roleId);
      const note = liveNotes?.[agent.roleId];
      return {
        agentId: agent.id,
        label: agent.label,
        roleId: agent.roleId,
        status: agent.status,
        summary: String(note?.message ?? "").trim()
          || String(agent.summary ?? "").trim()
          || String(roleState?.lastPrompt ?? "").trim(),
        latestArtifactPath: latestArtifactPath(roleState?.artifactPaths),
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
