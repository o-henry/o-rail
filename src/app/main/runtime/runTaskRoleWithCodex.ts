import { getWebProviderFromExecutor, toTurnModelDisplayName, toTurnModelEngineId } from "../../../features/workflow/domain";
import { findRuntimeModelOption } from "../../../features/workflow/runtimeModelOptions";
import { extractFinalAnswer } from "../../../features/workflow/labels";
import { toTurnReasoningEffort } from "../../../features/workflow/reasoningLevels";
import { extractCompletedStatus, extractDeltaText, extractUsageStats } from "../../mainAppUtils";
import { extractStringByPaths } from "../../../shared/lib/valueUtils";
import { prepareResearcherCollectionContext } from "./researcherCollection";
import { ensureResearcherCollectionArtifacts } from "./researcherCollectionArtifacts";
import { buildTaskRoleLearningPromptContext } from "../../adaptation/taskRoleLearning";
import type { WebProviderRunResult } from "../types";
import { waitForTurnTerminalFromEngineNotifications } from "./codexTurnNotifications";
import { resolveStudioRoleExecutionConfigPatch } from "./roleExecutionTuning";
import type { StudioRoleId } from "../../../features/studio/handoffTypes";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type ExternalFallbackProvider = "steel" | "lightpanda_experimental";
type WebRunDocument = {
  model?: string;
  requestedProvider: string;
  effectiveProvider: string;
  text: string;
  raw: unknown;
  meta?: WebProviderRunResult["meta"];
};

type TaskAgentPromptPack = {
  id: string;
  label: string;
  studioRoleId: string;
  model: string;
  modelReasoningEffort: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access" | string;
  outputArtifactName: string;
  promptDocFile: string;
  developerInstructions: string;
};

type ThreadStartResult = {
  threadId: string;
  raw?: unknown;
};

type ThreadLoadShape = {
  thread: {
    model?: string | null;
    reasoning?: string | null;
  };
  task: {
    workspacePath?: string | null;
    worktreePath?: string | null;
  };
};

type TaskLoadShape = {
  record: {
    workspacePath?: string | null;
    worktreePath?: string | null;
  };
};

type RunTaskRoleWithCodexInput = {
  invokeFn: InvokeFn;
  storageCwd: string;
  taskId: string;
  studioRoleId: string;
  prompt?: string;
  model?: string;
  models?: string[];
  reasoning?: string;
  outputArtifactName?: string;
  sourceTab: "tasks" | "tasks-thread";
  runId: string;
  intent?: string;
  promptMode?: "direct" | "orchestrate" | "brief" | "critique" | "judge" | "verify" | "final";
  onRuntimeSession?: (runtime: {
    codexThreadId?: string | null;
    codexTurnId?: string | null;
    provider?: string | null;
    providers?: string[];
  }) => void;
  onProgress?: (message?: string) => void;
  debugTimeoutOverrides?: {
    completedUnreadableRecoveryWindowMs?: number;
  };
};

export type TaskRoleCodexRunResult = {
  summary: string;
  artifactPaths: string[];
  usage?: ReturnType<typeof extractUsageStats>;
  codexThreadId?: string;
  codexTurnId?: string;
};

export class TaskRoleCodexRunError extends Error {
  artifactPaths: string[];

  codexThreadId?: string;

  codexTurnId?: string;

  completedStatus?: string;

  constructor(message: string, options?: {
    artifactPaths?: string[];
    codexThreadId?: string;
    codexTurnId?: string;
    completedStatus?: string;
  }) {
    super(message);
    this.name = "TaskRoleCodexRunError";
    this.artifactPaths = [...new Set((options?.artifactPaths ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
    this.codexThreadId = options?.codexThreadId;
    this.codexTurnId = options?.codexTurnId;
    this.completedStatus = options?.completedStatus;
  }
}

export function extractTaskRoleCodexRunArtifactPaths(error: unknown): string[] {
  if (error instanceof TaskRoleCodexRunError) {
    return [...error.artifactPaths];
  }
  return [];
}

function resolvePreferredRuntimeModel(params: {
  inputModel?: string;
  threadModel?: string;
  packModel?: string;
}): string {
  const resolved = String(params.inputModel || params.threadModel || params.packModel || "GPT-5.4").trim();
  return toTurnModelDisplayName(resolved || "GPT-5.4");
}

function resolvePreferredRuntimeModels(params: {
  inputModels?: string[];
  inputModel?: string;
  threadModel?: string;
  packModel?: string;
}): string[] {
  const normalizedModels = [...new Set(
    (params.inputModels ?? [])
      .map((value) => toTurnModelDisplayName(String(value ?? "").trim()))
      .filter(Boolean),
  )];
  if (normalizedModels.length > 0) {
    return normalizedModels;
  }
  return [resolvePreferredRuntimeModel(params)];
}

function resolveRolePollTimeoutMs(params: {
  studioRoleId: string;
  intent?: string;
  promptMode?: "direct" | "orchestrate" | "brief" | "critique" | "judge" | "verify" | "final";
}): number {
  if (params.studioRoleId === "research_analyst") {
    return RESEARCH_POLL_TIMEOUT_MS;
  }
  if (String(params.intent ?? "").trim().toLowerCase() === "ideation") {
    if (
      params.promptMode === "brief"
      || params.promptMode === "judge"
      || params.promptMode === "verify"
      || params.promptMode === "final"
    ) {
      return IDEATION_POLL_TIMEOUT_MS;
    }
  }
  return POLL_TIMEOUT_MS;
}

function resolveWebProviderTimeoutMs(provider: string | null | undefined, baseTimeoutMs: number): number {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (["gpt", "gemini", "grok", "perplexity", "claude"].includes(normalized)) {
    return Math.max(baseTimeoutMs, 300000);
  }
  return baseTimeoutMs;
}

const INCOMPLETE_TURN_STATUSES = new Set([
  "inprogress",
  "running",
  "queued",
  "pending",
  "starting",
  "processing",
  "streaming",
]);
const FAILED_TURN_STATUSES = new Set(["failed", "error", "cancelled", "rejected"]);
const POLL_INTERVAL_MS = 1500;
const NOTIFICATION_RECOVERY_POLL_INTERVAL_MS = 3000;
const NOTIFICATION_RECOVERY_MAX_POLL_INTERVAL_MS = 6000;
const POLL_TIMEOUT_MS = 180000;
const RESEARCH_POLL_TIMEOUT_MS = 600000;
const IDEATION_POLL_TIMEOUT_MS = 600000;
const MAX_POLL_READ_ERRORS = 6;
const MAX_TURN_START_ATTEMPTS = 3;
const MAX_THREAD_START_ATTEMPTS = 2;
const THREAD_START_TIMEOUT_MS = 45000;
const TURN_START_TIMEOUT_MS = 30000;
const THREAD_READ_TIMEOUT_MS = 30000;

type RoleContextLayerBudget = {
  researchChars: number;
  learningChars: number;
  totalChars: number;
};

const DEFAULT_ROLE_CONTEXT_LAYER_BUDGET: RoleContextLayerBudget = {
  researchChars: 1600,
  learningChars: 360,
  totalChars: 1900,
};

const ROLE_CONTEXT_LAYER_BUDGETS: Record<string, RoleContextLayerBudget> = {
  research_analyst: {
    researchChars: 1800,
    learningChars: 440,
    totalChars: 2200,
  },
  pm_planner: {
    researchChars: 0,
    learningChars: 420,
    totalChars: 420,
  },
  pm_creative_director: {
    researchChars: 0,
    learningChars: 520,
    totalChars: 520,
  },
  system_programmer: {
    researchChars: 0,
    learningChars: 360,
    totalChars: 360,
  },
  qa_engineer: {
    researchChars: 0,
    learningChars: 340,
    totalChars: 340,
  },
};

function normalizeSandboxMode(value: string | null | undefined): "read-only" | "workspace-write" | "danger-full-access" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "workspace-write" || normalized === "danger-full-access") {
    return normalized;
  }
  return "read-only";
}

function buildRoleTurnPrompt(
  pack: TaskAgentPromptPack,
  userPrompt: string,
  projectPath: string,
  promptMode: RunTaskRoleWithCodexInput["promptMode"],
  intent?: string,
  precollectedContext = "",
): string {
  const trimmedPrompt = String(userPrompt ?? "").trim();
  const developerInstructions = resolvePromptModeDeveloperInstructions({
    pack,
    promptMode,
  });
  if (looksLikeStructuredTaskPrompt(trimmedPrompt)) {
    return [
      `# ROLE`,
      `${pack.label}`,
      ``,
      `# DEVELOPER INSTRUCTIONS`,
      developerInstructions,
      precollectedContext.trim() ? `\n# PRECOLLECTED CONTEXT\n${precollectedContext.trim()}` : "",
      "",
      trimmedPrompt,
    ].filter(Boolean).join("\n");
  }
  return [
    `# ROLE`,
    `${pack.label}`,
    ``,
    `# WORKSPACE`,
    projectPath,
    ``,
    `# DEVELOPER INSTRUCTIONS`,
    developerInstructions,
    ``,
    `# USER REQUEST`,
    trimmedPrompt,
    precollectedContext.trim() ? `\n${precollectedContext.trim()}` : "",
    ``,
    `# OUTPUT RULES`,
    ...buildRoleOutputRules({
      promptMode,
      intent,
    }),
  ].join("\n");
}

function buildRoleOutputRules(params: {
  promptMode: RunTaskRoleWithCodexInput["promptMode"];
  intent?: string;
}): string[] {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  if (isIdeation && (params.promptMode === "direct" || params.promptMode === "final")) {
    return [
      "- 한국어로만 답변한다.",
      "- 사용자에게 바로 전달할 수 있는 최종 답변만 작성한다.",
      "- 내부 메타데이터, 파일 수정 보고, handoff 문구를 답변에 섞지 않는다.",
      "- 아이디어 요청이면 숫자 요구를 채우고, 각 후보의 차별점과 이유를 짧게 포함한다.",
    ];
  }
  return [
    "- 한국어로만 답변한다.",
    "- 실제로 수정한 파일이 있으면 파일 경로와 변경 이유를 짧게 적는다.",
    "- 작업을 못 했다면 못 한 이유를 숨기지 않는다.",
  ];
}

function resolveRoleTurnMode(params: {
  intent?: string;
  promptMode?: RunTaskRoleWithCodexInput["promptMode"];
}): "creative" | "logical" {
  const normalizedIntent = String(params.intent ?? "").trim().toLowerCase();
  if (
    normalizedIntent === "ideation" &&
    (params.promptMode === "direct" || params.promptMode === "final")
  ) {
    return "creative";
  }
  return "logical";
}

function looksLikeStructuredTaskPrompt(input: string): boolean {
  const firstNonEmptyLine = String(input ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstNonEmptyLine) {
    return false;
  }
  return [
    "# 작업 모드",
    "# 사용자 요청",
    "# 역할",
    "# 압축된 스레드 컨텍스트",
    "# 협업 규칙",
  ].includes(firstNonEmptyLine);
}

function extractMarkdownSection(input: string, headings: string[]): string {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }
  const pattern = headings
    .map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = normalized.match(
    new RegExp(`^\\s*#{1,6}\\s*(?:${pattern})\\s*$\\s*([\\s\\S]*?)(?=^\\s*#{1,6}\\s+\\S|$)`, "im"),
  );
  return String(match?.[1] ?? "").trim();
}

