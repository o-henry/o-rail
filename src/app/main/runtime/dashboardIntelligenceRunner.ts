import { extractStringByPaths } from "../../../shared/lib/valueUtils";
import {
  DASHBOARD_TOPIC_IDS,
  normalizeDashboardSnapshot,
  parseDashboardSnapshotText,
  type DashboardTopicAgentConfig,
  type DashboardTopicId,
  type DashboardTopicSnapshot,
} from "../../../features/dashboard/intelligence";
import type { KnowledgeRetrieveResult, ThreadStartResult } from "../types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type DashboardCrawlRunResult = {
  startedAt: string;
  finishedAt: string;
  totalFetched: number;
  totalFiles: number;
  bridge?: {
    running?: boolean;
    baseUrl?: string;
    tokenProtected?: boolean;
    scraplingReady?: boolean;
    message?: string;
  };
  topics: Array<{
    topic: string;
    fetchedCount: number;
    savedFiles: string[];
    errors: string[];
    sourceResults?: Array<{
      url: string;
      status: string;
      httpStatus?: number | null;
      error?: string | null;
      bytes?: number;
      fetchedAt?: string;
      format?: string | null;
    }>;
  }>;
};

type DashboardQualityFailureCode = "CRAWL_FAIL" | "SNIPPET_EMPTY" | "CODEX_EMPTY" | "CODEX_PARSE_FAIL";

export type DashboardRunQualityGate = {
  passed: boolean;
  fetchedCount: number;
  snippetCount: number;
  codexResponseState: "ok" | "empty" | "parse_fail";
  failureCode?: DashboardQualityFailureCode;
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
  qualityGate: DashboardRunQualityGate;
};

class DashboardQualityGateError extends Error {
  code: DashboardQualityFailureCode;

  constructor(code: DashboardQualityFailureCode, message: string) {
    super(message);
    this.name = "DashboardQualityGateError";
    this.code = code;
  }
}

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

function summarizeSnippets(snippets: KnowledgeRetrieveResult["snippets"]): string[] {
  const sanitizeSnippet = (raw: string): string => {
    const text = String(raw ?? "").trim();
    if (!text) {
      return "";
    }
    let normalized = text;
    if (
      (normalized.startsWith("{") && normalized.endsWith("}")) ||
      (normalized.startsWith("[") && normalized.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(normalized) as Record<string, unknown>;
        const preferred = [
          parsed.summary,
          parsed.title,
          parsed.description,
          parsed.content,
          parsed.text,
          parsed.message,
        ].find((candidate) => typeof candidate === "string" && String(candidate).trim().length > 0);
        if (typeof preferred === "string") {
          normalized = preferred;
        }
      } catch {
        // ignore json parse errors
      }
    }
    normalized = normalized
      .replace(/<\/?[^>]+>/g, " ")
      .replace(/\\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) {
      return "";
    }
    if (isOpaqueIdentifier(normalized)) {
      return "";
    }
    if (/^"?contenttype"?\s*:/i.test(normalized) || /^"?fetchedat"?\s*:/i.test(normalized)) {
      return "";
    }
    return normalized;
  };

  return snippets
    .slice(0, 6)
    .map((snippet) => sanitizeSnippet(snippet.text))
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

function isOpaqueIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return true;
  }
  if (/^[a-z0-9_-]{24,}$/i.test(trimmed) && !/\s/.test(trimmed) && !/[가-힣]/.test(trimmed)) {
    return true;
  }
  return false;
}

function scoreResponseCandidate(value: string): number {
  const text = value.trim();
  if (!text) {
    return Number.NEGATIVE_INFINITY;
  }
  if (isLikelyPromptEcho(text)) {
    return -200;
  }
  if (isOpaqueIdentifier(text)) {
    return -180;
  }
  const lower = text.toLowerCase();
  let score = 0;
  if (text.startsWith("{") || text.startsWith("```json")) {
    score += 70;
  }
  if (lower.includes("\"summary\"")) {
    score += 90;
  }
  if (lower.includes("\"highlights\"")) {
    score += 70;
  }
  if (lower.includes("\"risks\"")) {
    score += 50;
  }
  if (lower.includes("\"references\"")) {
    score += 55;
  }
  if (lower.includes("\"generatedat\"")) {
    score += 20;
  }
  if (lower.includes("\"contenttype\"") && lower.includes("\"format\"") && !lower.includes("\"highlights\"")) {
    score -= 40;
  }
  if (text.length >= 120) {
    score += 20;
  } else if (text.length >= 48) {
    score += 10;
  } else {
    score -= 15;
  }
  return score;
}

