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

function toNonNegativeNumber(input: unknown): number | null {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((row) => String(row ?? "").trim())
    .filter((row) => row.length > 0);
}

function parseCsvList(input: unknown, maxItems = 12): string[] {
  const text = String(input ?? "").trim();
  if (!text) {
    return [];
  }
  const normalized = text.replace(/\r\n?/g, "\n");
  const rows = normalized
    .split(/[\n,]+/g)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  const unique = Array.from(new Set(rows));
  return unique.slice(0, maxItems);
}

function normalizeWhitespace(input: string): string {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

function hasKorean(input: string): boolean {
  return /[가-힣]/.test(String(input ?? ""));
}

function toKoreanReadableText(input: unknown, maxLength = 260): string {
  const normalized = normalizeWhitespace(String(input ?? ""));
  if (!normalized) {
    return "";
  }
  const clipped = normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
  if (hasKorean(clipped)) {
    return clipped;
  }
  return `원문: ${clipped}`;
}

function toViaStatusLabel(status: string): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "done") {
    return "완료";
  }
  if (normalized === "running") {
    return "실행 중";
  }
  if (normalized === "failed" || normalized === "error") {
    return "실패";
  }
  if (normalized === "cancelled") {
    return "취소";
  }
  return normalized || "알 수 없음";
}

function toSourceTypeLabel(input: string): string {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (normalized === "source.news") return "뉴스";
  if (normalized === "source.sns" || normalized === "source.x" || normalized === "source.threads") return "SNS";
  if (normalized === "source.community" || normalized === "source.reddit") return "커뮤니티";
  if (normalized === "source.dev" || normalized === "source.hn") return "개발 커뮤니티";
  if (normalized === "source.market") return "주식/마켓";
  return normalized || "기타";
}