function extractAfterMarkdownHeading(input: string, headings: string[]): string {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }
  const pattern = headings
    .map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = normalized.match(
    new RegExp(`^\\s*#{1,6}\\s*(?:${pattern})\\s*$`, "im"),
  );
  if (!match || match.index == null) {
    return "";
  }
  return normalized.slice(match.index + match[0].length).trim();
}

function extractWebPromptRequest(input: string): string {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }
  const taggedRequest = normalized.match(/<task_request>\s*([\s\S]*?)\s*<\/task_request>/i)?.[1]?.trim();
  if (taggedRequest) {
    return taggedRequest;
  }
  const markdownRequest = extractMarkdownSection(normalized, ["USER REQUEST", "사용자 요청"]);
  if (markdownRequest) {
    return extractWebPromptRequest(markdownRequest);
  }
  const tailAfterRequestHeading = extractAfterMarkdownHeading(normalized, ["USER REQUEST", "사용자 요청"]);
  if (tailAfterRequestHeading) {
    const nestedRequest = extractWebPromptRequest(tailAfterRequestHeading);
    if (nestedRequest && nestedRequest !== tailAfterRequestHeading) {
      return nestedRequest;
    }
  }
  const withoutRoleKb = normalized.split("[ROLE_KB_INJECT]")[0]?.trim() || normalized;
  const strippedSections = withoutRoleKb.replace(
    /^\s*#{1,6}\s*(?:작업 모드|ROLE|WORKSPACE|DEVELOPER INSTRUCTIONS|협업 규칙|역할별 배정|압축된 스레드 컨텍스트|OUTPUT RULES|ROLE-SPECIFIC GOALS|참여 에이전트 브리프|역할별 1차 브리프|충돌\/누락 검토|실패한 참여 에이전트)\s*$[\s\S]*?(?=^\s*#{1,6}\s+\S|$)/gim,
    " ",
  ).trim();
  return strippedSections.replace(/\n{3,}/g, "\n\n").trim();
}

function extractWebPromptGuidelines(input: string): string[] {
  const sections = [
    extractMarkdownSection(input, ["ROLE-SPECIFIC GOALS"]),
    extractMarkdownSection(input, ["협업 규칙"]),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const lines = sections
    .flatMap((section) => section.split(/\r?\n/))
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(참여 에이전트 수|작업 경로|현재 목표|현재 단계|최근 대화|TASK_ID|GOAL|MODE|TEAM|ISOLATION)\b/i.test(line));
  return [...new Set(lines)].slice(0, 4);
}

function isIdeationWebPrompt(params: {
  promptText: string;
  request: string;
  intent?: string;
}): boolean {
  if (String(params.intent ?? "").trim().toLowerCase() === "ideation") {
    return true;
  }
  const combined = `${params.request}\n${params.promptText}`.toLowerCase();
  return /아이디어|창의|ideation|novel|creative|retention|리텐션|아류작|hook/.test(combined);
}

function buildWebProviderIntentInstructions(params: {
  intent?: string;
  promptMode?: "direct" | "orchestrate" | "brief" | "critique" | "judge" | "verify" | "final";
  request: string;
  promptText: string;
}): string[] {
  if (isIdeationWebPrompt(params)) {
    return [
      "이 요청은 창의적 아이데이션 품질을 끌어올리기 위한 외부 AI 관점 수집이다.",
      "상투적인 장르 조합, 대표작 두 개를 섞은 듯한 후보, 말만 화려하고 루프가 빈약한 후보는 스스로 제외한다.",
      "기억에 남는 한 줄 훅, 핵심 반복 루프, 리텐션 포인트, 왜 아류작 냄새가 약한지까지 함께 제시한다.",
      "후보들은 서로 다른 방향으로 충분히 벌리고, 가장 무난한 평균 답을 우선하지 않는다.",
    ];
  }
  if (params.promptMode === "critique") {
    return [
      "이 요청은 외부 시각에서 허점과 누락을 찾기 위한 검토 단계다.",
      "좋아 보이는 말보다 충돌, 빠진 검증 포인트, 구현 리스크를 우선 적는다.",
    ];
  }
  if (params.promptMode === "judge") {
    return [
      "이 요청은 멀티에이전트 결과의 품질 판정을 위한 단계다.",
      "좋고 나쁨의 감상보다 누락, 리스크, 보정 필요 여부를 구조적으로 판단한다.",
    ];
  }
  if (params.promptMode === "verify") {
    return [
      "이 요청은 최종 답변의 보수적 검증 단계다.",
      "과장, 근거 약한 주장, 제거해야 할 부분을 우선 찾는다.",
    ];
  }
  if (params.promptMode === "final") {
    return [
      "이 요청은 최종 사용자에게 바로 보여줄 수 있는 답 초안을 얻기 위한 외부 관점 수집이다.",
      "서론보다 바로 쓸 수 있는 결론과 근거를 우선한다.",
    ];
  }
  return [
    "이 요청은 내부 작업에 참고할 외부 AI 관점 수집이다.",
    "겉보기 요약보다 실제로 건질 수 있는 판단 근거, 대안, 리스크를 우선한다.",
  ];
}

function buildWebProviderPrompt(params: {
  pack: TaskAgentPromptPack;
  promptText: string;
  intent?: string;
  promptMode?: "direct" | "orchestrate" | "brief" | "critique" | "judge" | "verify" | "final";
}): string {
  const request = extractWebPromptRequest(params.promptText);
  const guidelines = extractWebPromptGuidelines(params.promptText);
  const intentInstructions = buildWebProviderIntentInstructions({
    intent: params.intent,
    promptMode: params.promptMode,
    request,
    promptText: params.promptText,
  });
  const lines = [
    `역할: ${params.pack.label}`,
    "",
    `사용자 요청:`,
    request || "사용자 요청을 찾지 못했습니다. 아래 문맥을 바탕으로 가장 그럴듯한 실제 요청을 복원해 답변하세요.",
  ];
  if (intentInstructions.length > 0) {
    lines.push("", "요청 해석:");
    for (const line of intentInstructions) {
      lines.push(`- ${line}`);
    }
  }
  if (guidelines.length > 0) {
    lines.push("", "추가 지침:");
    for (const line of guidelines) {
      lines.push(`- ${line}`);
    }
  }
  lines.push(
    "",
    "답변 규칙:",
    "- 한국어로만 답변한다.",
    "- 내부 역할 배정, 작업 모드, 스레드 메타데이터를 반복하지 않는다.",
    "- 최종 사용자에게 바로 보여줄 수 있는 답변만 작성한다.",
  );
  return lines.join("\n").trim();
}

function shouldUseExternalWebFallback(provider: string): boolean {
  const normalized = String(provider ?? "").trim().toLowerCase();
  return ["gemini", "gpt", "grok", "perplexity", "claude"].includes(normalized);
}

function extractFirstHttpUrl(input: string): string {
  const match = String(input ?? "").match(/https?:\/\/[^\s<>()]+/i);
  return String(match?.[0] ?? "").trim();
}

