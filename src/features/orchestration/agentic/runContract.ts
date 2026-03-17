import type {
  AgenticChildRole,
  AgenticNextAction,
  AgenticVerificationStatus,
  AgenticWorkSurface,
} from "../types";

export type AgenticRunSourceTab =
  | "workbench"
  | "agents"
  | "workflow"
  | "tasks"
  | "intelligence"
  | "dashboard"
  | "feed"
  | "handoff"
  | "knowledge"
  | "settings"
  | "system";
export type AgenticTopicId = string;
export type AgenticRunKind = "market_topic" | "studio_role" | "graph";

export type AgenticRunStatus = "queued" | "running" | "done" | "error";

export type AgenticRunStageKey = "crawler" | "rag" | "codex" | "critic" | "save" | "approval";

export type AgenticRunStageStatus = "idle" | "running" | "done" | "error" | "skipped";

export type AgenticRunRecord = {
  runId: string;
  runKind: AgenticRunKind;
  sourceTab: AgenticRunSourceTab;
  topic?: AgenticTopicId;
  roleId?: string;
  taskId?: string;
  setId?: string;
  queueKey: string;
  status: AgenticRunStatus;
  approvalState?: "none" | "pending" | "approved" | "rejected";
  surface?: AgenticWorkSurface;
  agentRole?: AgenticChildRole;
  parentRunId?: string;
  childRunIds?: string[];
  handoffArtifactIds?: string[];
  verificationStatus?: AgenticVerificationStatus;
  nextAction?: AgenticNextAction;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgenticRunStage = {
  stage: AgenticRunStageKey;
  status: AgenticRunStageStatus;
  message?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
};

export type AgenticArtifactRef = {
  id?: string;
  kind: "raw" | "snippet" | "snapshot" | "graph" | "log";
  path: string;
  meta?: Record<string, unknown>;
};

export type AgenticRunEnvelope = {
  record: AgenticRunRecord;
  stages: AgenticRunStage[];
  artifacts: AgenticArtifactRef[];
  metrics: {
    warnings: string[];
    retries: number;
    startedAt: string;
    endedAt?: string;
  };
};

export type AgenticRunEvent = {
  at: string;
  runId: string;
  queueKey: string;
  topic?: AgenticTopicId;
  setId?: string;
  sourceTab: AgenticRunSourceTab;
  type:
    | "run_queued"
    | "run_started"
    | "run_done"
    | "run_error"
    | "stage_started"
    | "stage_done"
    | "stage_error"
    | "artifact_added";
  stage?: AgenticRunStageKey;
  message?: string;
  payload?: Record<string, unknown>;
};

export const AGENTIC_STAGE_ORDER: AgenticRunStageKey[] = ["crawler", "rag", "codex", "critic", "save", "approval"];

export function createAgenticRunId(prefix = "run"): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${random}`;
}

export function normalizeAgenticRunId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function queueKeyForTopic(topic: AgenticTopicId): string {
  return `topic:${topic}`;
}

export function queueKeyForGraph(graphId?: string): string {
  const normalized = String(graphId ?? "").trim() || "default";
  return `graph:${normalized}`;
}

export function queueKeyForRole(roleId: string): string {
  const normalized = String(roleId ?? "").trim() || "unknown-role";
  return `role:${normalized}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createAgenticRunEnvelope(params: {
  runId?: string;
  runKind?: AgenticRunKind;
  sourceTab: AgenticRunSourceTab;
  queueKey: string;
  topic?: AgenticTopicId;
  roleId?: string;
  taskId?: string;
  setId?: string;
  approvalState?: "none" | "pending" | "approved" | "rejected";
  surface?: AgenticWorkSurface;
  agentRole?: AgenticChildRole;
  parentRunId?: string;
  childRunIds?: string[];
  handoffArtifactIds?: string[];
  verificationStatus?: AgenticVerificationStatus;
  nextAction?: AgenticRunRecord["nextAction"];
  summary?: string;
}): AgenticRunEnvelope {
  const now = nowIso();
  const normalizedRunId = normalizeAgenticRunId(params.runId);
  return {
    record: {
      runId: normalizedRunId || createAgenticRunId(params.sourceTab),
      runKind: params.runKind ?? (params.topic ? "market_topic" : params.queueKey.startsWith("graph:") ? "graph" : "studio_role"),
      sourceTab: params.sourceTab,
      topic: params.topic,
      roleId: params.roleId,
      taskId: params.taskId,
      setId: params.setId,
      queueKey: params.queueKey,
      status: "queued",
      approvalState: params.approvalState ?? "none",
      surface: params.surface,
      agentRole: params.agentRole,
      parentRunId: params.parentRunId,
      childRunIds: params.childRunIds,
      handoffArtifactIds: params.handoffArtifactIds,
      verificationStatus: params.verificationStatus,
      nextAction: params.nextAction,
      summary: params.summary,
      createdAt: now,
      updatedAt: now,
    },
    stages: AGENTIC_STAGE_ORDER.map((stage) => ({ stage, status: "idle" })),
    artifacts: [],
    metrics: {
      warnings: [],
      retries: 0,
      startedAt: now,
    },
  };
}

export function patchRunRecord(
  envelope: AgenticRunEnvelope,
  patch: Partial<
    Omit<
      AgenticRunRecord,
      "runId" | "runKind" | "sourceTab" | "queueKey" | "createdAt" | "updatedAt"
    >
  >,
): AgenticRunEnvelope {
  const now = nowIso();
  return {
    ...envelope,
    record: {
      ...envelope.record,
      ...patch,
      updatedAt: now,
    },
  };
}

export function patchRunStatus(envelope: AgenticRunEnvelope, status: AgenticRunStatus): AgenticRunEnvelope {
  const now = nowIso();
  return {
    ...envelope,
    record: {
      ...envelope.record,
      status,
      updatedAt: now,
    },
    metrics: {
      ...envelope.metrics,
      endedAt: status === "done" || status === "error" ? now : envelope.metrics.endedAt,
    },
  };
}

export function patchRunStage(
  envelope: AgenticRunEnvelope,
  stage: AgenticRunStageKey,
  status: AgenticRunStageStatus,
  message?: string,
  error?: string,
): AgenticRunEnvelope {
  const now = nowIso();
  return {
    ...envelope,
    record: {
      ...envelope.record,
      updatedAt: now,
    },
    stages: envelope.stages.map((row) => {
      if (row.stage !== stage) {
        return row;
      }
      return {
        ...row,
        status,
        message: message ?? row.message,
        error: error ?? row.error,
        startedAt: status === "running" ? now : row.startedAt,
        endedAt: status === "done" || status === "error" || status === "skipped" ? now : row.endedAt,
      };
    }),
  };
}

export function appendRunArtifact(envelope: AgenticRunEnvelope, artifact: AgenticArtifactRef): AgenticRunEnvelope {
  const normalizedPath = String(artifact.path ?? "").trim();
  if (!normalizedPath) {
    return envelope;
  }
  const artifactId = String(artifact.id ?? `${artifact.kind}:${normalizedPath}`).trim();
  const deduped = envelope.artifacts.some((row) => row.kind === artifact.kind && row.path === normalizedPath);
  if (deduped) {
    return envelope;
  }
  return {
    ...envelope,
    artifacts: [
      ...envelope.artifacts,
      {
        ...artifact,
        id: artifactId,
        path: normalizedPath,
      },
    ],
  };
}
