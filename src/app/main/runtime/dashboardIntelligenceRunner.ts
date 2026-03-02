import { extractStringByPaths } from "../../../shared/lib/valueUtils";
import {
  DASHBOARD_TOPIC_IDS,
  buildDashboardFallbackSnapshot,
  buildDashboardTopicPrompt,
  normalizeDashboardSnapshot,
  parseDashboardSnapshotText,
  type DashboardTopicAgentConfig,
  type DashboardTopicId,
  type DashboardTopicSnapshot,
} from "../../../features/dashboard/intelligence";
import type { KnowledgeFileRef } from "../../../features/workflow/types";
import type { KnowledgeRetrieveResult, ThreadStartResult } from "../types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type DashboardCrawlRunResult = {
  startedAt: string;
  finishedAt: string;
  totalFetched: number;
  totalFiles: number;
  topics: Array<{
    topic: string;
    fetchedCount: number;
    savedFiles: string[];
    errors: string[];
  }>;
};

type RunDashboardTopicParams = {
  cwd: string;
  topic: DashboardTopicId;
  config: DashboardTopicAgentConfig;
  invokeFn: InvokeFn;
  runId?: string;
  previousSnapshot?: DashboardTopicSnapshot;
  followupInstruction?: string;
  onProgress?: (stage: string, message: string) => void;
};

export type RunDashboardTopicResult = {
  snapshot: DashboardTopicSnapshot;
  crawlResult: DashboardCrawlRunResult;
  rawPaths: string[];
  warnings: string[];
  snapshotPath: string | null;
};

async function startDashboardTurn(params: {
  invokeFn: InvokeFn;
  threadId: string;
  text: string;
}): Promise<unknown> {
  try {
    return await params.invokeFn<unknown>("turn_start_blocking", {
      threadId: params.threadId,
      text: params.text,
    });
  } catch (error) {
    const message = String(error ?? "").toLowerCase();
    if (!message.includes("unknown command") && !message.includes("unexpected command")) {
      throw error;
    }
    return params.invokeFn<unknown>("turn_start", {
      threadId: params.threadId,
      text: params.text,
    });
  }
}

function emitProgress(params: RunDashboardTopicParams, stage: string, message: string): void {
  params.onProgress?.(stage, message);
}

function isDashboardTopicId(value: unknown): value is DashboardTopicId {
  return DASHBOARD_TOPIC_IDS.includes(value as DashboardTopicId);
}

function topicQueryText(topic: DashboardTopicId): string {
  switch (topic) {
    case "marketSummary":
      return "market summary index volatility sector movers";
    case "globalHeadlines":
      return "global headline geopolitics economy technology";
    case "industryTrendRadar":
      return "industry trend momentum signal acceleration";
    case "communityHotTopics":
      return "general community hot topics social mentions growth";
    case "devCommunityHotTopics":
      return "developer community hot topics engineering discussion opensource release issue";
    case "paperResearch":
      return "research papers preprint journal peer review benchmark methodology";
    case "eventCalendar":
      return "event calendar upcoming schedule deadline";
    case "riskAlertBoard":
      return "risk alert compliance security warning";
    case "devEcosystem":
      return "developer ecosystem release breaking change migration";
    default:
      return topic;
  }
}

function summarizeSnippets(snippets: KnowledgeRetrieveResult["snippets"]): string[] {
  return snippets
    .slice(0, 6)
    .map((snippet) => snippet.text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0);
}

function collectTextCandidates(
  input: unknown,
  out: string[],
  depth: number,
  visited: WeakSet<object>,
): void {
  if (depth > 8 || input == null) {
    return;
  }
  if (typeof input === "string") {
    const normalized = input.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return;
    }
    out.push(normalized);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      collectTextCandidates(item, out, depth + 1, visited);
      if (out.length >= 80) {
        break;
      }
    }
    return;
  }
  if (typeof input !== "object") {
    return;
  }
  const row = input as Record<string, unknown>;
  if (visited.has(row)) {
    return;
  }
  visited.add(row);
  const priorityKeys = [
    "output_text",
    "text",
    "content",
    "message",
    "response",
    "output",
    "completion",
    "turn",
    "item",
    "event",
    "data",
    "value",
  ] as const;
  for (const key of priorityKeys) {
    if (key in row) {
      collectTextCandidates(row[key], out, depth + 1, visited);
      if (out.length >= 80) {
        return;
      }
    }
  }
  for (const value of Object.values(row)) {
    collectTextCandidates(value, out, depth + 1, visited);
    if (out.length >= 80) {
      return;
    }
  }
}

function isLikelyPromptEcho(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("[topic]") || lower.includes("[retrieved snippets]") || lower.includes("[required json schema]");
}