function shouldFallbackFromWebProviderResponse(result: WebProviderRunResult): boolean {
  const combined = `${String(result.error ?? "")}\n${String(result.text ?? "")}`.trim().toLowerCase();
  if (!combined) {
    return false;
  }
  return (
    combined.includes("rate limit") ||
    combined.includes("message limit") ||
    combined.includes("usage limit") ||
    combined.includes("quota") ||
    combined.includes("too many requests") ||
    combined.includes("try again later") ||
    combined.includes("come back later") ||
    combined.includes("free plan limit") ||
    combined.includes("무료 사용량") ||
    combined.includes("메시지 한도") ||
    combined.includes("사용량 한도") ||
    combined.includes("한도에 도달")
  );
}

async function resolveReadyExternalWebFallbackProviders(params: {
  invokeFn: InvokeFn;
  cwd: string;
}): Promise<ExternalFallbackProvider[]> {
  const providers: ExternalFallbackProvider[] = ["steel", "lightpanda_experimental"];
  const healthChecks = await Promise.all(
    providers.map(async (provider) => {
      try {
        const health = await params.invokeFn<{ ready?: boolean }>("dashboard_crawl_provider_health", {
          cwd: params.cwd,
          provider,
        });
        return Boolean(health?.ready) ? provider : null;
      } catch {
        return null;
      }
    }),
  );
  return healthChecks.filter(Boolean) as ExternalFallbackProvider[];
}

async function runWebProviderWithFallback(params: {
  invokeFn: InvokeFn;
  provider: string;
  prompt: string;
  timeoutMs: number;
  cwd: string;
  fallbackProviders: ExternalFallbackProvider[];
}): Promise<{
  requestedProvider: string;
  effectiveProvider: string;
  result: WebProviderRunResult;
}> {
  const directResult = await params.invokeFn<WebProviderRunResult>("web_provider_run", {
    provider: params.provider,
    prompt: params.prompt,
    timeoutMs: params.timeoutMs,
    mode: "bridgeAssisted",
    cwd: params.cwd,
  });
  const directText = String(directResult.text ?? "").trim();
  if (directResult.ok && directText && !shouldFallbackFromWebProviderResponse(directResult)) {
    return {
      requestedProvider: params.provider,
      effectiveProvider: params.provider,
      result: directResult,
    };
  }
  if (
    !shouldUseExternalWebFallback(params.provider)
    || params.fallbackProviders.length === 0
    || !extractFirstHttpUrl(params.prompt)
  ) {
    throw new Error(directResult.error || `${params.provider} web provider returned no usable response`);
  }
  const fallbackErrors = [
    `${params.provider}: ${String(directResult.error || "no usable response")}`,
  ];
  for (const fallbackProvider of params.fallbackProviders) {
    const fallbackResult = await params.invokeFn<WebProviderRunResult>("web_provider_run", {
      provider: fallbackProvider,
      prompt: params.prompt,
      timeoutMs: params.timeoutMs,
      mode: "auto",
      cwd: params.cwd,
    });
    const fallbackText = String(fallbackResult.text ?? "").trim();
    if (fallbackResult.ok && fallbackText) {
      return {
        requestedProvider: params.provider,
        effectiveProvider: fallbackProvider,
        result: fallbackResult,
      };
    }
    fallbackErrors.push(`${fallbackProvider}: ${String(fallbackResult.error || "no usable response")}`);
  }
  throw new Error(fallbackErrors.join(" | "));
}

function normalizeArtifactToken(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildWebRunDocument(params: {
  model?: string;
  requestedProvider: string;
  effectiveProvider: string;
  result: WebProviderRunResult;
}): WebRunDocument {
  const text = String(params.result.text ?? "").trim();
  return {
    model: params.model,
    requestedProvider: params.requestedProvider,
    effectiveProvider: params.effectiveProvider,
    text,
    raw: params.result.raw ?? params.result,
    meta: params.result.meta,
  };
}

async function writeWebRunArtifacts(params: {
  invokeFn: InvokeFn;
  artifactDir: string;
  documents: WebRunDocument[];
}): Promise<string[]> {
  const artifactPaths: string[] = [];
  for (const document of params.documents) {
    const requestedProvider = normalizeArtifactToken(document.requestedProvider) || "web";
    const effectiveProvider = normalizeArtifactToken(document.effectiveProvider) || requestedProvider;
    const fileName =
      requestedProvider === effectiveProvider
        ? `web_${requestedProvider}_response.md`
        : `web_${requestedProvider}_via_${effectiveProvider}_response.md`;
    const heading =
      document.requestedProvider === document.effectiveProvider
        ? document.requestedProvider.toUpperCase()
        : `${document.requestedProvider.toUpperCase()} -> ${document.effectiveProvider.toUpperCase()}`;
    const lines = [
      `# ${heading}`,
      "",
      `- requested_provider: ${document.requestedProvider}`,
      `- effective_provider: ${document.effectiveProvider}`,
      document.model ? `- model: ${document.model}` : "",
      document.meta?.url ? `- url: ${document.meta.url}` : "",
      document.meta?.startedAt ? `- started_at: ${document.meta.startedAt}` : "",
      document.meta?.finishedAt ? `- finished_at: ${document.meta.finishedAt}` : "",
      Number.isFinite(Number(document.meta?.elapsedMs)) ? `- elapsed_ms: ${Number(document.meta?.elapsedMs)}` : "",
      document.meta?.extractionStrategy ? `- extraction_strategy: ${document.meta.extractionStrategy}` : "",
      "",
      "## response",
      "",
      document.text,
    ].filter(Boolean);
    artifactPaths.push(await params.invokeFn<string>("workspace_write_text", {
      cwd: params.artifactDir,
      name: fileName,
      content: `${lines.join("\n")}\n`,
    }));
  }
  return artifactPaths;
}

function resolvePromptModeDeveloperInstructions(params: {
  pack: TaskAgentPromptPack;
  promptMode: RunTaskRoleWithCodexInput["promptMode"];
}): string {
  const promptMode = String(params.promptMode ?? "direct").trim().toLowerCase();
  if (promptMode === "orchestrate") {
    return [
      "당신은 멀티에이전트 작업의 오케스트레이터다.",
      "- 아래 사용자 요청과 컨텍스트를 읽고 가장 적절한 역할 배치를 결정한다.",
      "- 사용자 최종 답변을 대신 작성하지 않는다.",
      "- 역할별 기존 프롬프트 스타일이나 handoff 문체를 따라 하지 않는다.",
      "- 출력 규칙에 지정된 형식만 엄격히 따른다.",
    ].join("\n");
  }
  if (promptMode === "brief") {
    return [
      "당신은 멀티에이전트 협업에 참여하는 전문 기여자다.",
      "- 최종 답변 전체를 대신 쓰지 말고, 자신의 전문영역 기준으로 바로 최종 합성에 쓸 수 있는 실질 정보만 제공한다.",
      "- 기준 정리, handoff, 다음 단계 제안, 파일 수정 보고만 남기고 끝내지 않는다.",
      "- 아래 작업 모드와 출력 규칙을 우선한다.",
    ].join("\n");
  }
  if (promptMode === "critique") {
    return [
      "당신은 멀티에이전트 협업 결과를 검토하는 비평자다.",
      "- 충돌, 누락, 검증 공백, 논리적 약점만 지적한다.",
      "- 사용자 최종 답변을 대신 쓰지 않는다.",
      "- 아래 출력 규칙을 우선한다.",
    ].join("\n");
  }
  if (promptMode === "judge") {
    return [
      "당신은 멀티에이전트 결과의 품질 판정자다.",
      "- 참여 결과가 사용자 요청을 충족하는지 pass, repair, fallback 관점에서 냉정하게 평가한다.",
      "- 글을 멋지게 쓰는 것보다 누락과 리스크를 구조적으로 남긴다.",
      "- 아래 출력 규칙을 우선한다.",
    ].join("\n");
  }
  if (promptMode === "verify") {
    return [
      "당신은 최종 답변 검증자다.",
      "- 과장된 주장, 근거 약한 문장, 제거해야 할 부분을 먼저 찾는다.",
      "- 필요하면 더 보수적인 보정 방향만 제시한다.",
      "- 아래 출력 규칙을 우선한다.",
    ].join("\n");
  }
  if (promptMode === "final") {
    return [
      "당신은 최종 합성 담당자다.",
      "- 아래 참여 브리프와 비평을 바탕으로 사용자에게 바로 전달할 최종 답변만 작성한다.",
      "- 내부 브리프, 기준 확정, handoff, 다음 단계 제안, 파일 수정 보고로 답변을 대체하지 않는다.",
      "- 역할별 원문을 나열하지 말고 하나의 완결된 사용자 답변으로 합친다.",
      "- 아래 작업 모드와 출력 규칙을 최우선으로 따른다.",
    ].join("\n");
  }
  return params.pack.developerInstructions.trim();
}

function resolveRoleContextLayerBudget(roleId: string): RoleContextLayerBudget {
  return ROLE_CONTEXT_LAYER_BUDGETS[String(roleId ?? "").trim()] ?? DEFAULT_ROLE_CONTEXT_LAYER_BUDGET;
}

function trimContextLayer(value: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || maxChars <= 0) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function buildRolePromptContextLayers(params: {
  roleId: string;
  researchPromptContext?: string;
  learningPromptContext?: string;
}): string {
  const budget = resolveRoleContextLayerBudget(params.roleId);
  const researchLayer = trimContextLayer(params.researchPromptContext ?? "", budget.researchChars);
  const learningLayer = trimContextLayer(params.learningPromptContext ?? "", budget.learningChars);
  const joined = [researchLayer, learningLayer].filter(Boolean).join("\n\n");
  return trimContextLayer(joined, budget.totalChars);
}

export function isCodexCompletionMarkerText(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "item/completed" || normalized === "turn/completed";
}

export function resolveTurnText(raw: unknown): string {
  if (isUserOnlyTurn(raw) || isInputOnlyTurnPayload(raw)) {
    return "";
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)) {
    const items = (raw as { items: unknown[] }).items;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const type = String(record.type ?? "").trim().toLowerCase();
      const role = String(record.role ?? record.author ?? record.sender ?? "").trim().toLowerCase();
      const phase = String(record.phase ?? "").trim().toLowerCase();
      if (type === "usermessage" || role === "user") {
        continue;
      }
      const text = String(record.text ?? "").trim() || [...new Set(collectNestedText(record.content))].join("\n").trim();
      if (!text || isCodexCompletionMarkerText(text)) {
        continue;
      }
      if (type === "agentmessage" || phase === "final_answer") {
        return text;
      }
    }
  }
  const structuredText = collectReadableTurnCandidates(raw)
    .map((entry) => entry.text)
    .find(Boolean);
  if (structuredText) {
    return structuredText;
  }
  const fallbackText = (
    extractFinalAnswer(raw) ||
    (extractStringByPaths(raw, [
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
    ]) ?? extractDeltaText(raw))
  ).trim();
  return isCodexCompletionMarkerText(fallbackText) ? "" : fallbackText;
}