function selectBestResponseCandidate(candidates: string[]): string {
  const unique = [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return "";
  }
  const ranked = unique
    .map((item) => ({
      item,
      score: scoreResponseCandidate(item),
    }))
    .sort((left, right) => right.score - left.score);
  const winner = ranked[0];
  if (!winner || winner.score <= -100) {
    return "";
  }
  return winner.item;
}

function isMeaninglessSnapshotSummary(summary: string): boolean {
  const text = String(summary ?? "").trim();
  if (!text) {
    return true;
  }
  if (isOpaqueIdentifier(text)) {
    return true;
  }
  if (/^[\[{].*[\]}]$/.test(text) && /"contenttype"\s*:|"fetchedat"\s*:|"format"\s*:/i.test(text)) {
    return true;
  }
  return false;
}

function resolveResponseText(raw: unknown): string {
  const directCandidate =
    extractStringByPaths(raw, [
      "text",
      "output_text",
      "result.output.0.content.0.text",
      "result.output.0.content.0.output_text",
      "result.output.0.text",
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
  const direct = directCandidate.trim();

  const candidates: string[] = [];
  if (direct) {
    candidates.push(direct);
  }
  collectTextCandidates(raw, candidates, 0, new WeakSet<object>());
  return selectBestResponseCandidate(candidates);
}

function collectSnapshotLikeObjects(
  input: unknown,
  out: Array<Record<string, unknown>>,
  depth: number,
  visited: WeakSet<object>,
): void {
  if (depth > 8 || input == null) {
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      collectSnapshotLikeObjects(item, out, depth + 1, visited);
      if (out.length >= 24) {
        return;
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
  const hasSnapshotHint =
    "summary" in row ||
    "highlights" in row ||
    "risks" in row ||
    "events" in row ||
    "references" in row;
  if (hasSnapshotHint) {
    out.push(row);
  }
  for (const value of Object.values(row)) {
    collectSnapshotLikeObjects(value, out, depth + 1, visited);
    if (out.length >= 24) {
      return;
    }
  }
}

function buildSnapshotFromRawObject(params: {
  topic: DashboardTopicId;
  model: string;
  raw: unknown;
}): DashboardTopicSnapshot | null {
  const candidates: Array<Record<string, unknown>> = [];
  collectSnapshotLikeObjects(params.raw, candidates, 0, new WeakSet<object>());
  if (candidates.length === 0) {
    return null;
  }
  for (const candidate of candidates) {
    const normalized = normalizeDashboardSnapshot(params.topic, params.model, candidate);
    if (!isMeaninglessSnapshotSummary(normalized.summary)) {
      return normalized;
    }
  }
  return null;
}

function buildEmergencyCodexRetryPrompt(params: {
  topic: DashboardTopicId;
  model: string;
  snippets: KnowledgeRetrieveResult["snippets"];
  followupInstruction?: string;
}): string {
  const snippetLines = summarizeSnippets(params.snippets)
    .slice(0, 8)
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");
  const followup = String(params.followupInstruction ?? "").trim();
  return [
    "이전 응답이 비어 있었습니다. 아래 근거만 사용해 JSON 객체 1개만 출력하세요.",
    "",
    "[TOPIC]",
    params.topic,
    "",
    "[MODEL]",
    params.model,
    "",
    "[RETRIEVED SNIPPETS]",
    snippetLines || "(snippet 없음)",
    "",
    "[ADDITIONAL REQUEST]",
    followup || "(없음)",
    "",
    "[REQUIRED JSON SCHEMA]",
    "{",
    '  "summary": "string",',
    '  "highlights": ["string"],',
    '  "risks": ["string"],',
    '  "events": [{"title":"string","date":"string","note":"string"}],',
    '  "references": [{"url":"string","title":"string","source":"string","publishedAt":"string"}],',
    '  "generatedAt": "ISO-8601 string",',
    '  "topic": "string",',
    '  "model": "string"',
    "}",
    "",
    "[RULES]",
    "- JSON 외 텍스트 금지",
    "- 한국어로 작성",
    "- summary는 2~3문장",
    "- references는 가능한 3개 이상",
  ].join("\n");
}

function buildDashboardWebSearchPrompt(params: {
  topic: DashboardTopicId;
  config: DashboardTopicAgentConfig;
  previousSnapshot?: DashboardTopicSnapshot;
  followupInstruction?: string;
}): string {
  const allowlistLines =
    params.config.allowlist.length > 0
      ? params.config.allowlist.map((url, index) => `${index + 1}. ${url}`).join("\n")
      : "(지정된 ALLOWLIST 없음)";
  const followup = String(params.followupInstruction ?? "").trim();
  return [
    `You are the dashboard intelligence agent for topic "${params.topic}".`,
    "",
    "[System Role]",
    params.config.systemPrompt,
    "",
    "[Task]",
    "- Perform live web research directly now.",
    "- Prioritize sources from ALLOWLIST first.",
    "- If ALLOWLIST sources are inaccessible, use other credible public sources and report that in risks.",
    "- Provide evidence-grounded summary only.",
    "",
    "[ALLOWLIST Priority Sources]",
    allowlistLines,
    "",
    "[Previous Snapshot]",
    params.previousSnapshot
      ? JSON.stringify(
          {
            generatedAt: params.previousSnapshot.generatedAt,
            summary: params.previousSnapshot.summary,
            highlights: params.previousSnapshot.highlights,
            risks: params.previousSnapshot.risks,
            events: params.previousSnapshot.events,
            references: params.previousSnapshot.references,
          },
          null,
          2,
        )
      : "No previous snapshot.",
    "",
    "[Additional User Request]",
    followup || "(없음)",
    "",
    "[Output JSON Schema]",
    "Return strict JSON object with fields:",
    "{",
    '  "summary": "string",',
    '  "highlights": ["string"],',
    '  "risks": ["string"],',
    '  "events": [{"title":"string","date":"string","note":"string"}],',
    '  "references": [{"url":"string","title":"string","source":"string","publishedAt":"string"}],',
    '  "generatedAt": "ISO-8601 string",',
    '  "topic": "string",',
    '  "model": "string"',
    "}",
    "",
    "[Constraints]",
    "- highlights max 6 items",
    "- risks max 6 items",
    "- events max 8 items",
    `- references max ${params.config.maxSources} items`,
    "- summary max 550 chars",
    "- Write summary/highlights/risks/events in Korean",
    "- return JSON only (no markdown, no commentary)",
  ].join("\n");
}

function extractUrlsFromText(input: string, maxItems = 8): string[] {
  const matches = input.match(/https?:\/\/[^\s)]+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of matches) {
    const normalized = String(row ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function buildSnapshotFromFreeformCodexText(params: {
  topic: DashboardTopicId;
  model: string;
  responseText: string;
  snippets: KnowledgeRetrieveResult["snippets"];
  warnings: string[];
}): DashboardTopicSnapshot | null {
  const normalized = String(params.responseText ?? "")
    .replace(/```(?:json|markdown|text)?/gi, " ")
    .replace(/```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || isOpaqueIdentifier(normalized) || isLikelyPromptEcho(normalized)) {
    return null;
  }

  const sentenceCandidates = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  const highlights = Array.from(new Set(sentenceCandidates)).slice(0, 6);
  const snippetHighlights = summarizeSnippets(params.snippets).slice(0, 3);
  const mergedHighlights = [...new Set([...highlights, ...snippetHighlights])].slice(0, 6);
  const urls = extractUrlsFromText(normalized, 8);

  return normalizeDashboardSnapshot(params.topic, params.model, {
    topic: params.topic,
    model: params.model,
    generatedAt: new Date().toISOString(),
    summary: normalized.length > 1200 ? normalized.slice(0, 1200).trimEnd() : normalized,
    highlights: mergedHighlights,
    risks: params.warnings.slice(0, 6),
    events: [],
    references: urls.map((url) => ({
      url,
      title: url,
      source: url,
    })),
    status: "ok",
    statusMessage: "Codex 자유형 응답을 JSON 스키마로 보정했습니다.",
    referenceEmpty: urls.length === 0,
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
  emitProgress(params, "crawler", "외부 크롤링 비활성화: Codex 웹검색 모드 준비");
  const crawlResult: DashboardCrawlRunResult = {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    totalFetched: 0,
    totalFiles: 0,
    topics: [
      {
        topic: params.topic,
        fetchedCount: 0,
        savedFiles: [],
        errors: ["crawler disabled: codex web search mode"],
      },
    ],
  };
  const warnings: string[] = [];
  const snippetCount = 0;
  const fetchedCount = 0;

  emitProgress(params, "rag", "RAG 비활성화: Codex 직접 조사 모드");
  emitProgress(params, "prompt", "웹검색 기반 요약 프롬프트 구성 중");
  const prompt = buildDashboardWebSearchPrompt({
    topic: params.topic,
    config: params.config,
    previousSnapshot: params.previousSnapshot,
    followupInstruction: params.followupInstruction,
  });

  let snapshot: DashboardTopicSnapshot;
  let codexResponseState: DashboardRunQualityGate["codexResponseState"] = "ok";
  try {
    const threadStart = await startCodexThreadOrThrow(params);
    emitProgress(params, "codex_turn", "Codex 응답 생성 중");
    const turnStartResponse = await startDashboardTurn({
      invokeFn: params.invokeFn,
      threadId: threadStart.threadId,
      text: prompt,
    });
    let responseText = resolveResponseText(turnStartResponse);
    let responseSnapshot = buildSnapshotFromRawObject({
      topic: params.topic,
      model: params.config.model,
      raw: turnStartResponse,
    });
    if (!responseText.trim()) {
      emitProgress(params, "codex_retry", "Codex 재시도: 빈 응답 보정 프롬프트 전송");
      const retryResponse = await startDashboardTurn({
        invokeFn: params.invokeFn,
        threadId: threadStart.threadId,
        text: buildEmergencyCodexRetryPrompt({
          topic: params.topic,
          model: params.config.model,
          snippets: [],
          followupInstruction: params.followupInstruction,
        }),
      });
      responseText = resolveResponseText(retryResponse);
      if (!responseSnapshot) {
        responseSnapshot = buildSnapshotFromRawObject({
          topic: params.topic,
          model: params.config.model,
          raw: retryResponse,
        });
      }
    }

    if (responseSnapshot) {
      emitProgress(params, "parse", "응답 객체 파싱 및 스냅샷 생성 중");
      snapshot = responseSnapshot;
    } else if (responseText.trim()) {
      emitProgress(params, "parse", "응답 파싱 및 스냅샷 생성 중");
      snapshot = parseDashboardSnapshotText(params.topic, params.config.model, responseText);
      const invalidJsonResponse =
        snapshot.status === "degraded" &&
        String(snapshot.statusMessage ?? "").toLowerCase().includes("not valid json");
      if (invalidJsonResponse) {
        const freeformSnapshot = buildSnapshotFromFreeformCodexText({
          topic: params.topic,
          model: params.config.model,
          responseText,
          snippets: [],
          warnings,
        });
        if (freeformSnapshot) {
          emitProgress(params, "parse_freeform", "자유형 응답을 스냅샷으로 보정 중");
          snapshot = freeformSnapshot;
        } else {
          codexResponseState = "parse_fail";
          emitProgress(params, "error", "응답 파싱 실패: JSON 형식 불일치");
          throw new DashboardQualityGateError(
            "CODEX_PARSE_FAIL",
            "요약 모델 응답을 JSON 스키마로 해석하지 못했습니다.",
          );
        }
      }
      if (isMeaninglessSnapshotSummary(snapshot.summary)) {
        codexResponseState = "parse_fail";
        emitProgress(params, "error", "응답 품질 실패: 의미 없는 요약");
        throw new DashboardQualityGateError(
          "CODEX_PARSE_FAIL",
          "요약 모델 응답이 의미 없는 문자열로 판정되어 저장을 차단했습니다.",
        );
      }
    } else {
      codexResponseState = "empty";
      emitProgress(params, "error", "요약 모델 응답 없음: 재시도 실패");
      throw new DashboardQualityGateError(
        "CODEX_EMPTY",
        "요약 모델이 빈 응답을 반환했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
  } catch (error) {
    if (error instanceof DashboardQualityGateError) {
      throw error;
    }
    if (isCodexAuthError(error)) {
      emitProgress(params, "auth_required", "Codex 로그인 필요: 실행 실패 처리");
      throw new DashboardQualityGateError(
        "CODEX_EMPTY",
        "Codex 로그인이 필요합니다. 설정에서 로그인 후 다시 실행해 주세요.",
      );
    }
    emitProgress(params, "error", `Codex 실패: ${String(error)}`);
    throw new DashboardQualityGateError(
      "CODEX_PARSE_FAIL",
      `요약 모델 실행 중 오류가 발생했습니다: ${String(error)}`,
    );
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
    rawPaths: [],
    warnings,
    snapshotPath: String(snapshotPath ?? "").trim() || null,
    qualityGate: {
      passed: true,
      fetchedCount,
      snippetCount,
      codexResponseState,
    },
  };
}

export async function runDashboardCrawlerOnly(params: {
  cwd: string;
  configByTopic: Record<DashboardTopicId, DashboardTopicAgentConfig>;
  topics?: DashboardTopicId[];
  invokeFn: InvokeFn;
}): Promise<DashboardCrawlRunResult> {
  const selected = (params.topics ?? DASHBOARD_TOPIC_IDS).filter((topic) => params.configByTopic[topic]?.enabled);
  const now = new Date().toISOString();
  return {
    startedAt: now,
    finishedAt: now,
    totalFetched: 0,
    totalFiles: 0,
    topics: selected.map((topic) => ({
      topic,
      fetchedCount: 0,
      savedFiles: [] as string[],
      errors: ["crawler disabled: codex web search mode"] as string[],
    })),
  };
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