function resolveResponseText(raw: unknown): string {
  const direct =
    extractStringByPaths(raw, [
      "text",
      "output_text",
      "output.0.content.0.text",
      "output.0.content.0.output_text",
      "output.0.text",
      "response.output.0.content.0.text",
      "response.output.0.content.0.output_text",
      "response.output.0.text",
      "completion.output.0.content.0.text",
      "completion.output.0.content.0.output_text",
      "completion.output.0.text",
      "turn.output_text",
      "turn.response.output_text",
      "turn.response.text",
      "response.output_text",
      "response.text",
    ]) ?? "";
  if (direct.trim()) {
    return direct.trim();
  }

  const candidates: string[] = [];
  collectTextCandidates(raw, candidates, 0, new WeakSet<object>());
  const unique = [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return "";
  }

  const jsonCandidate =
    unique.find((item) => item.includes("\"summary\"") && item.includes("{") && item.includes("}")) ??
    unique.find((item) => item.trim().startsWith("{") && item.includes("\"highlights\""));
  if (jsonCandidate) {
    return jsonCandidate;
  }

  const textCandidate = unique.find((item) => item.length >= 48 && !isLikelyPromptEcho(item));
  return textCandidate ?? unique[0] ?? "";
}

function buildFallbackSummaryFromSnippets(snippets: KnowledgeRetrieveResult["snippets"]): string {
  const lines = summarizeSnippets(snippets).slice(0, 3);
  if (lines.length === 0) {
    return "크롤러 결과에서 스니펫을 찾지 못했습니다.";
  }
  const joined = lines.join(" / ");
  const compact = joined.length > 240 ? `${joined.slice(0, 237).trimEnd()}...` : joined;
  return `Codex 응답을 확인하지 못해 수집 근거 기반 임시 요약을 제공합니다: ${compact}`;
}

async function runCrawlerForTopic(params: {
  cwd: string;
  topic: DashboardTopicId;
  config: DashboardTopicAgentConfig;
  invokeFn: InvokeFn;
}): Promise<DashboardCrawlRunResult> {
  return params.invokeFn<DashboardCrawlRunResult>("dashboard_crawl_run", {
    cwd: params.cwd,
    topics: [params.topic],
    maxSourcesPerTopic: params.config.maxSources,
    allowlistByTopic: {
      [params.topic]: params.config.allowlist,
    },
  });
}

async function collectKnowledgeSnippets(params: {
  cwd: string;
  topic: DashboardTopicId;
  config: DashboardTopicAgentConfig;
  invokeFn: InvokeFn;
}): Promise<{
  rawPaths: string[];
  retrieve: KnowledgeRetrieveResult;
}> {
  const rawPaths = await params.invokeFn<string[]>("dashboard_raw_list", {
    cwd: params.cwd,
    topic: params.topic,
    limit: Math.max(6, params.config.maxSources * 6),
  });
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
    return {
      rawPaths: [],
      retrieve: { snippets: [], warnings: ["raw files not found"] },
    };
  }

  const normalizedPaths = rawPaths
    .map((path) => String(path ?? "").trim())
    .filter((path) => path.length > 0)
    .slice(0, params.config.maxSources * 6);
  const markdownPaths = normalizedPaths.filter((path) => path.toLowerCase().endsWith(".md"));
  const probeTargets = markdownPaths.length > 0 ? markdownPaths : normalizedPaths;
  const probed = await params.invokeFn<KnowledgeFileRef[]>("knowledge_probe", { paths: probeTargets });
  const validFiles = probed.filter((file) => file.enabled && (file.status === "ready" || !file.status));
  if (validFiles.length === 0) {
    return {
      rawPaths: normalizedPaths,
      retrieve: { snippets: [], warnings: ["knowledge probe returned no valid files"] },
    };
  }

  const retrieve = await params.invokeFn<KnowledgeRetrieveResult>("knowledge_retrieve", {
    files: validFiles,
    query: topicQueryText(params.topic),
    topK: params.config.maxSnippets,
    maxChars: params.config.maxSnippetChars,
  });
  if (retrieve.snippets.length > 0) {
    return { rawPaths: normalizedPaths, retrieve };
  }

  const relaxedRetrieve = await params.invokeFn<KnowledgeRetrieveResult>("knowledge_retrieve", {
    files: validFiles,
    query: "",
    topK: params.config.maxSnippets,
    maxChars: params.config.maxSnippetChars,
  });

  const warnings = Array.from(
    new Set([
      ...retrieve.warnings,
      ...relaxedRetrieve.warnings,
      ...(relaxedRetrieve.snippets.length > 0
        ? ["topic query matched 0 snippets; relaxed retrieval fallback used"]
        : []),
    ]),
  );

  return {
    rawPaths: normalizedPaths,
    retrieve: {
      snippets: relaxedRetrieve.snippets,
      warnings,
    },
  };
}

