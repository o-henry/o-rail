import {
  createAgenticRunEnvelope,
  createAgenticRunId,
  normalizeAgenticRunId,
  patchRunStage,
  patchRunStatus,
  queueKeyForRole,
  type AgenticRunEnvelope,
  type AgenticRunEvent,
  type AgenticRunSourceTab,
} from "../../../features/orchestration/agentic/runContract";
import { persistAgenticRunEnvelope, persistAgenticRunEvents } from "./agenticRunStore";
import type { AgenticQueue } from "./agenticQueue";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type MutableRunContext = {
  envelope: AgenticRunEnvelope;
  events: AgenticRunEvent[];
};

type RoleKnowledgeBootstrapResult = {
  message?: string;
  artifactPaths?: string[];
  payload?: Record<string, unknown>;
};

type RoleKnowledgeStoreResult = {
  message?: string;
  artifactPaths?: string[];
  payload?: Record<string, unknown>;
};

type RoleKnowledgeInjectResult = {
  message?: string;
  prompt?: string;
  payload?: Record<string, unknown>;
};

export type AgenticRunRoleInput = {
  runId?: string;
  queueKeyOverride?: string;
  cwd: string;
  sourceTab: AgenticRunSourceTab;
  roleId: string;
  taskId: string;
  prompt?: string;
  queue: AgenticQueue;
  invokeFn: InvokeFn;
  execute: (params: { runId: string; roleId: string; taskId: string; prompt?: string }) => Promise<void>;
  appendWorkspaceEvent?: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
  }) => void;
  onEvent?: (event: AgenticRunEvent, envelope: AgenticRunEnvelope) => void;
  roleKnowledgePipeline?: {
    bootstrap?: (params: {
      runId: string;
      roleId: string;
      taskId: string;
      prompt?: string;
    }) => Promise<RoleKnowledgeBootstrapResult | null>;
    store?: (params: {
      runId: string;
      roleId: string;
      taskId: string;
      prompt?: string;
      bootstrap?: RoleKnowledgeBootstrapResult | null;
    }) => Promise<RoleKnowledgeStoreResult | null>;
    inject?: (params: {
      runId: string;
      roleId: string;
      taskId: string;
      prompt?: string;
      bootstrap?: RoleKnowledgeBootstrapResult | null;
      store?: RoleKnowledgeStoreResult | null;
    }) => Promise<RoleKnowledgeInjectResult | null>;
  };
};

export type AgenticCoordinatorRunResult = {
  runId: string;
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

async function persistRunContext(params: { cwd: string; invokeFn: InvokeFn; context: MutableRunContext }) {
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
      runKind: params.context.envelope.record.runKind,
      events: params.context.events,
    }),
  ]);
}

function emitRunEvent(params: {
  context: MutableRunContext;
  type: AgenticRunEvent["type"];
  message?: string;
  stage?: "crawler" | "rag" | "codex" | "critic" | "save" | "approval";
  payload?: Record<string, unknown>;
  onEvent?: (event: AgenticRunEvent, envelope: AgenticRunEnvelope) => void;
}) {
  const event: AgenticRunEvent = {
    at: nowIso(),
    runId: params.context.envelope.record.runId,
    queueKey: params.context.envelope.record.queueKey,
    sourceTab: params.context.envelope.record.sourceTab,
    topic: params.context.envelope.record.topic,
    setId: params.context.envelope.record.setId,
    type: params.type,
    stage: params.stage,
    message: params.message,
    payload: params.payload,
  };
  params.context.events.push(event);
  params.onEvent?.(event, params.context.envelope);
}

function emitWorkspace(params: {
  appendWorkspaceEvent?: AgenticRunRoleInput["appendWorkspaceEvent"];
  source: string;
  message: string;
  runId: string;
  level?: "info" | "error";
}) {
  params.appendWorkspaceEvent?.({
    source: params.source,
    message: params.message,
    actor: "ai",
    level: params.level ?? "info",
    runId: params.runId,
  });
}

function appendArtifactsFromPaths(params: {
  context: MutableRunContext;
  paths: string[];
}) {
  for (const path of params.paths) {
    const trimmed = String(path ?? "").trim();
    if (!trimmed) {
      continue;
    }
    if (params.context.envelope.artifacts.some((row) => row.path === trimmed)) {
      continue;
    }
    params.context.envelope.artifacts.push({
      kind: "raw",
      path: trimmed,
    });
  }
}