function hasReadableTurnText(raw: unknown): boolean {
  return resolveTurnText(raw).trim().length > 0;
}

function isInputOnlyTurnPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  const topLevelText = String(record.text ?? "").trim();
  if (!topLevelText) {
    return false;
  }
  const inputText = extractStringByPaths(record, [
    "input.0.text",
    "input.0.content.0.text",
    "request.input.0.text",
  ]);
  if (!inputText || inputText.trim() !== topLevelText) {
    return false;
  }
  const responseRoots = [
    record.output,
    record.outputs,
    record.response,
    record.result,
    record.turn,
    record.completion,
    record.items,
  ];
  return responseRoots.every((value) => {
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return value == null;
  });
}

type TurnTextCandidate = {
  text: string;
  score: number;
  path: string[];
};

function collectReadableTurnCandidates(input: unknown, depth = 0, path: string[] = []): TurnTextCandidate[] {
  if (depth > 10 || input == null) {
    return [];
  }
  if (typeof input === "string") {
    const text = input.trim();
    if (!text || isCodexCompletionMarkerText(text)) {
      return [];
    }
    const leafKey = String(path[path.length - 1] ?? "").trim().toLowerCase();
    const normalizedPath = path.map((segment) => String(segment ?? "").trim().toLowerCase());
    const blockedKeys = new Set([
      "input",
      "prompt",
      "request",
      "developerinstructions",
      "instructions",
      "sandboxpolicy",
      "reasoning",
      "usage",
      "metadata",
      "phase",
      "status",
      "state",
      "id",
      "threadid",
      "turnid",
      "cwd",
      "model",
      "role",
      "author",
      "method",
      "type",
    ]);
    if (normalizedPath.some((segment) => blockedKeys.has(segment))) {
      return [];
    }
    const preferredLeafKeys = new Set([
      "text",
      "output_text",
      "outputtext",
      "summary",
      "finaldraft",
      "content",
      "message",
      "value",
    ]);
    let score = text.length;
    if (preferredLeafKeys.has(leafKey)) {
      score += 120;
    }
    if (text.includes("\n")) {
      score += 80;
    }
    return [{ text, score, path: [...path] }];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item, index) => collectReadableTurnCandidates(item, depth + 1, [...path, String(index)]));
  }
  if (typeof input !== "object") {
    return [];
  }

  const record = input as Record<string, unknown>;
  if (depth === 0 && isInputOnlyTurnPayload(record)) {
    return [];
  }
  const type = String(record.type ?? record.kind ?? "").trim().toLowerCase();
  const role = String(record.role ?? record.author ?? record.sender ?? "").trim().toLowerCase();
  const phase = String(record.phase ?? "").trim().toLowerCase();
  const isMetaLike =
    type === "status" ||
    type === "event" ||
    type === "metadata" ||
    type === "usage" ||
    type === "reasoning" ||
    type === "system";
  const isUserLike =
    role === "user" ||
    type === "usermessage" ||
    type === "input_text" ||
    type === "input";
  if (isMetaLike) {
    return [];
  }
  if (isUserLike) {
    return [];
  }
  const isAssistantLike =
    role === "assistant" ||
    role === "model" ||
    type === "agentmessage" ||
    type === "message" ||
    type === "output_text" ||
    phase === "final_answer";

  const prioritizedKeys = isAssistantLike
    ? ["text", "output_text", "outputText", "summary", "content", "message"]
    : ["output", "outputs", "content", "response", "result", "turn", "completion", "data", "items", "message"];
  const visited = new Set<string>();
  const candidates: TurnTextCandidate[] = [];

  for (const key of prioritizedKeys) {
    if (!(key in record) || visited.has(key)) {
      continue;
    }
    visited.add(key);
      const nested = collectReadableTurnCandidates(record[key], depth + 1, [...path, key]).map((entry) => ({
        text: entry.text,
        score: entry.score + (isAssistantLike ? 180 : 0),
        path: entry.path,
      }));
    candidates.push(...nested);
  }

  if (!isAssistantLike) {
    const secondaryKeys = ["text", "output_text", "outputText", "summary"];
    for (const key of secondaryKeys) {
      if (!(key in record) || visited.has(key)) {
        continue;
      }
      visited.add(key);
      candidates.push(...collectReadableTurnCandidates(record[key], depth + 1, [...path, key]));
    }
  }

  if (candidates.length > 0) {
    return [...new Map(
      candidates
        .sort((left, right) => right.score - left.score)
        .map((entry) => [entry.text, entry]),
    ).values()];
  }

  return Object.entries(record).flatMap(([key, value]) =>
    collectReadableTurnCandidates(value, depth + 1, [...path, key]),
  );
}

function collectNestedText(input: unknown, depth = 0): string[] {
  if (depth > 8 || input == null) {
    return [];
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item) => collectNestedText(item, depth + 1));
  }
  if (typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  const directKeys = ["text", "output_text", "outputText", "summary", "message", "content"];
  const direct = directKeys.flatMap((key) => {
    const value = record[key];
    return typeof value === "string" ? collectNestedText(value, depth + 1) : [];
  });
  const nestedKeys = ["output", "outputs", "content", "response", "result", "turn", "completion", "data"];
  const nested = nestedKeys.flatMap((key) => collectNestedText(record[key], depth + 1));
  return [...direct, ...nested];
}

function previewDiagnosticText(value: unknown, maxChars = 240): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function summarizeTurnTextCandidates(raw: unknown, limit = 8): Array<{
  rank: number;
  score: number;
  path: string;
  textLength: number;
  textPreview: string;
}> {
  return collectReadableTurnCandidates(raw)
    .slice(0, limit)
    .map((candidate, index) => ({
      rank: index + 1,
      score: candidate.score,
      path: candidate.path.join("."),
      textLength: candidate.text.length,
      textPreview: previewDiagnosticText(candidate.text),
    }));
}

function normalizeTurnStatus(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
  return normalized || null;
}

function normalizeErrorText(error: unknown): string {
  return String(error ?? "").trim().toLowerCase();
}

function isRetryableThreadReadError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return (
    text.includes("empty session file") ||
    text.includes("failed to load rollout") ||
    text.includes("not materialized yet") ||
    text.includes("includeturns is unavailable before first user message") ||
    text.includes("temporarily unavailable") ||
    text.includes("rpc error -32600") ||
    text.includes("rpc error -32603") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("busy") ||
    text.includes("econnreset") ||
    text.includes("socket hang up")
  );
}

function isRetryableTurnStartError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return (
    text.includes("empty session file") ||
    text.includes("failed to load rollout") ||
    text.includes("not materialized yet") ||
    text.includes("includeturns is unavailable before first user message") ||
    text.includes("rpc error -32600") ||
    text.includes("rpc error -32603") ||
    text.includes("temporarily unavailable") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("busy") ||
    text.includes("econnreset") ||
    text.includes("socket hang up")
  );
}

function isUnsupportedTurnStartCommandError(error: unknown): boolean {
  const text = normalizeErrorText(error);
  return text.includes("unknown command") || text.includes("unexpected command");
}

function resolveTurnStatus(raw: unknown): string | null {
  const completedStatus = extractCompletedStatus(raw);
  if (completedStatus) {
    return completedStatus.toLowerCase();
  }
  return normalizeTurnStatus(
    extractStringByPaths(raw, [
      "status",
      "turn.status",
      "response.status",
      "result.status",
      "completion.status",
    ]),
  );
}