function buildSnapshotWithoutCodex(params: {
  topic: DashboardTopicId;
  model: string;
  snippets: KnowledgeRetrieveResult["snippets"];
  warnings: string[];
}): DashboardTopicSnapshot {
  return buildDashboardFallbackSnapshot(params.topic, params.model, {
    summary: buildFallbackSummaryFromSnippets(params.snippets),
    highlights: summarizeSnippets(params.snippets),
    risks: params.warnings.slice(0, 4),
    events: [],
    references: [],
    status: "degraded",
    statusMessage: params.warnings.join(" | ") || "Codex 응답 없음",
    referenceEmpty: true,
  });
}

function isCodexAuthError(error: unknown): boolean {
  const text = String(error ?? "").trim().toLowerCase();
  if (!text) {
    return false;
  }
  return [
    "login required",
    "requires login",
    "로그인 필요",
    "not authenticated",
    "authentication",
    "unauthorized",
    "401",
    "requiresopenaiauth",
    "auth required",
    "invalid api key",
  ].some((keyword) => text.includes(keyword));
}

async function startCodexThreadOrThrow(params: RunDashboardTopicParams): Promise<ThreadStartResult> {
  emitProgress(params, "codex_thread", "Codex 세션 준비 확인");
  try {
    return await params.invokeFn<ThreadStartResult>("thread_start", {
      model: params.config.model,
      cwd: params.cwd,
    });
  } catch (error) {
    if (isCodexAuthError(error)) {
      emitProgress(params, "auth_required", "Codex 로그인 필요: 실행 중단");
      throw new Error("Codex 로그인이 필요합니다. 설정에서 로그인 후 다시 실행해 주세요.");
    }
    emitProgress(params, "agent_unavailable", `에이전트 준비 실패: ${String(error)}`);
    throw new Error(`에이전트 실행 준비 실패로 파이프라인을 시작하지 않았습니다: ${String(error)}`);
  }
}

