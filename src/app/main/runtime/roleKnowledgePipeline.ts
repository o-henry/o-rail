import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import {
  getRoleKnowledgeProfile,
  persistRoleKnowledgeProfilesToWorkspace,
  upsertRoleKnowledgeProfile,
  type RoleKnowledgeProfile,
  type RoleKnowledgeSource,
} from "../../../features/studio/roleKnowledgeStore";
import { buildStudioRolePromptEnvelope } from "../../../features/studio/rolePromptGuidance";
import { STUDIO_ROLE_TEMPLATES } from "../../../features/studio/roleTemplates";
import { buildRoleKnowledgeBootstrapCandidates } from "./roleKnowledgeBootstrapSources";
import { toCompactTimestamp, toRoleShortToken } from "./roleKnowledgePathUtils";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type ScraplingFetchResult = {
  url?: string;
  fetched_at?: string;
  summary?: string;
  content?: string;
  markdown_path?: string;
  json_path?: string;
};

type ScraplingBridgeHealth = {
  running?: boolean;
  scrapling_ready?: boolean;
  scraplingReady?: boolean;
  message?: string;
};

type RoleKnowledgeBootstrapInput = {
  cwd: string;
  invokeFn: InvokeFn;
  roleId: StudioRoleId;
  taskId: string;
  runId: string;
  userPrompt?: string;
};

type RoleKnowledgeStoreInput = {
  cwd: string;
  invokeFn: InvokeFn;
  profile: RoleKnowledgeProfile;
};

type RoleKnowledgeInjectInput = {
  roleId: StudioRoleId;
  prompt?: string;
  profile?: RoleKnowledgeProfile | null;
};

type RoleKnowledgeBootstrapResult = {
  profile: RoleKnowledgeProfile;
  sourceCount: number;
  sourceSuccessCount: number;
  artifactPaths: string[];
  message: string;
};

type RoleKnowledgeStoreResult = {
  profile: RoleKnowledgeProfile;
  artifactPaths: string[];
  message: string;
};

type RoleKnowledgeInjectResult = {
  prompt: string;
  usedProfile: boolean;
  message: string;
};

const ROLE_KB_TOPIC = "devEcosystem";
const SCRAPLING_BRIDGE_NOT_READY = "SCRAPLING_BRIDGE_NOT_READY";
const bridgeReadyPromiseByCwd = new Map<string, Promise<void>>();
const ROLE_KB_BRIDGE_TIMEOUT_MS = 12000;
const ROLE_KB_FETCH_TIMEOUT_MS = 10000;
const ROLE_KB_MIN_SUCCESS_RATIO = 0.5;
const ROLE_KB_MAX_ATTEMPTS = 3;

function resolveRoleTemplate(roleId: StudioRoleId) {
  return (
    STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId) ?? {
      id: roleId,
      label: roleId,
      goal: "역할 지식 정리",
      defaultTaskId: "TASK-001",
    }
  );
}