function summarizeViaHighlight(line: string): string {
  const raw = normalizeWhitespace(line);
  if (!raw) {
    return "";
  }
  const marker = raw.indexOf(":");
  if (marker < 0) {
    return toKoreanReadableText(raw, 220);
  }
  const prefix = raw.slice(0, marker).trim();
  const body = raw.slice(marker + 1).trim();
  const localizedBody = toKoreanReadableText(body, 220);
  return [prefix, localizedBody].filter(Boolean).join(": ");
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
  const codexBriefing = String(payload?.codex_briefing ?? "").replace(/\r\n?/g, "\n").trim();
  const itemsAllCountRaw = payload?.items_all_count;
  const itemsAllCount =
    typeof itemsAllCountRaw === "number"
      ? itemsAllCountRaw
      : Number.isFinite(Number(itemsAllCountRaw))
        ? Number(itemsAllCountRaw)
        : undefined;
  const coverage = toRecord(payload?.coverage);
  const bySource = toRecord(coverage?.by_source);
  const byCountry = toRecord(coverage?.by_country);
  const byStatus = toRecord(coverage?.by_status);
  const crawlDepth = toRecord(detailRecord?.crawl_depth);
  const enriched = Number(crawlDepth?.items_with_content ?? 0);
  const totalItems = Number(crawlDepth?.items_total ?? 0);
  const statusLabel = toViaStatusLabel(params.status);
  const lines = [`RAG 실행 결과: ${statusLabel}`, `- 실행 ID: ${params.runId}`, `- 산출물: ${params.artifacts.length}개`];
  const codexUsage = toRecord(payload?.codex_usage) ?? toRecord(detailRecord?.codex_usage);
  if (codexUsage) {
    const promptTokens = toNonNegativeNumber(codexUsage.prompt_tokens);
    const completionTokens = toNonNegativeNumber(codexUsage.completion_tokens);
    const totalTokens = toNonNegativeNumber(codexUsage.total_tokens);
    const usageParts = [
      promptTokens !== null ? `입력 ${promptTokens}` : "",
      completionTokens !== null ? `출력 ${completionTokens}` : "",
      totalTokens !== null ? `합계 ${totalTokens}` : "",
    ].filter((row) => row.length > 0);
    if (usageParts.length > 0) {
      lines.push(`- Codex 토큰: ${usageParts.join(" / ")}`);
    }
  }
  if (typeof itemsAllCount === "number" && Number.isFinite(itemsAllCount)) {
    lines.push(`- 수집 항목: ${itemsAllCount}개`);
  }
  if (totalItems > 0) {
    lines.push(`- 본문 확보: ${enriched}/${totalItems}`);
  }

  if (bySource && Object.keys(bySource).length > 0) {
    lines.push("", "소스 커버리지:");
    for (const [sourceType, count] of Object.entries(bySource)) {
      const amount = Number(count ?? 0);
      lines.push(`- ${toSourceTypeLabel(sourceType)}: ${Number.isFinite(amount) ? amount : count}`);
    }
  }

  if (byCountry && Object.keys(byCountry).length > 0) {
    lines.push("", "국가 분포:");
    for (const [country, count] of Object.entries(byCountry)) {
      const amount = Number(count ?? 0);
      lines.push(`- ${country}: ${Number.isFinite(amount) ? amount : count}`);
    }
  }

  if (byStatus && Object.keys(byStatus).length > 0) {
    lines.push("", "검증 상태 분포:");
    for (const [status, count] of Object.entries(byStatus)) {
      const amount = Number(count ?? 0);
      lines.push(`- ${status}: ${Number.isFinite(amount) ? amount : count}`);
    }
  }

  if (highlights.length > 0) {
    lines.push("", "핵심 요약:");
    for (const line of highlights) {
      const summaryLine = summarizeViaHighlight(line);
      if (summaryLine) {
        lines.push(`- ${summaryLine}`);
      }
    }
  }

  if (codexBriefing) {
    lines.push("", "상세 브리핑:", codexBriefing);
  }
  if (params.warnings.length > 0) {
    lines.push("", `경고 ${params.warnings.length}건:`);
    for (const warning of params.warnings.slice(0, 8)) {
      lines.push(`- ${toKoreanReadableText(warning, 220)}`);
    }
  }
  if (steps.length > 0) {
    lines.push("", `실행 단계: ${steps.length}개`);
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
    lines.push("", "핵심 근거:");
    for (const row of topRows) {
      const record = toRecord(row);
      if (!record) {
        continue;
      }
      const title = String(record.title_ko ?? record.title ?? "").trim() || "(no title)";
      const source = String(record.source_name ?? record.sourceName ?? "").trim();
      const sourceType = String(record.source_type ?? record.sourceType ?? "").trim();
      const country = String(record.country ?? "").trim();
      const url = String(record.url ?? "").trim();
      const summary = normalizeWhitespace(
        String(
          record.content_excerpt_ko
            ?? record.summary_ko
            ?? record.content_excerpt
            ?? record.summary
            ?? "",
        ),
      );
      const header = [
        country ? `[${country}]` : "",
        source ? source : toSourceTypeLabel(sourceType),
        toKoreanReadableText(title, 180),
      ]
        .filter((part) => part.length > 0)
        .join(" · ");
      lines.push(`- ${header}`);
      if (url) {
        lines.push(`  - 출처: ${url}`);
      }
      if (summary) {
        lines.push(`  - 요약: ${toKoreanReadableText(summary, 260)}`);
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
    params.addNodeLog(params.node.id, "[VIA][오류] flow_id가 비어 있거나 올바르지 않습니다.");
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
    params.addNodeLog(params.node.id, "[VIA] 일시정지 요청으로 실행을 중단했습니다.");
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
    params.addNodeLog(params.node.id, "[VIA] 사용자 취소 요청으로 실행을 중단했습니다.");
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
  const sourceOptions = (() => {
    const configRecord = params.config as Record<string, unknown>;
    const keywords = parseCsvList(configRecord?.viaCustomKeywords, 10);
    const countries = parseCsvList(configRecord?.viaCustomCountries, 8).map((row) => row.toUpperCase());
    const sites = parseCsvList(configRecord?.viaCustomSites, 20);
    const maxItemsRaw = Number(configRecord?.viaCustomMaxItems);
    const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0
      ? Math.max(1, Math.min(120, Math.floor(maxItemsRaw)))
      : undefined;
    if (keywords.length === 0 && countries.length === 0 && sites.length === 0 && maxItems === undefined) {
      return undefined;
    }
    return {
      keywords: keywords.length > 0 ? keywords : undefined,
      countries: countries.length > 0 ? countries : undefined,
      sites: sites.length > 0 ? sites : undefined,
      maxItems,
    };
  })();

  params.addNodeLog(params.node.id, `[VIA] flow_id=${flowId} 실행 요청`);

  try {
    const initial = await viaRunFlow({
      invokeFn: params.invokeFn,
      cwd: params.cwd,
      flowId,
      trigger: "manual",
      sourceType: normalizedSourceType || undefined,
      sourceOptions,
    });

    if (!initial.runId) {
      params.addNodeLog(params.node.id, "[VIA][오류] 실행 응답에 run_id가 없어 중단합니다.");
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
      params.addNodeLog(params.node.id, `[VIA][오류] 타임아웃(${timeoutMs}ms) run_id=${runId}`);
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
      params.addNodeLog(params.node.id, `[VIA][오류] 실패 status=${status}, run_id=${runId}`);
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
    params.addNodeLog(params.node.id, `[VIA][오류] ${String(error)}`);
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
