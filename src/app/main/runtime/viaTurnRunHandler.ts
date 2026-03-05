import type { MutableRefObject } from "react";
import type { TurnConfig, TurnExecutor } from "../../../features/workflow/domain";
import type { GraphNode } from "../../../features/workflow/types";
import type { InternalMemoryTraceEntry, KnowledgeTraceEntry } from "../types";
import { viaGetRun, viaListArtifacts, viaRunFlow, type ViaArtifact } from "./viaBridgeClient";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type ViaTurnResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
  executor: TurnExecutor;
  provider: string;
  knowledgeTrace?: KnowledgeTraceEntry[];
  memoryTrace?: InternalMemoryTraceEntry[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(() => resolve(), ms);
  });
}

function normalizeRunStatus(status: string): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  return normalized;
}

function isTerminalStatus(status: string): boolean {
  const normalized = normalizeRunStatus(status);
  return (
    normalized === "done" ||
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "cancelled"
  );
}

function buildViaOutput(params: {
  flowId: number;
  runId: string;
  status: string;
  warnings: string[];
  detail: unknown;
  artifacts: ViaArtifact[];
}): unknown {
  const timestamp = new Date().toISOString();
  return {
    provider: "via",
    timestamp,
    text: `VIA flow ${params.flowId} run ${params.runId} status ${params.status}`,
    artifacts: params.artifacts,
    via: {
      flowId: params.flowId,
      runId: params.runId,
      status: params.status,
      warnings: params.warnings,
      detail: params.detail,
      artifacts: params.artifacts,
    },
  };
}

export async function runViaFlowTurn(params: {
  node: GraphNode;
  config: TurnConfig;
  cwd: string;
  invokeFn: InvokeFn;
  pauseRequestedRef: MutableRefObject<boolean>;
  cancelRequestedRef: MutableRefObject<boolean>;
  pauseErrorToken: string;
  addNodeLog: (nodeId: string, message: string) => void;
  t: (key: string) => string;
  executor: TurnExecutor;
  knowledgeTrace?: KnowledgeTraceEntry[];
  memoryTrace?: InternalMemoryTraceEntry[];
}): Promise<ViaTurnResult> {
  const normalizedFlowIdRaw = String(params.config.viaFlowId ?? "").trim();
  const flowId = Number(normalizedFlowIdRaw);
  if (!normalizedFlowIdRaw || !Number.isInteger(flowId) || flowId <= 0) {
    return {
      ok: false,
      error: "VIA flow_id를 올바르게 입력하세요. (양의 정수)",
      executor: params.executor,
      provider: "via",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }

  if (params.pauseRequestedRef.current) {
    return {
      ok: false,
      error: params.pauseErrorToken,
      executor: params.executor,
      provider: "via",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }

  if (params.cancelRequestedRef.current) {
    return {
      ok: false,
      error: params.t("run.cancelledByUserShort"),
      executor: params.executor,
      provider: "via",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }

  const timeoutMs = Math.max(10_000, Number(params.config.webTimeoutMs ?? 180_000) || 180_000);
  const pollIntervalMs = 1_200;

  params.addNodeLog(params.node.id, `[VIA] flow_id=${flowId} 실행 요청`);

  try {
    const initial = await viaRunFlow({
      invokeFn: params.invokeFn,
      cwd: params.cwd,
      flowId,
      trigger: "manual",
    });

    if (!initial.runId) {
      return {
        ok: false,
        error: "VIA 실행 응답에 run_id가 없습니다.",
        executor: params.executor,
        provider: "via",
        knowledgeTrace: params.knowledgeTrace,
        memoryTrace: params.memoryTrace,
      };
    }

    const runId = initial.runId;
    let status = normalizeRunStatus(initial.status);
    let warnings = Array.isArray(initial.warnings) ? initial.warnings : [];
    let detail = initial.detail;
    let artifacts = Array.isArray(initial.artifacts) ? initial.artifacts : [];

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (params.pauseRequestedRef.current) {
        return {
          ok: false,
          error: params.pauseErrorToken,
          executor: params.executor,
          provider: "via",
          knowledgeTrace: params.knowledgeTrace,
          memoryTrace: params.memoryTrace,
        };
      }
      if (params.cancelRequestedRef.current) {
        return {
          ok: false,
          error: params.t("run.cancelledByUserShort"),
          executor: params.executor,
          provider: "via",
          knowledgeTrace: params.knowledgeTrace,
          memoryTrace: params.memoryTrace,
        };
      }

      if (isTerminalStatus(status) && (status !== "done" || artifacts.length > 0)) {
        break;
      }

      const run = await viaGetRun({
        invokeFn: params.invokeFn,
        cwd: params.cwd,
        runId,
      });
      status = normalizeRunStatus(run.status || status);
      detail = run.detail ?? detail;
      if (Array.isArray(run.warnings) && run.warnings.length > 0) {
        warnings = run.warnings;
      }

      const listed = await viaListArtifacts({
        invokeFn: params.invokeFn,
        cwd: params.cwd,
        runId,
      });
      if (listed.length > 0) {
        artifacts = listed;
      }

      if (isTerminalStatus(status) && (status !== "done" || artifacts.length > 0)) {
        break;
      }

      await sleep(pollIntervalMs);
    }

    if (!isTerminalStatus(status)) {
      return {
        ok: false,
        error: `VIA 실행 타임아웃(${timeoutMs}ms): run_id=${runId}`,
        executor: params.executor,
        provider: "via",
        knowledgeTrace: params.knowledgeTrace,
        memoryTrace: params.memoryTrace,
      };
    }

    if (status !== "done") {
      return {
        ok: false,
        error: `VIA 실행 실패: status=${status}, run_id=${runId}`,
        executor: params.executor,
        provider: "via",
        knowledgeTrace: params.knowledgeTrace,
        memoryTrace: params.memoryTrace,
        output: buildViaOutput({
          flowId,
          runId,
          status,
          warnings,
          detail,
          artifacts,
        }),
      };
    }

    params.addNodeLog(params.node.id, `[VIA] 완료 run_id=${runId}, artifacts=${artifacts.length}`);

    return {
      ok: true,
      output: buildViaOutput({
        flowId,
        runId,
        status,
        warnings,
        detail,
        artifacts,
      }),
      executor: params.executor,
      provider: "via",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  } catch (error) {
    return {
      ok: false,
      error: `VIA 실행 실패: ${String(error)}`,
      executor: params.executor,
      provider: "via",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }
}