export async function runDashboardTopicIntelligence(params: RunDashboardTopicParams): Promise<RunDashboardTopicResult> {
  emitProgress(params, "crawler", "크롤러 수집 시작");
  const crawlResult = await runCrawlerForTopic({
    cwd: params.cwd,
    topic: params.topic,
    config: params.config,
    invokeFn: params.invokeFn,
  });
  const topicCrawlResult = crawlResult.topics.find((row) => row.topic === params.topic);
  emitProgress(
    params,
    "crawler_done",
    `크롤링 완료: ${topicCrawlResult?.fetchedCount ?? 0}건 수집 / ${topicCrawlResult?.savedFiles?.length ?? 0}개 저장`,
  );
  const crawlWarnings = Array.isArray(topicCrawlResult?.errors)
    ? topicCrawlResult!.errors.map((row) => String(row ?? "").trim()).filter((row) => row.length > 0)
    : [];

  emitProgress(params, "rag", "수집 파일에서 근거 추출 중");
  const knowledge = await collectKnowledgeSnippets({
    cwd: params.cwd,
    topic: params.topic,
    config: params.config,
    invokeFn: params.invokeFn,
  });
  const warnings = [...crawlWarnings, ...knowledge.retrieve.warnings];
  emitProgress(
    params,
    "rag_done",
    `근거 추출 완료: raw ${knowledge.rawPaths.length}개 / snippet ${knowledge.retrieve.snippets.length}개`,
  );

  const fetchedCount = Number(topicCrawlResult?.fetchedCount ?? 0);
  if (knowledge.retrieve.snippets.length === 0 && fetchedCount <= 0) {
    emitProgress(params, "fallback", "크롤러 수집 결과가 없어 요약 생성을 건너뜀");
    const snapshot = buildSnapshotWithoutCodex({
      topic: params.topic,
      model: params.config.model,
      snippets: [],
      warnings: [...warnings, "crawler fetched 0 items"],
    });
    emitProgress(params, "save", "스냅샷 저장 중");
    const snapshotPath = await params.invokeFn<string>("dashboard_snapshot_save", {
      cwd: params.cwd,
      topic: params.topic,
      snapshotJson: snapshot,
    });
    emitProgress(params, "done", "완료");
    return {
      snapshot,
      crawlResult,
      rawPaths: knowledge.rawPaths,
      warnings,
      snapshotPath: String(snapshotPath ?? "").trim() || null,
    };
  }

  emitProgress(params, "prompt", "요약 프롬프트 구성 중");
  const promptBase = buildDashboardTopicPrompt({
    topic: params.topic,
    config: params.config,
    snippets: knowledge.retrieve.snippets,
    previousSnapshot: params.previousSnapshot,
  });
  const followup = String(params.followupInstruction ?? "").trim();
  const prompt = followup
    ? `${promptBase}\n\n[Additional User Request]\n${followup}\n\n[Instruction]\nReflect this request in the JSON while staying grounded to retrieved snippets.`
    : promptBase;

  let snapshot: DashboardTopicSnapshot;
  try {
    const threadStart = await startCodexThreadOrThrow(params);
    emitProgress(params, "codex_turn", "Codex 응답 생성 중");
    const turnStartResponse = await startDashboardTurn({
      invokeFn: params.invokeFn,
      threadId: threadStart.threadId,
      text: prompt,
    });
    const responseText = resolveResponseText(turnStartResponse);

    if (responseText.trim()) {
      emitProgress(params, "parse", "응답 파싱 및 스냅샷 생성 중");
      snapshot = parseDashboardSnapshotText(params.topic, params.config.model, responseText);
    } else {
      emitProgress(params, "fallback", "Codex 빈 응답: 스니펫 기반 대체 요약 생성 중");
      snapshot = buildSnapshotWithoutCodex({
        topic: params.topic,
        model: params.config.model,
        snippets: knowledge.retrieve.snippets,
        warnings: [...warnings, "empty codex response"],
      });
    }
  } catch (error) {
    if (isCodexAuthError(error)) {
      emitProgress(params, "auth_required", "Codex 로그인 필요: 수집 근거 기반으로 대체 요약 생성");
      snapshot = buildSnapshotWithoutCodex({
        topic: params.topic,
        model: params.config.model,
        snippets: knowledge.retrieve.snippets,
        warnings: [...warnings, "codex auth required"],
      });
    } else {
      emitProgress(params, "fallback", `Codex 실패: ${String(error)}`);
      snapshot = buildSnapshotWithoutCodex({
        topic: params.topic,
        model: params.config.model,
        snippets: knowledge.retrieve.snippets,
        warnings: [...warnings, `codex error: ${String(error)}`],
      });
    }
  }

  if (knowledge.retrieve.snippets.length === 0) {
    emitProgress(params, "normalize", "스니펫 부족 상태로 스냅샷 정규화");
    snapshot = normalizeDashboardSnapshot(params.topic, params.config.model, {
      ...snapshot,
      referenceEmpty: true,
      status: snapshot.status ?? "degraded",
      statusMessage: snapshot.statusMessage ?? "RAG snippet was empty",
    });
  }

  const runId = String(params.runId ?? "").trim();
  if (runId) {
    snapshot = {
      ...snapshot,
      runId,
    };
  }

  emitProgress(params, "save", "스냅샷 저장 중");
  const snapshotPath = await params.invokeFn<string>("dashboard_snapshot_save", {
    cwd: params.cwd,
    topic: params.topic,
    snapshotJson: snapshot,
  });
  emitProgress(params, "done", "완료");

  return {
    snapshot,
    crawlResult,
    rawPaths: knowledge.rawPaths,
    warnings,
    snapshotPath: String(snapshotPath ?? "").trim() || null,
  };
}

export async function runDashboardCrawlerOnly(params: {
  cwd: string;
  configByTopic: Record<DashboardTopicId, DashboardTopicAgentConfig>;
  topics?: DashboardTopicId[];
  invokeFn: InvokeFn;
}) {
  const selected = (params.topics ?? DASHBOARD_TOPIC_IDS).filter((topic) => params.configByTopic[topic]?.enabled);
  const allowlistByTopic = selected.reduce<Record<string, string[]>>((acc, topic) => {
    acc[topic] = params.configByTopic[topic].allowlist;
    return acc;
  }, {});
  return params.invokeFn<DashboardCrawlRunResult>("dashboard_crawl_run", {
    cwd: params.cwd,
    topics: selected,
    allowlistByTopic,
    maxSourcesPerTopic: Math.max(
      1,
      ...selected.map((topic) => Math.min(20, Math.max(1, params.configByTopic[topic].maxSources))),
    ),
  });
}

export async function loadDashboardSnapshots(params: {
  cwd: string;
  invokeFn: InvokeFn;
}): Promise<Partial<Record<DashboardTopicId, DashboardTopicSnapshot>>> {
  const rows = await params.invokeFn<unknown[]>("dashboard_snapshot_list", { cwd: params.cwd });
  const out: Partial<Record<DashboardTopicId, DashboardTopicSnapshot>> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const topic = (row as Record<string, unknown>).topic;
    if (!isDashboardTopicId(topic)) {
      continue;
    }
    const normalized = normalizeDashboardSnapshot(topic, String((row as Record<string, unknown>).model ?? ""), row);
    const current = out[topic];
    if (!current || current.generatedAt < normalized.generatedAt) {
      out[topic] = normalized;
    }
  }
  return out;
}