export async function runRoleWithCoordinator(input: AgenticRunRoleInput): Promise<AgenticCoordinatorRunResult> {
  const runId = normalizeAgenticRunId(input.runId) || createAgenticRunId("role");
  const queueKey = String(input.queueKeyOverride ?? "").trim() || queueKeyForRole(input.roleId);
  const context: MutableRunContext = {
    envelope: createAgenticRunEnvelope({
      runId,
      runKind: "studio_role",
      sourceTab: input.sourceTab,
      queueKey,
      roleId: input.roleId,
      taskId: input.taskId,
      approvalState: "pending",
    }),
    events: [],
  };

  emitRunEvent({ context, type: "run_queued", message: "queued", onEvent: input.onEvent });
  emitWorkspace({
    appendWorkspaceEvent: input.appendWorkspaceEvent,
    source: "agentic",
    message: `역할 실행 대기열 등록: ${input.roleId} (${input.taskId})`,
    runId,
  });
  await persistRunContext({ cwd: input.cwd, invokeFn: input.invokeFn, context });

  return input.queue.enqueue(queueKey, async () => {
    context.envelope = patchRunStatus(context.envelope, "running");
    emitRunEvent({ context, type: "run_started", message: "started", onEvent: input.onEvent });
    let effectivePrompt = input.prompt;
    let bootstrapResult: RoleKnowledgeBootstrapResult | null = null;
    let storeResult: RoleKnowledgeStoreResult | null = null;
    let injectResult: RoleKnowledgeInjectResult | null = null;

    if (input.roleKnowledgePipeline?.bootstrap) {
      context.envelope = patchRunStage(context.envelope, "crawler", "running", "ROLE_KB_BOOTSTRAP 실행 중");
      emitRunEvent({
        context,
        type: "stage_started",
        stage: "crawler",
        message: "ROLE_KB_BOOTSTRAP 실행 중",
        onEvent: input.onEvent,
      });
      try {
        bootstrapResult = await input.roleKnowledgePipeline.bootstrap({
          runId,
          roleId: input.roleId,
          taskId: input.taskId,
          prompt: effectivePrompt,
        });
        context.envelope = patchRunStage(
          context.envelope,
          "crawler",
          "done",
          bootstrapResult?.message ?? "ROLE_KB_BOOTSTRAP 완료",
        );
        appendArtifactsFromPaths({
          context,
          paths: bootstrapResult?.artifactPaths ?? [],
        });
        emitRunEvent({
          context,
          type: "stage_done",
          stage: "crawler",
          message: bootstrapResult?.message ?? "ROLE_KB_BOOTSTRAP 완료",
          onEvent: input.onEvent,
        });
        emitWorkspace({
          appendWorkspaceEvent: input.appendWorkspaceEvent,
          source: "agentic",
          message: bootstrapResult?.message ?? "ROLE_KB_BOOTSTRAP 완료",
          runId,
        });
      } catch (error) {
        const errorText = `ROLE_KB_BOOTSTRAP 실패: ${normalizeError(error)}`;
        context.envelope = patchRunStage(context.envelope, "crawler", "error", errorText, errorText);
        context.envelope.metrics.warnings = [...context.envelope.metrics.warnings, errorText];
        emitRunEvent({
          context,
          type: "stage_error",
          stage: "crawler",
          message: errorText,
          payload: { error: errorText },
          onEvent: input.onEvent,
        });
        emitWorkspace({
          appendWorkspaceEvent: input.appendWorkspaceEvent,
          source: "agentic",
          message: errorText,
          runId,
          level: "error",
        });
      }
    }

    if (input.roleKnowledgePipeline?.store) {
      context.envelope = patchRunStage(context.envelope, "save", "running", "ROLE_KB_STORE 실행 중");
      emitRunEvent({
        context,
        type: "stage_started",
        stage: "save",
        message: "ROLE_KB_STORE 실행 중",
        onEvent: input.onEvent,
      });
      try {
        storeResult = await input.roleKnowledgePipeline.store({
          runId,
          roleId: input.roleId,
          taskId: input.taskId,
          prompt: effectivePrompt,
          bootstrap: bootstrapResult,
        });
        context.envelope = patchRunStage(
          context.envelope,
          "save",
          "done",
          storeResult?.message ?? "ROLE_KB_STORE 완료",
        );
        appendArtifactsFromPaths({
          context,
          paths: storeResult?.artifactPaths ?? [],
        });
        emitRunEvent({
          context,
          type: "stage_done",
          stage: "save",
          message: storeResult?.message ?? "ROLE_KB_STORE 완료",
          onEvent: input.onEvent,
        });
        emitWorkspace({
          appendWorkspaceEvent: input.appendWorkspaceEvent,
          source: "agentic",
          message: storeResult?.message ?? "ROLE_KB_STORE 완료",
          runId,
        });
      } catch (error) {
        const errorText = `ROLE_KB_STORE 실패: ${normalizeError(error)}`;
        context.envelope = patchRunStage(context.envelope, "save", "error", errorText, errorText);
        context.envelope.metrics.warnings = [...context.envelope.metrics.warnings, errorText];
        emitRunEvent({
          context,
          type: "stage_error",
          stage: "save",
          message: errorText,
          payload: { error: errorText },
          onEvent: input.onEvent,
        });
        emitWorkspace({
          appendWorkspaceEvent: input.appendWorkspaceEvent,
          source: "agentic",
          message: errorText,
          runId,
          level: "error",
        });
      }
    }

    if (input.roleKnowledgePipeline?.inject) {
      context.envelope = patchRunStage(context.envelope, "rag", "running", "ROLE_KB_INJECT 실행 중");
      emitRunEvent({
        context,
        type: "stage_started",
        stage: "rag",
        message: "ROLE_KB_INJECT 실행 중",
        onEvent: input.onEvent,
      });
      try {
        injectResult = await input.roleKnowledgePipeline.inject({
          runId,
          roleId: input.roleId,
          taskId: input.taskId,
          prompt: effectivePrompt,
          bootstrap: bootstrapResult,
          store: storeResult,
        });
        if (typeof injectResult?.prompt === "string") {
          effectivePrompt = injectResult.prompt;
        }
        context.envelope = patchRunStage(
          context.envelope,
          "rag",
          "done",
          injectResult?.message ?? "ROLE_KB_INJECT 완료",
        );
        emitRunEvent({
          context,
          type: "stage_done",
          stage: "rag",
          message: injectResult?.message ?? "ROLE_KB_INJECT 완료",
          onEvent: input.onEvent,
        });
        emitWorkspace({
          appendWorkspaceEvent: input.appendWorkspaceEvent,
          source: "agentic",
          message: injectResult?.message ?? "ROLE_KB_INJECT 완료",
          runId,
        });
      } catch (error) {
        const errorText = `ROLE_KB_INJECT 실패: ${normalizeError(error)}`;
        context.envelope = patchRunStage(context.envelope, "rag", "error", errorText, errorText);
        context.envelope.metrics.warnings = [...context.envelope.metrics.warnings, errorText];
        emitRunEvent({
          context,
          type: "stage_error",
          stage: "rag",
          message: errorText,
          payload: { error: errorText },
          onEvent: input.onEvent,
        });
        emitWorkspace({
          appendWorkspaceEvent: input.appendWorkspaceEvent,
          source: "agentic",
          message: errorText,
          runId,
          level: "error",
        });
      }
    }

    context.envelope = patchRunStage(context.envelope, "codex", "running", "역할 실행 시작");
    emitRunEvent({ context, type: "stage_started", stage: "codex", message: "역할 실행 시작", onEvent: input.onEvent });

    try {
      await input.execute({
        runId,
        roleId: input.roleId,
        taskId: input.taskId,
        prompt: effectivePrompt,
      });
      context.envelope = patchRunStage(context.envelope, "codex", "done", "역할 실행 완료");
      context.envelope = patchRunStage(context.envelope, "save", "done", "저장 완료");
      context.envelope = patchRunStatus(context.envelope, "done");
      context.envelope.record.approvalState = "pending";
      emitRunEvent({ context, type: "stage_done", stage: "codex", message: "역할 실행 완료", onEvent: input.onEvent });
      emitRunEvent({ context, type: "run_done", message: "done", onEvent: input.onEvent });
      emitWorkspace({
        appendWorkspaceEvent: input.appendWorkspaceEvent,
        source: "agentic",
        message: `[${runId}] 역할 실행 완료: ${input.roleId}/${input.taskId}`,
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
        message: `[${runId}] 역할 실행 실패: ${errorText}`,
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
