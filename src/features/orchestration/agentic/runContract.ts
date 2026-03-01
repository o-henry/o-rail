export type AgenticRunSourceTab = "agents" | "workflow" | "intelligence" | "dashboard" | "feed" | "system";
export type AgenticTopicId = string;

export type AgenticRunStatus = "queued" | "running" | "done" | "error";

export type AgenticRunStageKey = "crawler" | "rag" | "codex" | "critic" | "save" | "approval";

export type AgenticRunStageStatus = "idle" | "running" | "done" | "error" | "skipped";

export type AgenticRunRecord = {
  runId: string;
  sourceTab: AgenticRunSourceTab;
  topic?: AgenticTopicId;
  setId?: string;
  queueKey: string;
  status: AgenticRunStatus;
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

export function queueKeyForTopic(topic: AgenticTopicId): string {
  return `topic:${topic}`;
}

export function queueKeyForGraph(graphId?: string): string {
  const normalized = String(graphId ?? "").trim() || "default";
  return `graph:${normalized}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createAgenticRunEnvelope(params: {
  runId?: string;
  sourceTab: AgenticRunSourceTab;
  queueKey: string;
  topic?: AgenticTopicId;
  setId?: string;
}): AgenticRunEnvelope {
  const now = nowIso();
  return {
    record: {
      runId: params.runId ?? createAgenticRunId(params.sourceTab),
      sourceTab: params.sourceTab,
      topic: params.topic,
      setId: params.setId,
      queueKey: params.queueKey,
      status: "queued",
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
        path: normalizedPath,
      },
    ],
  };
}
