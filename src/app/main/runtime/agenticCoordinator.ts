import type { DashboardTopicId } from "../../../features/dashboard/intelligence";
import {
  appendRunArtifact,
  createAgenticRunEnvelope,
  createAgenticRunId,
  patchRunStage,
  patchRunStatus,
  queueKeyForGraph,
  queueKeyForTopic,
  type AgenticArtifactRef,
  type AgenticRunEnvelope,
  type AgenticRunEvent,
  type AgenticRunSourceTab,
  type AgenticRunStageKey,
} from "../../../features/orchestration/agentic/runContract";
import { persistAgenticRunEnvelope, persistAgenticRunEvents } from "./agenticRunStore";
import type { AgenticQueue } from "./agenticQueue";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type AgenticTopicExecutionResult = {
  snapshotPath?: string | null;
  rawPaths?: string[];
  warnings?: string[];
};

export type AgenticRunTopicInput = {
  cwd: string;
  topic: DashboardTopicId;
  sourceTab: AgenticRunSourceTab;
  followupInstruction?: string;
  setId?: string;
  queue: AgenticQueue;
  invokeFn: InvokeFn;
  execute: (params: {
    runId: string;
    topic: DashboardTopicId;
    followupInstruction?: string;
    onProgress?: (stage: string, message: string) => void;
  }) => Promise<AgenticTopicExecutionResult | null>;
  appendWorkspaceEvent?: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
    topic?: DashboardTopicId;
  }) => void;
  onEvent?: (event: AgenticRunEvent, envelope: AgenticRunEnvelope) => void;
};

export type AgenticRunGraphInput = {
  cwd: string;
  sourceTab: AgenticRunSourceTab;
  graphId?: string;
  setId?: string;
  queue: AgenticQueue;
  invokeFn: InvokeFn;
  execute: (params: { runId: string }) => Promise<void>;
  appendWorkspaceEvent?: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
  }) => void;
  onEvent?: (event: AgenticRunEvent, envelope: AgenticRunEnvelope) => void;
};

export type AgenticCoordinatorRunResult = {
  runId: string;
  envelope: AgenticRunEnvelope;
  events: AgenticRunEvent[];
};

