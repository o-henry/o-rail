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

function toRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((row) => String(row ?? "").trim())
    .filter((row) => row.length > 0);
}

function formatViaStepLog(stepInput: unknown): string {
  const step = toRecord(stepInput);
  if (!step) {
    return "";
  }
  const nodeId = String(step.node_id ?? step.nodeId ?? "node").trim() || "node";
  const status = String(step.status ?? "").trim() || "unknown";
  const outputSummary = String(step.output_summary ?? step.outputSummary ?? "").trim();
  const error = String(step.error ?? "").trim();
  const message = [`[VIA:${nodeId}]`, status];
  if (outputSummary) {
    message.push(`· ${outputSummary}`);
  }
  if (error) {
    message.push(`· ${error}`);
  }
  return message.join(" ");
}

function buildViaTextSummary(params: {
  flowId: number;
  runId: string;
  status: string;
  warnings: string[];
  detail: unknown;
  artifacts: ViaArtifact[];
  preferredSourceType?: string;
}): string {
  const detailRecord = toRecord(params.detail);
  const payload = toRecord(detailRecord?.payload);
  const steps = Array.isArray(detailRecord?.steps) ? detailRecord?.steps : [];
  const highlights = toStringArray(payload?.highlights).slice(0, 8);
  const rankedItems = Array.isArray(payload?.items) ? payload?.items : [];
  const itemsAllCountRaw = payload?.items_all_count;
  const itemsAllCount =
    typeof itemsAllCountRaw === "number"
      ? itemsAllCountRaw
      : Number.isFinite(Number(itemsAllCountRaw))
        ? Number(itemsAllCountRaw)
        : undefined;
  const coverage = toRecord(payload?.coverage);
  const coverageCount = coverage ? Object.keys(coverage).length : 0;
  const crawlDepth = toRecord(detailRecord?.crawl_depth);
  const enriched = Number(crawlDepth?.items_with_content ?? 0);
  const totalItems = Number(crawlDepth?.items_total ?? 0);
  const lines = [
    `VIA flow ${params.flowId} run ${params.runId} status ${params.status}`,
    `artifacts=${params.artifacts.length}`,
  ];
  if (typeof itemsAllCount === "number" && Number.isFinite(itemsAllCount)) {
    lines.push(`items_all_count=${itemsAllCount}`);
  }
  if (coverageCount > 0) {
    lines.push(`coverage_sources=${coverageCount}`);
  }
  if (totalItems > 0) {
    lines.push(`content_enriched=${enriched}/${totalItems}`);
  }
  if (highlights.length > 0) {
    lines.push("highlights:");
    for (const line of highlights) {
      lines.push(`- ${line}`);
    }
  }
  if (params.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of params.warnings.slice(0, 8)) {
      lines.push(`- ${warning}`);
    }
  }
  if (steps.length > 0) {
    lines.push(`steps=${steps.length}`);
  }
  const preferredSourceType = String(params.preferredSourceType ?? "").trim().toLowerCase();
  const preferredItems =
    preferredSourceType && preferredSourceType.startsWith("source.")
      ? rankedItems.filter((row) => {
          const record = toRecord(row);
          const sourceType = String(record?.source_type ?? record?.sourceType ?? "").trim().toLowerCase();
          return sourceType === preferredSourceType;
        })
      : rankedItems;
  const topRows = preferredItems.slice(0, 6);
  if (topRows.length > 0) {
    lines.push("top_items:");
    for (const row of topRows) {
      const record = toRecord(row);
      if (!record) {
        continue;
      }
      const title = String(record.title ?? "").trim() || "(no title)";
      const source = String(record.source_name ?? record.sourceName ?? "").trim();
      const country = String(record.country ?? "").trim();
      const url = String(record.url ?? "").trim();
      const summary = String(record.content_excerpt ?? record.summary ?? "").replace(/\s+/g, " ").trim();
      const header = [source ? `[${source}]` : "", country ? `(${country})` : "", title]
        .filter((part) => part.length > 0)
        .join(" ");
      lines.push(`- ${header}`);
      if (url) {
        lines.push(`  url: ${url}`);
      }
      if (summary) {
        lines.push(`  summary: ${summary.slice(0, 260)}`);
      }
    }
  }
  return lines.join("\n");
}

function buildViaOutput(params: {
  flowId: number;
  runId: string;
  status: string;
  warnings: string[];
  detail: unknown;
  artifacts: ViaArtifact[];
  preferredSourceType?: string;
}): unknown {
  const timestamp = new Date().toISOString();
  return {
    provider: "via",
    timestamp,
    text: buildViaTextSummary(params),
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
  const preferredSourceType = String((params.config as Record<string, unknown>)?.viaSourceTypeHint ?? "")
    .trim()
    .toLowerCase()
    || String((params.config as Record<string, unknown>)?.viaNodeType ?? "")
      .trim()
      .toLowerCase();
  const normalizedSourceType =
    preferredSourceType.startsWith("source.") ? preferredSourceType : "";

  params.addNodeLog(params.node.id, `[VIA] flow_id=${flowId} 실행 요청`);

  try {
    const initial = await viaRunFlow({
      invokeFn: params.invokeFn,
      cwd: params.cwd,
      flowId,
      trigger: "manual",
      sourceType: normalizedSourceType || undefined,
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
    const seenStepLogs = new Set<string>();
    const seenWarnings = new Set<string>();
    let lastLoggedStatus = "";

    const appendViaProgressLogs = () => {
      if (status && status !== lastLoggedStatus) {
        params.addNodeLog(params.node.id, `[VIA] 상태=${status}`);
        lastLoggedStatus = status;
      }
      for (const warning of warnings) {
        const normalized = String(warning ?? "").trim();
        if (!normalized || seenWarnings.has(normalized)) {
          continue;
        }
        seenWarnings.add(normalized);
        params.addNodeLog(params.node.id, `[VIA][경고] ${normalized}`);
      }
      const detailRecord = toRecord(detail);
      const steps = Array.isArray(detailRecord?.steps) ? detailRecord?.steps : [];
      for (const step of steps) {
        const line = formatViaStepLog(step);
        if (!line || seenStepLogs.has(line)) {
          continue;
        }
        seenStepLogs.add(line);
        params.addNodeLog(params.node.id, line);
      }
    };

    appendViaProgressLogs();

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
      appendViaProgressLogs();

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
          preferredSourceType,
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
        preferredSourceType,
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