function isUserOnlyTurn(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  const type = String(record.type ?? "").trim().toLowerCase();
  const role = String(record.role ?? record.author ?? record.sender ?? "").trim().toLowerCase();
  if (type === "usermessage" || role === "user") {
    return true;
  }
  if (!Array.isArray(record.items) || record.items.length === 0) {
    return false;
  }
  return record.items.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const itemRecord = item as Record<string, unknown>;
    const itemType = String(itemRecord.type ?? "").trim().toLowerCase();
    const itemRole = String(itemRecord.role ?? itemRecord.author ?? itemRecord.sender ?? "").trim().toLowerCase();
    return itemType === "usermessage" || itemRole === "user";
  });
}

function scoreTurnCandidate(raw: unknown, index: number): number {
  const status = resolveTurnStatus(raw) ?? "";
  const text = resolveTurnText(raw);
  let score = index;
  if (text) {
    score += 10_000 + text.length;
  }
  if (status && !INCOMPLETE_TURN_STATUSES.has(status)) {
    score += 2_000;
  }
  if (FAILED_TURN_STATUSES.has(status)) {
    score += 500;
  }
  if (isUserOnlyTurn(raw)) {
    score -= 20_000;
  }
  return score;
}

function extractLatestTurn(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const root = raw as Record<string, unknown>;
  const candidates = [
    root.turns,
    (root.thread as Record<string, unknown> | undefined)?.turns,
    (root.response as Record<string, unknown> | undefined)?.turns,
    (root.result as Record<string, unknown> | undefined)?.turns,
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length > 0) {
      let bestCandidate = value[0];
      let bestScore = Number.NEGATIVE_INFINITY;
      value.forEach((candidate, index) => {
        const score = scoreTurnCandidate(candidate, index);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      });
      return bestCandidate;
    }
  }
  return raw;
}

function buildTurnProgressSignature(raw: unknown): string {
  const latestTurn = extractLatestTurn(raw);
  const target = latestTurn && latestTurn !== raw ? latestTurn : raw;
  const turnId = extractStringByPaths(target, ["id", "turnId", "turn_id", "response.id"]) ?? "";
  const status = resolveTurnStatus(target) ?? resolveTurnStatus(raw) ?? "";
  const completedStatus = extractCompletedStatus(target) || extractCompletedStatus(raw);
  const readableText = resolveTurnText(target) || resolveTurnText(raw);
  const deltaText = extractDeltaText(target) || extractDeltaText(raw);
  return JSON.stringify({
    turnId,
    status,
    completedStatus,
    readableText,
    deltaText,
  });
}

function shouldExtendTurnCompletionWatch(params: {
  previousRaw: unknown;
  nextRaw: unknown;
}): boolean {
  const previousTurn = extractLatestTurn(params.previousRaw);
  const nextTurn = extractLatestTurn(params.nextRaw);
  const previousStatus = resolveTurnStatus(previousTurn) ?? resolveTurnStatus(params.previousRaw) ?? "";
  const nextStatus = resolveTurnStatus(nextTurn) ?? resolveTurnStatus(params.nextRaw) ?? "";
  const previousReadable = resolveTurnText(previousTurn) || resolveTurnText(params.previousRaw);
  const nextReadable = resolveTurnText(nextTurn) || resolveTurnText(params.nextRaw);
  const previousDelta = extractDeltaText(previousTurn) || extractDeltaText(params.previousRaw);
  const nextDelta = extractDeltaText(nextTurn) || extractDeltaText(params.nextRaw);
  const previousTurnId = extractStringByPaths(previousTurn, ["id", "turnId", "turn_id", "response.id"]) ?? "";
  const nextTurnId = extractStringByPaths(nextTurn, ["id", "turnId", "turn_id", "response.id"]) ?? "";

  if (nextReadable && nextReadable !== previousReadable) {
    return true;
  }
  if (nextDelta && nextDelta !== previousDelta) {
    return true;
  }
  if (INCOMPLETE_TURN_STATUSES.has(nextStatus)) {
    return nextStatus !== previousStatus || nextTurnId !== previousTurnId || nextDelta !== previousDelta;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      globalThis.clearTimeout(timer);
    }
  }
}

async function startCodexThreadWithRecovery(params: {
  invokeFn: InvokeFn;
  model: string;
  cwd: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
}): Promise<ThreadStartResult> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_THREAD_START_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(
        params.invokeFn<ThreadStartResult>("thread_start", {
          model: params.model,
          cwd: params.cwd,
          sandboxMode: params.sandboxMode,
        }),
        THREAD_START_TIMEOUT_MS,
        "thread_start",
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableTurnStartError(error) || attempt >= MAX_THREAD_START_ATTEMPTS) {
        throw error;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("thread_start failed");
}

async function recoverThreadStateAfterTurnStartError(params: {
  invokeFn: InvokeFn;
  threadId: string;
  idleTimeoutMs: number;
  onProgress?: (message?: string) => void;
}): Promise<unknown | null> {
  let idleDeadline = Date.now() + Math.max(params.idleTimeoutMs, POLL_INTERVAL_MS);
  let readErrors = 0;
  let previousState: unknown = null;
  while (Date.now() < idleDeadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const threadState = await withTimeout(
        params.invokeFn<unknown>("codex_thread_read", {
          threadId: params.threadId,
          includeTurns: true,
        }),
        THREAD_READ_TIMEOUT_MS,
        "codex_thread_read",
      );
      const latestTurn = extractLatestTurn(threadState);
      if (
        previousState &&
        shouldExtendTurnCompletionWatch({
          previousRaw: previousState,
          nextRaw: threadState,
        })
      ) {
        idleDeadline = Date.now() + params.idleTimeoutMs;
        params.onProgress?.("코덱스 실행 시작 상태를 다시 확인하는 중");
      }
      previousState = threadState;
      const recoveredStatus = resolveTurnStatus(latestTurn) ?? resolveTurnStatus(threadState) ?? "";
      const recoveredText = resolveTurnText(latestTurn) || resolveTurnText(threadState);
      if (recoveredStatus || recoveredText) {
        return latestTurn === threadState ? threadState : latestTurn;
      }
    } catch (error) {
      if (!isRetryableThreadReadError(error) || readErrors >= MAX_POLL_READ_ERRORS) {
        throw error;
      }
      readErrors += 1;
    }
  }
  return null;
}