function cleanLine(input: unknown): string {
  return String(input ?? "").replace(/\s+/g, " ").trim();
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

function isBridgeReady(health: ScraplingBridgeHealth | null | undefined): boolean {
  if (!health) {
    return false;
  }
  return Boolean(health.running) && Boolean(health.scrapling_ready ?? health.scraplingReady);
}

async function ensureScraplingBridgeReady(params: { cwd: string; invokeFn: InvokeFn }): Promise<void> {
  const normalizedCwd = cleanLine(params.cwd);
  if (!normalizedCwd) {
    throw new Error("cwd is required");
  }
  const cacheKey = normalizedCwd;
  const existing = bridgeReadyPromiseByCwd.get(cacheKey);
  if (existing) {
    return existing;
  }
  const task = (async () => {
    let health: ScraplingBridgeHealth | null = null;
    try {
      health = await withTimeout(
        params.invokeFn<ScraplingBridgeHealth>("dashboard_scrapling_bridge_start", {
          cwd: normalizedCwd,
        }),
        ROLE_KB_BRIDGE_TIMEOUT_MS,
        "dashboard_scrapling_bridge_start",
      );
    } catch {
      health = null;
    }
    if (isBridgeReady(health)) {
      return;
    }

    await withTimeout(
      params.invokeFn("dashboard_scrapling_bridge_install", {
        cwd: normalizedCwd,
      }),
      ROLE_KB_BRIDGE_TIMEOUT_MS,
      "dashboard_scrapling_bridge_install",
    );

    health = await withTimeout(
      params.invokeFn<ScraplingBridgeHealth>("dashboard_scrapling_bridge_start", {
        cwd: normalizedCwd,
      }),
      ROLE_KB_BRIDGE_TIMEOUT_MS,
      "dashboard_scrapling_bridge_start",
    );
    if (!isBridgeReady(health)) {
      const reason = cleanLine(health?.message);
      throw new Error(
        reason
          ? `${SCRAPLING_BRIDGE_NOT_READY}: ${reason}`
          : SCRAPLING_BRIDGE_NOT_READY,
      );
    }
  })();

  bridgeReadyPromiseByCwd.set(cacheKey, task);
  try {
    await task;
  } catch (error) {
    bridgeReadyPromiseByCwd.delete(cacheKey);
    throw error;
  }
}

function truncateText(input: unknown, max = 220): string {
  const text = cleanLine(input);
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function buildFallbackPoints(roleLabel: string, roleGoal: string): string[] {
  return [
    `${roleLabel}의 핵심 목표는 "${roleGoal}" 입니다.`,
    "요구사항을 실행 단위로 분해하고 완료 기준(Definition of Done)을 먼저 확정합니다.",
    "산출물은 다음 담당자가 바로 이어서 작업할 수 있게 경로/근거/결정 이유를 남깁니다.",
  ];
}

function resolveBootstrapFailureReason(sourceResults: RoleKnowledgeSource[]): string {
  const loweredErrors = sourceResults
    .map((row) => cleanLine(row.error).toLowerCase())
    .filter(Boolean);
  if (loweredErrors.some((row) => row.includes("unauthorized"))) {
    return "Scrapling bridge 인증 실패로 외부 근거를 수집하지 못했습니다.";
  }
  if (loweredErrors.some((row) => row.includes("health check failed") || row.includes(SCRAPLING_BRIDGE_NOT_READY.toLowerCase()))) {
    return "Scrapling bridge 상태 확인에 실패해 외부 근거를 수집하지 못했습니다.";
  }
  return "외부 근거 수집에 실패했습니다.";
}

function buildProfileSummary(params: {
  roleLabel: string;
  taskId: string;
  keyPointCount: number;
  successCount: number;
  sourceCount: number;
  sourceResults: RoleKnowledgeSource[];
}): string {
  if (params.successCount === 0) {
    return `${params.roleLabel} 기준 ${params.taskId} 실행을 위한 외부 근거 수집에 실패했습니다. ${resolveBootstrapFailureReason(
      params.sourceResults,
    )} (수집 성공 ${params.successCount}/${params.sourceCount})`;
  }
  return `${params.roleLabel} 기준 ${params.taskId} 실행을 위한 핵심 근거 ${params.keyPointCount}개를 정리했습니다. (수집 성공 ${params.successCount}건)`;
}

function buildBootstrapFailurePoints(params: {
  roleLabel: string;
  roleGoal: string;
  userPromptLine: string;
  sourceResults: RoleKnowledgeSource[];
}): string[] {
  const sourceFailures = params.sourceResults
    .filter((row) => row.status === "error")
    .slice(0, 3)
    .map((row) => `소스 수집 실패: ${row.url} (${truncateText(row.error, 120)})`);
  return [
    `${params.roleLabel}의 핵심 목표는 "${params.roleGoal}" 입니다.`,
    params.userPromptLine ? `이번 요청 핵심: ${params.userPromptLine}` : "",
    resolveBootstrapFailureReason(params.sourceResults),
    ...sourceFailures,
    "외부 근거가 없으므로 현재 응답은 웹 증거가 아니라 요청 문맥과 내부 가이드만 기반으로 작성됩니다.",
  ].filter(Boolean);
}

function buildRoleKnowledgeBlock(profile: RoleKnowledgeProfile): string {
  const sourceLines = profile.sources
    .filter((row) => row.status === "ok")
    .slice(0, 4)
    .map((row) => `- ${row.url}${row.summary ? ` :: ${truncateText(row.summary, 140)}` : ""}`);
  return [
    "[ROLE_KB_INJECT]",
    `- ROLE: ${profile.roleLabel.toUpperCase()}`,
    `- GOAL: ${profile.goal}`,
    `- SUMMARY: ${profile.summary}`,
    "- KEY POINTS:",
    ...profile.keyPoints.slice(0, 6).map((line) => `  - ${line}`),
    sourceLines.length > 0 ? "- SOURCES:" : "- SOURCES: N/A",
    ...sourceLines.map((line) => `  ${line}`),
    "[/ROLE_KB_INJECT]",
  ].join("\n");
}

async function fetchRoleKnowledgeSource(params: {
  cwd: string;
  invokeFn: InvokeFn;
  url: string;
}): Promise<RoleKnowledgeSource> {
  try {
    await ensureScraplingBridgeReady({
      cwd: params.cwd,
      invokeFn: params.invokeFn,
    });
    const result = await withTimeout(
      params.invokeFn<ScraplingFetchResult>("dashboard_scrapling_fetch_url", {
        cwd: params.cwd,
        url: params.url,
        topic: ROLE_KB_TOPIC,
      }),
      ROLE_KB_FETCH_TIMEOUT_MS,
      "dashboard_scrapling_fetch_url",
    );
    return {
      url: cleanLine(result.url) || params.url,
      status: "ok",
      fetchedAt: cleanLine(result.fetched_at) || new Date().toISOString(),
      summary: truncateText(result.summary, 320),
      content: truncateText(result.content, 480),
      markdownPath: undefined,
      jsonPath: cleanLine(result.json_path) || undefined,
    };
  } catch (error) {
    const errorText = truncateText(error, 320);
    const shouldRetry =
      errorText.includes("scrapling bridge is not ready") ||
      errorText.includes(SCRAPLING_BRIDGE_NOT_READY);
    if (shouldRetry) {
      try {
        bridgeReadyPromiseByCwd.delete(cleanLine(params.cwd));
        await ensureScraplingBridgeReady({
          cwd: params.cwd,
          invokeFn: params.invokeFn,
        });
        const retried = await withTimeout(
          params.invokeFn<ScraplingFetchResult>("dashboard_scrapling_fetch_url", {
            cwd: params.cwd,
            url: params.url,
            topic: ROLE_KB_TOPIC,
          }),
          ROLE_KB_FETCH_TIMEOUT_MS,
          "dashboard_scrapling_fetch_url",
        );
        return {
          url: cleanLine(retried.url) || params.url,
          status: "ok",
          fetchedAt: cleanLine(retried.fetched_at) || new Date().toISOString(),
          summary: truncateText(retried.summary, 320),
          content: truncateText(retried.content, 480),
          markdownPath: undefined,
          jsonPath: cleanLine(retried.json_path) || undefined,
        };
      } catch (retryError) {
        return {
          url: params.url,
          status: "error",
          error: truncateText(retryError, 320),
        };
      }
    }
    return {
      url: params.url,
      status: "error",
      error: errorText,
    };
  }
}

function resolveBootstrapMinSuccessCount(sourceCount: number): number {
  if (sourceCount <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(sourceCount * ROLE_KB_MIN_SUCCESS_RATIO));
}

function mergeBootstrapSourceResults(
  previous: RoleKnowledgeSource[] | null,
  current: RoleKnowledgeSource[],
): RoleKnowledgeSource[] {
  if (!previous || previous.length === 0) {
    return current;
  }
  return current.map((row, index) => {
    const prior = previous[index];
    if (!prior) {
      return row;
    }
    if (prior.status === "ok" && row.status !== "ok") {
      return prior;
    }
    return row;
  });
}

async function fetchBootstrapSourcesWithRetry(params: {
  cwd: string;
  invokeFn: InvokeFn;
  roleId: StudioRoleId;
  urls: string[];
}) {
  const minSuccessCount = resolveBootstrapMinSuccessCount(params.urls.length);
  let bestResults: RoleKnowledgeSource[] = [];
  let successfulSources: RoleKnowledgeSource[] = [];
  let attemptsUsed = 0;

  while (attemptsUsed < ROLE_KB_MAX_ATTEMPTS) {
    attemptsUsed += 1;
    const currentResults = await Promise.all(
      params.urls.map((url) => fetchRoleKnowledgeSource({
        cwd: params.cwd,
        invokeFn: params.invokeFn,
        url,
      })),
    );
    bestResults = mergeBootstrapSourceResults(bestResults, currentResults);
    successfulSources = bestResults.filter((row) => row.status === "ok");
    if (successfulSources.length >= minSuccessCount) {
      break;
    }
    if (params.roleId !== "research_analyst") {
      break;
    }
  }

  return {
    sourceResults: bestResults,
    successfulSources,
    attemptsUsed,
    minSuccessCount,
  };
}

export async function bootstrapRoleKnowledgeProfile(input: RoleKnowledgeBootstrapInput): Promise<RoleKnowledgeBootstrapResult> {
  const roleTemplate = resolveRoleTemplate(input.roleId);
  const urls = buildRoleKnowledgeBootstrapCandidates({
    roleId: input.roleId,
    userPrompt: input.userPrompt,
  });
  const {
    sourceResults,
    successfulSources,
    attemptsUsed,
    minSuccessCount,
  } = await fetchBootstrapSourcesWithRetry({
    cwd: input.cwd,
    invokeFn: input.invokeFn,
    roleId: input.roleId,
    urls,
  });
  const evidencePoints = successfulSources
    .map((row) => truncateText(row.summary || row.content, 180))
    .filter(Boolean)
    .slice(0, 6);
  const userPromptLine = truncateText(input.userPrompt, 180);
  const keyPoints =
    successfulSources.length > 0
      ? [
          ...buildFallbackPoints(roleTemplate.label, roleTemplate.goal),
          ...(userPromptLine ? [`이번 요청 핵심: ${userPromptLine}`] : []),
          ...evidencePoints,
        ].filter(Boolean)
      : buildBootstrapFailurePoints({
          roleLabel: roleTemplate.label,
          roleGoal: roleTemplate.goal,
          userPromptLine,
          sourceResults,
        });

  const profile: RoleKnowledgeProfile = {
    roleId: input.roleId,
    roleLabel: roleTemplate.label,
    goal: roleTemplate.goal,
    taskId: cleanLine(input.taskId) || roleTemplate.defaultTaskId,
    runId: input.runId,
    summary: buildProfileSummary({
      roleLabel: roleTemplate.label,
      taskId: cleanLine(input.taskId) || roleTemplate.defaultTaskId,
      keyPointCount: keyPoints.length,
      successCount: successfulSources.length,
      sourceCount: sourceResults.length,
      sourceResults,
    }),
    keyPoints,
    sources: sourceResults,
    updatedAt: new Date().toISOString(),
  };

  const artifactPaths = sourceResults
    .flatMap((row) => [row.jsonPath])
    .map((row) => cleanLine(row))
    .filter(Boolean);

  return {
    profile,
    sourceCount: sourceResults.length,
    sourceSuccessCount: successfulSources.length,
    artifactPaths,
    message:
      successfulSources.length > 0
        ? `ROLE_KB_BOOTSTRAP 완료 (${successfulSources.length}/${sourceResults.length})${attemptsUsed > 1 ? ` · 재시도 ${attemptsUsed}회` : ""}${successfulSources.length < minSuccessCount ? " · 부분 성공" : ""}`
        : `ROLE_KB_BOOTSTRAP 실패 (${successfulSources.length}/${sourceResults.length})${attemptsUsed > 1 ? ` · 재시도 ${attemptsUsed}회` : ""}`,
  };
}

export async function storeRoleKnowledgeProfile(input: RoleKnowledgeStoreInput): Promise<RoleKnowledgeStoreResult> {
  const baseCwd = cleanLine(input.cwd).replace(/[\\/]+$/, "");
  const roleDir = `${baseCwd}/.rail/studio_index/role_kb`;
  const roleToken = toRoleShortToken(input.profile.roleId);
  const timestamp = toCompactTimestamp(input.profile.updatedAt);
  const jsonName = `role_kb_${timestamp}_${roleToken}.json`;

  const jsonPath = await input.invokeFn<string>("workspace_write_text", {
    cwd: roleDir,
    name: jsonName,
    content: `${JSON.stringify(input.profile, null, 2)}\n`,
  });

  const profileWithPaths: RoleKnowledgeProfile = {
    ...input.profile,
    markdownPath: undefined,
    jsonPath: cleanLine(jsonPath) || undefined,
  };
  const rows = upsertRoleKnowledgeProfile(profileWithPaths);
  const indexPath = await persistRoleKnowledgeProfilesToWorkspace({
    cwd: input.cwd,
    invokeFn: input.invokeFn,
    rows,
  });

  const artifactPaths = [jsonPath, indexPath ?? ""].map((row) => cleanLine(row)).filter(Boolean);
  return {
    profile: profileWithPaths,
    artifactPaths,
    message: "ROLE_KB_STORE 완료",
  };
}

export async function injectRoleKnowledgePrompt(input: RoleKnowledgeInjectInput): Promise<RoleKnowledgeInjectResult> {
  const basePrompt = cleanLine(input.prompt);
  const profile = input.profile ?? getRoleKnowledgeProfile(input.roleId);
  if (!profile) {
    return {
      prompt: buildStudioRolePromptEnvelope({
        roleId: input.roleId,
        request: basePrompt,
      }),
      usedProfile: false,
      message: "ROLE_KB_INJECT 생략 (프로필 없음)",
    };
  }
  const kbBlock = buildRoleKnowledgeBlock(profile);
  const mergedPrompt = buildStudioRolePromptEnvelope({
    roleId: profile.roleId,
    roleLabel: profile.roleLabel,
    goal: profile.goal,
    taskId: profile.taskId,
    request: basePrompt,
    contextBlocks: [kbBlock],
  });
  return {
    prompt: mergedPrompt,
    usedProfile: true,
    message: "ROLE_KB_INJECT 완료",
  };
}