type MutableRunContext = {
  envelope: AgenticRunEnvelope;
  events: AgenticRunEvent[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeError(error: unknown): string {
  const text = String(error ?? "").trim();
  return text || "unknown error";
}

function mapDashboardStage(rawStage: string): { stage: AgenticRunStageKey; status: "running" | "done" } | null {
  const stage = String(rawStage ?? "").trim().toLowerCase();
  switch (stage) {
    case "init":
    case "crawler":
      return { stage: "crawler", status: "running" };
    case "crawler_done":
      return { stage: "crawler", status: "done" };
    case "rag":
      return { stage: "rag", status: "running" };
    case "rag_done":
      return { stage: "rag", status: "done" };
    case "prompt":
    case "codex_thread":
    case "codex_turn":
    case "parse":
    case "fallback":
    case "normalize":
      return { stage: "codex", status: "running" };
    case "save":
      return { stage: "save", status: "running" };
    case "done":
      return { stage: "save", status: "done" };
    default:
      return null;
  }
}

async function persistRunContext(params: {
  cwd: string;
  invokeFn: InvokeFn;
  context: MutableRunContext;
}) {
  await Promise.all([
    persistAgenticRunEnvelope({
      cwd: params.cwd,
      invokeFn: params.invokeFn,
      envelope: params.context.envelope,
    }),
    persistAgenticRunEvents({
      cwd: params.cwd,
      invokeFn: params.invokeFn,
      runId: params.context.envelope.record.runId,
      events: params.context.events,
    }),
  ]);
}

function emitRunEvent(params: {
  context: MutableRunContext;
  type: AgenticRunEvent["type"];
  message?: string;
  stage?: AgenticRunStageKey;
  payload?: Record<string, unknown>;
  onEvent?: (event: AgenticRunEvent, envelope: AgenticRunEnvelope) => void;
}) {
  const event: AgenticRunEvent = {
    at: nowIso(),
    runId: params.context.envelope.record.runId,
    queueKey: params.context.envelope.record.queueKey,
    sourceTab: params.context.envelope.record.sourceTab,
    topic: params.context.envelope.record.topic,
    type: params.type,
    stage: params.stage,
    message: params.message,
    payload: params.payload,
  };
  params.context.events.push(event);
  params.onEvent?.(event, params.context.envelope);
}

function emitWorkspace(params: {
  appendWorkspaceEvent?: AgenticRunTopicInput["appendWorkspaceEvent"] | AgenticRunGraphInput["appendWorkspaceEvent"];
  source: string;
  message: string;
  runId: string;
  topic?: DashboardTopicId;
  level?: "info" | "error";
}) {
  params.appendWorkspaceEvent?.({
    source: params.source,
    message: params.message,
    actor: "ai",
    level: params.level ?? "info",
    runId: params.runId,
    topic: params.topic,
  });
}

function addArtifacts(
  envelope: AgenticRunEnvelope,
  artifacts: AgenticArtifactRef[],
): AgenticRunEnvelope {
  let next = envelope;
  for (const artifact of artifacts) {
    next = appendRunArtifact(next, artifact);
  }
  return next;
}

function setStageDoneIfRunning(envelope: AgenticRunEnvelope, stage: AgenticRunStageKey): AgenticRunEnvelope {
  const target = envelope.stages.find((row) => row.stage === stage);
  if (!target || target.status !== "running") {
    return envelope;
  }
  return patchRunStage(envelope, stage, "done", target.message);
}

export async function runTopicWithCoordinator(input: AgenticRunTopicInput): Promise<AgenticCoordinatorRunResult> {
  const runId = createAgenticRunId("topic");
  const context: MutableRunContext = {
    envelope: createAgenticRunEnvelope({
      runId,
      sourceTab: input.sourceTab,
      queueKey: queueKeyForTopic(input.topic),
      topic: input.topic,
      setId: input.setId,
    }),
    events: [],
  };

  emitRunEvent({ context, type: "run_queued", message: "queued", onEvent: input.onEvent });
  emitWorkspace({
    appendWorkspaceEvent: input.appendWorkspaceEvent,
    source: "agentic",
    message: `실행 대기열 등록: ${input.topic}`,
    runId,
    topic: input.topic,
  });
  await persistRunContext({ cwd: input.cwd, invokeFn: input.invokeFn, context });

  return input.queue.enqueue(context.envelope.record.queueKey, async () => {
    context.envelope = patchRunStatus(context.envelope, "running");
    emitRunEvent({ context, type: "run_started", message: "started", onEvent: input.onEvent });
    await persistRunContext({ cwd: input.cwd, invokeFn: input.invokeFn, context });

    try {
      const result = await input.execute({
        runId,
        topic: input.topic,
        followupInstruction: input.followupInstruction,
        onProgress: (stage, message) => {
          const mapped = mapDashboardStage(stage);
          if (!mapped) {
            return;
          }
          context.envelope = patchRunStage(context.envelope, mapped.stage, mapped.status, message);
          emitRunEvent({
            context,
            type: mapped.status === "done" ? "stage_done" : "stage_started",
            stage: mapped.stage,
            message,
            onEvent: input.onEvent,
          });
          emitWorkspace({
            appendWorkspaceEvent: input.appendWorkspaceEvent,
            source: "agentic",
            message,
            runId,
            topic: input.topic,
          });
        },
      });

      if (Array.isArray(result?.warnings) && result?.warnings.length > 0) {
        context.envelope.metrics.warnings = [...result.warnings];
      }

      context.envelope = setStageDoneIfRunning(context.envelope, "crawler");
      context.envelope = setStageDoneIfRunning(context.envelope, "rag");
      context.envelope = setStageDoneIfRunning(context.envelope, "codex");
      context.envelope = setStageDoneIfRunning(context.envelope, "save");

      context.envelope = addArtifacts(context.envelope, [
        ...(result?.rawPaths ?? []).map((path) => ({ kind: "raw" as const, path })),
        ...(result?.snapshotPath ? [{ kind: "snapshot" as const, path: result.snapshotPath }] : []),
      ]);
      context.envelope = patchRunStatus(context.envelope, "done");
      emitRunEvent({ context, type: "run_done", message: "done", onEvent: input.onEvent });
      emitWorkspace({
        appendWorkspaceEvent: input.appendWorkspaceEvent,
        source: "agentic",
        message: `[${runId}] ${input.topic} 실행 완료`,
        runId,
        topic: input.topic,
      });
    } catch (error) {
      const errorText = normalizeError(error);
      const currentStage =
        context.envelope.stages.find((row) => row.status === "running")?.stage ?? "codex";
      context.envelope = patchRunStage(context.envelope, currentStage, "error", errorText, errorText);
      context.envelope = patchRunStatus(context.envelope, "error");
      emitRunEvent({
        context,
        type: "stage_error",
        stage: currentStage,
        message: errorText,
        payload: { error: errorText },
        onEvent: input.onEvent,
      });
      emitRunEvent({
        context,
        type: "run_error",
        message: errorText,
        payload: { error: errorText },
        onEvent: input.onEvent,
      });
      emitWorkspace({
        appendWorkspaceEvent: input.appendWorkspaceEvent,
        source: "agentic",
        message: `[${runId}] ${input.topic} 실행 실패: ${errorText}`,
        runId,
        topic: input.topic,
        level: "error",
      });
    }

    await persistRunContext({ cwd: input.cwd, invokeFn: input.invokeFn, context });
    return {
      runId,
      envelope: context.envelope,
      events: [...context.events],
    };
  });
}

export async function runGraphWithCoordinator(input: AgenticRunGraphInput): Promise<AgenticCoordinatorRunResult> {
  const runId = createAgenticRunId("graph");
  const queueKey = queueKeyForGraph(input.graphId);
  const context: MutableRunContext = {
    envelope: createAgenticRunEnvelope({
      runId,
      sourceTab: input.sourceTab,
      queueKey,
      setId: input.setId,
    }),
    events: [],
  };

  emitRunEvent({ context, type: "run_queued", message: "queued", onEvent: input.onEvent });
  emitWorkspace({
    appendWorkspaceEvent: input.appendWorkspaceEvent,
    source: "agentic",
    message: `그래프 실행 대기열 등록: ${queueKey}`,
    runId,
  });
  await persistRunContext({ cwd: input.cwd, invokeFn: input.invokeFn, context });

  return input.queue.enqueue(queueKey, async () => {
    context.envelope = patchRunStatus(context.envelope, "running");
    context.envelope = patchRunStage(context.envelope, "codex", "running", "그래프 실행 시작");
    emitRunEvent({ context, type: "run_started", message: "started", onEvent: input.onEvent });
    emitRunEvent({ context, type: "stage_started", stage: "codex", message: "그래프 실행 시작", onEvent: input.onEvent });

    try {
      await input.execute({ runId });
      context.envelope = patchRunStage(context.envelope, "codex", "done", "그래프 실행 완료");
      context.envelope = patchRunStage(context.envelope, "save", "running", "결과 파일 수집 중");

      try {
        const runDir = await input.invokeFn<string>("run_directory");
        const normalizedDir = String(runDir ?? "").replace(/[\\/]+$/, "");
        if (normalizedDir) {
          context.envelope = addArtifacts(context.envelope, [
            {
              kind: "graph",
              path: `${normalizedDir}/run-${runId}.json`,
            },
          ]);
        }
      } catch {
        // run directory lookup is optional.
      }

      context.envelope = patchRunStage(context.envelope, "save", "done", "저장 완료");
      context.envelope = patchRunStatus(context.envelope, "done");
      emitRunEvent({ context, type: "stage_done", stage: "codex", message: "그래프 실행 완료", onEvent: input.onEvent });
      emitRunEvent({ context, type: "stage_done", stage: "save", message: "저장 완료", onEvent: input.onEvent });
      emitRunEvent({ context, type: "run_done", message: "done", onEvent: input.onEvent });
      emitWorkspace({
        appendWorkspaceEvent: input.appendWorkspaceEvent,
        source: "agentic",
        message: `[${runId}] 그래프 실행 완료`,
        runId,
      });
    } catch (error) {
      const errorText = normalizeError(error);
      context.envelope = patchRunStage(context.envelope, "codex", "error", errorText, errorText);
      context.envelope = patchRunStatus(context.envelope, "error");
      emitRunEvent({
        context,
        type: "stage_error",
        stage: "codex",
        message: errorText,
        payload: { error: errorText },
        onEvent: input.onEvent,
      });
      emitRunEvent({
        context,
        type: "run_error",
        message: errorText,
        payload: { error: errorText },
        onEvent: input.onEvent,
      });
      emitWorkspace({
        appendWorkspaceEvent: input.appendWorkspaceEvent,
        source: "agentic",
        message: `[${runId}] 그래프 실행 실패: ${errorText}`,
        runId,
        level: "error",
      });
    }

    await persistRunContext({ cwd: input.cwd, invokeFn: input.invokeFn, context });
    return {
      runId,
      envelope: context.envelope,
      events: [...context.events],
    };
  });
}