async function startCodexTurnWithRecovery(params: {
  invokeFn: InvokeFn;
  threadId: string;
  text: string;
  reasoningEffort: string;
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  executionConfigPatch?: Record<string, unknown>;
  pollTimeoutMs: number;
  onProgress?: (message?: string) => void;
}): Promise<{
  rawResponse: unknown;
  turnError: unknown;
}> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_TURN_START_ATTEMPTS; attempt += 1) {
    try {
      let rawResponse: unknown;
      try {
        rawResponse = await withTimeout(
          params.invokeFn<unknown>("turn_start", {
            threadId: params.threadId,
            text: params.text,
            reasoningEffort: params.reasoningEffort,
            sandboxMode: params.sandboxMode,
            ...params.executionConfigPatch,
          }),
          TURN_START_TIMEOUT_MS,
          "turn_start",
        );
      } catch (error) {
        if (!isUnsupportedTurnStartCommandError(error)) {
          throw error;
        }
        rawResponse = await withTimeout(
          params.invokeFn<unknown>("turn_start_blocking", {
            threadId: params.threadId,
            text: params.text,
            reasoningEffort: params.reasoningEffort,
            sandboxMode: params.sandboxMode,
            ...params.executionConfigPatch,
          }),
          TURN_START_TIMEOUT_MS,
          "turn_start_blocking",
        );
      }
      return {
        rawResponse,
        turnError: null,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableTurnStartError(error)) {
        return {
          rawResponse: null,
          turnError: error,
        };
      }
      const recoveredState = await recoverThreadStateAfterTurnStartError({
        invokeFn: params.invokeFn,
        threadId: params.threadId,
        idleTimeoutMs: params.pollTimeoutMs,
        onProgress: params.onProgress,
      });
      if (recoveredState) {
        return {
          rawResponse: recoveredState,
          turnError: null,
        };
      }
      if (attempt < MAX_TURN_START_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }
  return {
    rawResponse: null,
    turnError: lastError,
  };
}

async function waitForCodexTurnCompletion(params: {
  invokeFn: InvokeFn;
  threadId: string;
  turnId?: string;
  initialResponse: unknown;
  pollTimeoutMs: number;
  completedUnreadableRecoveryWindowMs?: number;
  onProgress?: (message?: string) => void;
  onThreadReadSnapshot?: (snapshot: {
    threadState: unknown;
    latestTurn: unknown;
    status: string;
    hasReadableText: boolean;
  }) => void;
}): Promise<{
  raw: unknown;
  completedStatus: string;
}> {
  let currentRaw = params.initialResponse;
  let currentStatus = resolveTurnStatus(extractLatestTurn(currentRaw)) ?? resolveTurnStatus(currentRaw) ?? "";
  if (!INCOMPLETE_TURN_STATUSES.has(currentStatus) && (FAILED_TURN_STATUSES.has(currentStatus) || hasReadableTurnText(currentRaw))) {
    return {
      raw: currentRaw,
      completedStatus: currentStatus || "done",
    };
  }

  const notificationResult = await waitForTurnTerminalFromEngineNotifications({
    threadId: params.threadId,
    turnId: params.turnId,
    idleTimeoutMs: Math.min(params.pollTimeoutMs, 10_000),
    onProgress: params.onProgress,
  });
  if (notificationResult) {
    currentRaw = notificationResult.raw;
    currentStatus = notificationResult.status || currentStatus;
    if (FAILED_TURN_STATUSES.has(currentStatus) || hasReadableTurnText(currentRaw)) {
      return {
        raw: currentRaw,
        completedStatus: currentStatus || "done",
      };
    }
  }

  const initialCompletedUnreadable =
    Boolean(currentStatus) &&
    !INCOMPLETE_TURN_STATUSES.has(currentStatus) &&
    !FAILED_TURN_STATUSES.has(currentStatus) &&
    !hasReadableTurnText(currentRaw);
  let idleDeadline = Date.now() + (
    initialCompletedUnreadable
      ? Math.max(params.completedUnreadableRecoveryWindowMs ?? params.pollTimeoutMs, POLL_INTERVAL_MS)
      : params.pollTimeoutMs
  );
  let nextPollDelayMs = notificationResult
    ? NOTIFICATION_RECOVERY_POLL_INTERVAL_MS
    : POLL_INTERVAL_MS;
  let lastProgressSignature = buildTurnProgressSignature(currentRaw);
  let readErrors = 0;
  while (Date.now() < idleDeadline) {
    await sleep(nextPollDelayMs);
    let threadState: unknown;
    try {
      threadState = await withTimeout(
        params.invokeFn<unknown>("codex_thread_read", {
          threadId: params.threadId,
          includeTurns: true,
        }),
        THREAD_READ_TIMEOUT_MS,
        "codex_thread_read",
      );
      readErrors = 0;
    } catch (error) {
      if (!isRetryableThreadReadError(error) || readErrors >= MAX_POLL_READ_ERRORS) {
        throw error;
      }
      readErrors += 1;
      continue;
    }
    const latestTurn = extractLatestTurn(threadState);
    const nextStatus = resolveTurnStatus(latestTurn) ?? resolveTurnStatus(threadState) ?? currentStatus;
    const nextText = resolveTurnText(latestTurn) || resolveTurnText(threadState);
    params.onThreadReadSnapshot?.({
      threadState,
      latestTurn,
      status: nextStatus,
      hasReadableText: Boolean(nextText),
    });
    const previousRaw = currentRaw;
    const nextProgressSignature = buildTurnProgressSignature(threadState);
    if (
      nextProgressSignature !== lastProgressSignature &&
      shouldExtendTurnCompletionWatch({
        previousRaw,
        nextRaw: threadState,
      })
    ) {
      lastProgressSignature = nextProgressSignature;
      idleDeadline = Date.now() + params.pollTimeoutMs;
      nextPollDelayMs = notificationResult
        ? NOTIFICATION_RECOVERY_POLL_INTERVAL_MS
        : POLL_INTERVAL_MS;
      params.onProgress?.("코덱스 응답 진행 확인 중");
    } else if (notificationResult) {
      nextPollDelayMs = Math.min(
        Math.round(nextPollDelayMs * 1.5),
        NOTIFICATION_RECOVERY_MAX_POLL_INTERVAL_MS,
      );
    }
    currentRaw = latestTurn === threadState ? threadState : latestTurn;
    currentStatus = nextStatus;
    if (FAILED_TURN_STATUSES.has(currentStatus)) {
      return {
        raw: currentRaw,
        completedStatus: currentStatus,
      };
    }
    if (!INCOMPLETE_TURN_STATUSES.has(currentStatus) && (FAILED_TURN_STATUSES.has(currentStatus) || nextText)) {
      return {
        raw: currentRaw,
        completedStatus: currentStatus,
      };
    }
  }

  if (currentStatus && !INCOMPLETE_TURN_STATUSES.has(currentStatus)) {
    return {
      raw: currentRaw,
      completedStatus: currentStatus,
    };
  }

  throw new Error(`Codex turn did not complete (${currentStatus || "timeout"})`);
}

async function writeUnreadableCodexDebugArtifacts(params: {
  invokeFn: InvokeFn;
  artifactDir: string;
  taskId: string;
  studioRoleId: string;
  codexThreadId?: string;
  codexTurnId?: string;
  completedStatus: string;
  turnError: unknown;
  turnStartRaw: unknown;
  finalRaw: unknown;
  threadReadSnapshots: Array<{
    status: string;
    hasReadableText: boolean;
    latestTurn: unknown;
    threadState: unknown;
  }>;
  turnTextCandidates: Array<{
    rank: number;
    score: number;
    path: string;
    textLength: number;
    textPreview: string;
  }>;
}): Promise<void> {
  const debugPayload = {
    taskId: params.taskId,
    studioRoleId: params.studioRoleId,
    codexThreadId: params.codexThreadId ?? null,
    codexTurnId: params.codexTurnId ?? null,
    completedStatus: params.completedStatus,
    turnError: params.turnError instanceof Error ? params.turnError.message : params.turnError ?? null,
    turnStartRaw: params.turnStartRaw,
    finalRaw: params.finalRaw,
    threadReadSnapshots: params.threadReadSnapshots.map((snapshot, index) => ({
      index,
      status: snapshot.status,
      hasReadableText: snapshot.hasReadableText,
      latestTurn: snapshot.latestTurn,
      threadState: snapshot.threadState,
    })),
    turnTextCandidates: params.turnTextCandidates,
  };
  await params.invokeFn<string>("workspace_write_text", {
    cwd: params.artifactDir,
    name: "response.unreadable.debug.json",
    content: `${JSON.stringify(debugPayload, null, 2)}\n`,
  });
}

type TaskRoleRunDiagnosticSnapshot = {
  status: string;
  hasReadableText: boolean;
  latestTurn: unknown;
  threadState: unknown;
};

type TaskRoleRunDiagnosticPayload = {
  phase: "success" | "error";
  taskId: string;
  runId: string;
  studioRoleId: string;
  promptMode: string;
  intent: string;
  projectPath: string;
  model: string;
  models: string[];
  executor: string;
  webProvider: string | null;
  webProviders: string[];
  modelEngine: string | null;
  reasoningEffort: string;
  sandboxMode: string;
  pollTimeoutMs: number;
  codexThreadId: string | null;
  codexTurnId: string | null;
  completedStatus: string;
  summaryLength: number;
  summaryPreview: string;
  hasReadableTurnText: boolean;
  isUserOnlyTurn: boolean;
  isInputOnlyTurnPayload: boolean;
  turnError: string | null;
  finalError: string | null;
  turnTextCandidates: Array<{
    rank: number;
    score: number;
    path: string;
    textLength: number;
    textPreview: string;
  }>;
  threadReadSnapshots: Array<TaskRoleRunDiagnosticSnapshot & { index: number }>;
  debugArtifactWriteErrors: string[];
};

async function tryWriteDebugArtifact(params: {
  invokeFn: InvokeFn;
  artifactDir: string;
  name: string;
  content: string;
  artifactPaths: string[];
  writeErrors: string[];
}): Promise<string> {
  try {
    const path = await params.invokeFn<string>("workspace_write_text", {
      cwd: params.artifactDir,
      name: params.name,
      content: params.content,
    });
    const normalized = String(path ?? "").trim();
    if (normalized) {
      params.artifactPaths.push(normalized);
    }
    return normalized;
  } catch (error) {
    params.writeErrors.push(`${params.name}: ${String(error ?? "unknown error")}`);
    return "";
  }
}

function buildTaskRoleRunDiagnosticPayload(params: {
  phase: "success" | "error";
  taskId: string;
  runId: string;
  studioRoleId: string;
  promptMode?: string;
  intent?: string;
  projectPath: string;
  model: string;
  models: string[];
  executor: string;
  webProvider?: string | null;
  webProviders: string[];
  modelEngine?: string | null;
  reasoningEffort: string;
  sandboxMode: string;
  pollTimeoutMs: number;
  codexThreadId?: string;
  codexTurnId?: string;
  completedStatus: string;
  summary: string;
  turnError: unknown;
  finalError?: unknown;
  finalRaw: unknown;
  threadReadSnapshots: TaskRoleRunDiagnosticSnapshot[];
  debugArtifactWriteErrors: string[];
}): TaskRoleRunDiagnosticPayload {
  return {
    phase: params.phase,
    taskId: params.taskId,
    runId: params.runId,
    studioRoleId: params.studioRoleId,
    promptMode: String(params.promptMode ?? "").trim(),
    intent: String(params.intent ?? "").trim(),
    projectPath: params.projectPath,
    model: params.model,
    models: [...params.models],
    executor: params.executor,
    webProvider: params.webProvider ?? null,
    webProviders: [...params.webProviders],
    modelEngine: params.modelEngine ?? null,
    reasoningEffort: params.reasoningEffort,
    sandboxMode: params.sandboxMode,
    pollTimeoutMs: params.pollTimeoutMs,
    codexThreadId: params.codexThreadId ?? null,
    codexTurnId: params.codexTurnId ?? null,
    completedStatus: params.completedStatus,
    summaryLength: params.summary.length,
    summaryPreview: previewDiagnosticText(params.summary),
    hasReadableTurnText: hasReadableTurnText(params.finalRaw),
    isUserOnlyTurn: isUserOnlyTurn(params.finalRaw),
    isInputOnlyTurnPayload: isInputOnlyTurnPayload(params.finalRaw),
    turnError: params.turnError instanceof Error ? params.turnError.message : String(params.turnError ?? "").trim() || null,
    finalError: params.finalError instanceof Error ? params.finalError.message : String(params.finalError ?? "").trim() || null,
    turnTextCandidates: summarizeTurnTextCandidates(params.finalRaw),
    threadReadSnapshots: params.threadReadSnapshots.map((snapshot, index) => ({
      index,
      status: snapshot.status,
      hasReadableText: snapshot.hasReadableText,
      latestTurn: snapshot.latestTurn,
      threadState: snapshot.threadState,
    })),
    debugArtifactWriteErrors: [...params.debugArtifactWriteErrors],
  };
}

async function resolveTaskRunContext(input: RunTaskRoleWithCodexInput): Promise<{
  projectPath: string;
  threadModel: string;
  threadReasoning: string;
}> {
  if (input.sourceTab === "tasks-thread") {
    const detail = await input.invokeFn<ThreadLoadShape>("thread_load", {
      cwd: input.storageCwd,
      threadId: input.taskId,
    });
    return {
      projectPath: String(detail.task.worktreePath || detail.task.workspacePath || input.storageCwd).trim(),
      threadModel: String(detail.thread.model || "GPT-5.4").trim(),
      threadReasoning: String(detail.thread.reasoning || "중간").trim(),
    };
  }

  const detail = await input.invokeFn<TaskLoadShape>("task_load", {
    cwd: input.storageCwd,
    taskId: input.taskId,
  });
  return {
    projectPath: String(detail.record.worktreePath || detail.record.workspacePath || input.storageCwd).trim(),
    threadModel: "GPT-5.4",
    threadReasoning: "중간",
  };
}

export async function runTaskRoleWithCodex(input: RunTaskRoleWithCodexInput): Promise<TaskRoleCodexRunResult> {
  const pack = await input.invokeFn<TaskAgentPromptPack>("task_agent_pack_read", {
    roleId: input.studioRoleId,
  });
  const context = await resolveTaskRunContext(input);
  const artifactDir = `${input.storageCwd.replace(/[\\/]+$/, "")}/.rail/tasks/${input.taskId}/codex_runs/${input.runId}`;
  const researcherCollection = await prepareResearcherCollectionContext({
    artifactDir,
    invokeFn: input.invokeFn,
    pack,
    prompt: input.prompt ?? "",
    storageCwd: input.storageCwd,
  });
  const sandboxMode = normalizeSandboxMode(pack.sandboxMode);
  const selectedModels = resolvePreferredRuntimeModels({
    inputModels: input.models,
    inputModel: input.model,
    threadModel: context.threadModel,
    packModel: pack.model,
  });
  const primarySelectedModel = selectedModels[0] ?? "GPT-5.4";
  const runtimeModelOption = findRuntimeModelOption(primarySelectedModel);
  const webProvider = getWebProviderFromExecutor(runtimeModelOption.executor);
  const webProviders = [...new Set(
    selectedModels
      .map((model) => {
        const option = findRuntimeModelOption(model);
        const provider = getWebProviderFromExecutor(option.executor);
        return provider ? { model, option, provider } : null;
      })
      .filter(Boolean) as Array<{ model: string; option: ReturnType<typeof findRuntimeModelOption>; provider: string }>,
  )];
  const modelEngine = toTurnModelEngineId(primarySelectedModel);
  const reasoningEffort = toTurnReasoningEffort(
    input.reasoning || context.threadReasoning || pack.modelReasoningEffort || "중간",
  );
  const shouldIncludeLearningPromptContext = !(
    String(input.intent ?? "").trim().toLowerCase() === "ideation" &&
    (input.promptMode === "direct" || input.promptMode === "final")
  );
  const learningPromptContext = shouldIncludeLearningPromptContext
    ? buildTaskRoleLearningPromptContext({
      cwd: input.storageCwd,
      roleId: pack.studioRoleId || input.studioRoleId,
      prompt: input.prompt ?? "",
    })
    : "";
  const layeredPromptContext = buildRolePromptContextLayers({
    roleId: pack.studioRoleId || input.studioRoleId,
    researchPromptContext: researcherCollection.promptContext,
    learningPromptContext,
  });
  const promptText = buildRoleTurnPrompt(
    pack,
    input.prompt ?? "",
    context.projectPath,
    input.promptMode,
    input.intent,
    layeredPromptContext,
  );
  const webPromptText = buildWebProviderPrompt({
    pack,
    promptText,
    intent: input.intent,
    promptMode: input.promptMode,
  });
  const readyExternalFallbackProviders = webProviders.some(({ provider }) => shouldUseExternalWebFallback(provider))
    ? await resolveReadyExternalWebFallbackProviders({
      invokeFn: input.invokeFn,
      cwd: context.projectPath,
    })
    : [];
  const pollTimeoutMs = resolveRolePollTimeoutMs({
    studioRoleId: pack.studioRoleId,
    intent: input.intent,
    promptMode: input.promptMode,
  });
  const executionConfigPatch = resolveStudioRoleExecutionConfigPatch(
    (pack.studioRoleId || input.studioRoleId) as StudioRoleId,
    resolveRoleTurnMode({
      intent: input.intent,
      promptMode: input.promptMode,
    }),
  );

  let rawResponse: unknown = null;
  let turnError: unknown = null;
  let completedStatus = "done";
  let summary = "";
  let codexThreadId: string | undefined;
  let codexTurnId: string | undefined;
  let webRunDocuments: WebRunDocument[] = [];
  let turnStartRawResponse: unknown = null;
  const codexThreadReadSnapshots: Array<{
    status: string;
    hasReadableText: boolean;
    latestTurn: unknown;
    threadState: unknown;
  }> = [];
  const diagnosticArtifactPaths: string[] = [];
  const debugArtifactWriteErrors: string[] = [];
  let promptArtifactPath = "";
  let responseArtifactPath = "";
  let responseJsonPath = "";
  let ensuredResearcherArtifactPaths = [...researcherCollection.artifactPaths];

  const writeDiagnosticArtifact = async (name: string, content: string) => tryWriteDebugArtifact({
    invokeFn: input.invokeFn,
    artifactDir,
    name,
    content,
    artifactPaths: diagnosticArtifactPaths,
    writeErrors: debugArtifactWriteErrors,
  });

  const writeRunDiagnostics = async (phase: "success" | "error", finalError?: unknown) => {
    const payload = buildTaskRoleRunDiagnosticPayload({
      phase,
      taskId: input.taskId,
      runId: input.runId,
      studioRoleId: input.studioRoleId,
      promptMode: input.promptMode,
      intent: input.intent,
      projectPath: context.projectPath,
      model: primarySelectedModel,
      models: selectedModels,
      executor: runtimeModelOption.executor,
      webProvider,
      webProviders: webProviders.map((entry) => entry.provider),
      modelEngine: webProvider ? null : modelEngine,
      reasoningEffort,
      sandboxMode,
      pollTimeoutMs,
      codexThreadId,
      codexTurnId,
      completedStatus,
      summary,
      turnError,
      finalError,
      finalRaw: rawResponse,
      threadReadSnapshots: codexThreadReadSnapshots,
      debugArtifactWriteErrors,
    });
    await writeDiagnosticArtifact("run.diagnostics.json", `${JSON.stringify(payload, null, 2)}\n`);
  };

  try {
    if (webProviders.length > 1) {
    const providerNames = webProviders.map((entry) => entry.provider);
    const webTimeoutMs = providerNames.reduce(
      (currentMax, provider) => Math.max(currentMax, resolveWebProviderTimeoutMs(provider, pollTimeoutMs)),
      pollTimeoutMs,
    );
    input.onRuntimeSession?.({
      provider: providerNames[0] ?? null,
      providers: providerNames,
      codexThreadId: null,
      codexTurnId: null,
    });
    const providerResults = await Promise.allSettled(
      webProviders.map(async ({ model, provider }) => {
        const webRun = await runWebProviderWithFallback({
          invokeFn: input.invokeFn,
          provider,
          prompt: webPromptText,
          timeoutMs: webTimeoutMs,
          cwd: context.projectPath,
          fallbackProviders: readyExternalFallbackProviders,
        });
        return {
          model,
          provider: webRun.requestedProvider,
          effectiveProvider: webRun.effectiveProvider,
          result: webRun.result,
        };
      }),
    );
    const successfulResults = providerResults.flatMap((entry) => {
      if (entry.status !== "fulfilled") {
        return [];
      }
      const document = buildWebRunDocument({
        model: entry.value.model,
        requestedProvider: entry.value.provider,
        effectiveProvider: entry.value.effectiveProvider,
        result: entry.value.result,
      });
      if (!entry.value.result.ok || !document.text) {
        return [];
      }
      return [document];
    });
    if (successfulResults.length === 0) {
      const errors = providerResults.map((entry, index) => {
        const provider = providerNames[index] ?? `provider-${index + 1}`;
        if (entry.status !== "fulfilled") {
          return `${provider}: ${String(entry.reason ?? "unknown error")}`;
        }
        return `${provider}: ${String(entry.value.result.error || "no usable response")}`;
      });
      throw new Error(errors.join(" | "));
    }
    webRunDocuments = successfulResults;
    rawResponse = successfulResults.map(({ model, requestedProvider, effectiveProvider, raw, text, meta }) => ({
      model,
      requestedProvider,
      effectiveProvider,
      text,
      raw,
      meta: meta ?? null,
    }));
    summary = successfulResults
      .map(({ requestedProvider, effectiveProvider, text }) => {
        const requestedLabel = String(requestedProvider ?? "").trim().toUpperCase();
        const effectiveLabel = String(effectiveProvider ?? requestedProvider ?? "").trim().toUpperCase();
        const heading = requestedLabel === effectiveLabel ? requestedLabel : `${requestedLabel} -> ${effectiveLabel}`;
        return `## ${heading}\n${text}`;
      })
      .join("\n\n");
    completedStatus = "completed";
  } else if (webProvider) {
    const webTimeoutMs = resolveWebProviderTimeoutMs(webProvider, pollTimeoutMs);
    input.onRuntimeSession?.({
      provider: webProvider,
      providers: [webProvider],
      codexThreadId: null,
      codexTurnId: null,
    });
    const webRun = await runWebProviderWithFallback({
      invokeFn: input.invokeFn,
      provider: webProvider,
      prompt: webPromptText,
      timeoutMs: webTimeoutMs,
      cwd: context.projectPath,
      fallbackProviders: readyExternalFallbackProviders,
    });
    const webResult = webRun.result;
    const webRunDocument = buildWebRunDocument({
      model: primarySelectedModel,
      requestedProvider: webRun.requestedProvider,
      effectiveProvider: webRun.effectiveProvider,
      result: webResult,
    });
    webRunDocuments = [webRunDocument];
    rawResponse = {
      requestedProvider: webRun.requestedProvider,
      effectiveProvider: webRun.effectiveProvider,
      text: webRunDocument.text,
      raw: webRunDocument.raw,
      meta: webRunDocument.meta ?? null,
    };
    if (!webResult.ok || !String(webResult.text ?? "").trim()) {
      throw new Error(webResult.error || `${webProvider} web provider returned no usable response`);
    }
    summary = webRunDocument.text;
    completedStatus = "completed";
  } else {
    input.onProgress?.("코덱스 스레드를 준비하는 중");
    const threadStart = await startCodexThreadWithRecovery({
      invokeFn: input.invokeFn,
      model: modelEngine,
      cwd: context.projectPath,
      sandboxMode,
    });
    codexThreadId = threadStart.threadId;
    input.onRuntimeSession?.({
      codexThreadId,
      codexTurnId: null,
      provider: null,
      providers: [],
    });
    input.onProgress?.("코덱스 요청을 전송하는 중");
    const turnStart = await startCodexTurnWithRecovery({
      invokeFn: input.invokeFn,
      threadId: threadStart.threadId,
      text: promptText,
      reasoningEffort,
      sandboxMode,
      executionConfigPatch,
      pollTimeoutMs,
      onProgress: input.onProgress,
    });
    rawResponse = turnStart.rawResponse;
    turnStartRawResponse = turnStart.rawResponse;
    turnError = turnStart.turnError;

    completedStatus = turnError ? "error" : (resolveTurnStatus(rawResponse) ?? "done");
    const needsCompletionWait =
      !turnError &&
      (INCOMPLETE_TURN_STATUSES.has(completedStatus) ||
        (!FAILED_TURN_STATUSES.has(completedStatus) && !hasReadableTurnText(rawResponse)));
    if (needsCompletionWait) {
      input.onProgress?.("코덱스 응답을 확인하는 중");
      const completion = await waitForCodexTurnCompletion({
        invokeFn: input.invokeFn,
        threadId: threadStart.threadId,
        turnId: extractStringByPaths(rawResponse, ["turnId", "turn_id", "id", "turn.id", "response.id"]) ?? undefined,
        initialResponse: rawResponse,
        pollTimeoutMs,
        completedUnreadableRecoveryWindowMs: input.debugTimeoutOverrides?.completedUnreadableRecoveryWindowMs,
        onProgress: input.onProgress,
        onThreadReadSnapshot: (snapshot) => {
          codexThreadReadSnapshots.push({
            status: snapshot.status,
            hasReadableText: snapshot.hasReadableText,
            latestTurn: snapshot.latestTurn,
            threadState: snapshot.threadState,
          });
        },
      });
      rawResponse = completion.raw;
      completedStatus = completion.completedStatus;
    }
    if (FAILED_TURN_STATUSES.has(completedStatus)) {
      if (turnError instanceof Error) {
        throw turnError;
      }
      throw new Error(`Codex turn failed (${completedStatus})`);
    }

    summary = (!turnError ? resolveTurnText(rawResponse) : "").trim();
    if (!summary) {
      if (turnError instanceof Error) {
        throw turnError;
      }
      await writeDiagnosticArtifact("response.unreadable.json", `${JSON.stringify(rawResponse, null, 2)}\n`);
      try {
        await writeUnreadableCodexDebugArtifacts({
          invokeFn: input.invokeFn,
          artifactDir,
          taskId: input.taskId,
          studioRoleId: input.studioRoleId,
          codexThreadId,
          codexTurnId,
          completedStatus,
          turnError,
          turnStartRaw: turnStartRawResponse,
          finalRaw: rawResponse,
          threadReadSnapshots: codexThreadReadSnapshots,
          turnTextCandidates: summarizeTurnTextCandidates(rawResponse),
        });
        diagnosticArtifactPaths.push(`${artifactDir}/response.unreadable.debug.json`);
      } catch (error) {
        debugArtifactWriteErrors.push(`response.unreadable.debug.json: ${String(error ?? "unknown error")}`);
      }
      throw new Error("Codex turn finished without a readable response");
    }
    codexTurnId = extractStringByPaths(rawResponse, ["turnId", "turn_id", "id", "turn.id", "response.id"]) ?? undefined;
    input.onRuntimeSession?.({
      codexThreadId: codexThreadId ?? null,
      codexTurnId: codexTurnId ?? null,
      provider: null,
      providers: [],
    });
  }

  promptArtifactPath = await input.invokeFn<string>("workspace_write_text", {
    cwd: artifactDir,
    name: "prompt.md",
    content: `${promptText}\n`,
  });
  responseArtifactPath = await input.invokeFn<string>("workspace_write_text", {
    cwd: artifactDir,
    name: String(input.outputArtifactName || pack.outputArtifactName || `${pack.id}.md`).trim(),
    content: `${summary}\n`,
  });
  const webRunArtifactPaths = webRunDocuments.length > 0
    ? await writeWebRunArtifacts({
      invokeFn: input.invokeFn,
      artifactDir,
      documents: webRunDocuments,
    })
    : [];
  responseJsonPath = await input.invokeFn<string>("workspace_write_text", {
    cwd: artifactDir,
    name: "response.json",
    content: `${JSON.stringify(
      {
        taskId: input.taskId,
        studioRoleId: input.studioRoleId,
        projectPath: context.projectPath,
        model: primarySelectedModel,
        models: selectedModels,
        executor: runtimeModelOption.executor,
        webProvider: webProvider ?? null,
        webProviders: webProviders.map((entry) => entry.provider),
        modelEngine: webProvider ? null : modelEngine,
        reasoningEffort,
        sandboxMode,
        codexThreadId: codexThreadId ?? null,
        codexTurnId: codexTurnId ?? null,
        completedStatus,
        turnError: turnError instanceof Error ? turnError.message : turnError ?? null,
        fullText: summary,
        raw: rawResponse,
      },
      null,
      2,
    )}\n`,
  });

  ensuredResearcherArtifactPaths =
    pack.id === "researcher" || pack.studioRoleId === "research_analyst"
      ? await ensureResearcherCollectionArtifacts({
          invokeFn: input.invokeFn,
          artifactDir,
          existingArtifactPaths: researcherCollection.artifactPaths,
          findingsMarkdown: summary,
          fallbackSummary: researcherCollection.fallbackSummary,
        })
      : researcherCollection.artifactPaths;

    await writeRunDiagnostics("success");

    return {
      summary,
      artifactPaths: [
        ...ensuredResearcherArtifactPaths,
        promptArtifactPath,
        responseArtifactPath,
        ...webRunArtifactPaths,
        responseJsonPath,
        ...diagnosticArtifactPaths,
      ].map((value) => String(value ?? "").trim()).filter(Boolean),
      usage: webProvider ? undefined : extractUsageStats(rawResponse),
      codexThreadId,
      codexTurnId,
    };
  } catch (error) {
    if (!promptArtifactPath && promptText.trim()) {
      await writeDiagnosticArtifact("prompt.md", `${promptText}\n`);
    }
    await writeRunDiagnostics("error", error);
    await writeDiagnosticArtifact("run.error.json", `${JSON.stringify({
      taskId: input.taskId,
      runId: input.runId,
      studioRoleId: input.studioRoleId,
      error: error instanceof Error ? error.message : String(error ?? "unknown error"),
      completedStatus,
      codexThreadId: codexThreadId ?? null,
      codexTurnId: codexTurnId ?? null,
      diagnosticArtifactPaths,
      debugArtifactWriteErrors,
    }, null, 2)}\n`);
    if (error instanceof TaskRoleCodexRunError) {
      throw error;
    }
    throw new TaskRoleCodexRunError(
      error instanceof Error ? error.message : String(error ?? "unknown error"),
      {
        artifactPaths: [...ensuredResearcherArtifactPaths, ...diagnosticArtifactPaths],
        codexThreadId,
        codexTurnId,
        completedStatus,
      },
    );
  }
}
