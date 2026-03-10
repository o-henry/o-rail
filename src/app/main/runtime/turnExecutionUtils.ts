import { buildSchemaRetryInput, mergeUsageStats, normalizeArtifactOutput, rankInternalMemorySnippets } from "../../mainAppRuntimeHelpers";
import { resolveNodeCwd } from "../../mainAppUtils";
import {
  toArtifactType,
  getTurnExecutor,
  type PresetKind,
  type TurnConfig,
  type TurnExecutor,
} from "../../../features/workflow/domain";
import { nodeTypeLabel, turnRoleLabel } from "../../../features/workflow/labels";
import { extractSchemaValidationTarget, resolveProviderByExecutor } from "../../mainAppRuntimeHelpers";
import { getRoleInstanceKnowledgeProfile, getRoleKnowledgeProfile } from "../../../features/studio/roleKnowledgeStore";
import { buildMergedRoleKnowledgePrompt } from "../../../features/studio/roleKnowledgePrompt";
import { isLegacyPmStudioRole, resolveEffectiveStudioRoleId } from "../../../features/studio/pmPlanningMode";
import { toStudioRoleId } from "../../../features/studio/roleUtils";
import type {
  AgentRuleDoc,
  AgentRulesReadResult,
  InternalMemorySnippet,
  InternalMemoryTraceEntry,
  KnowledgeRetrieveResult,
  KnowledgeTraceEntry,
  UsageStats,
} from "../types";
import type { GraphNode } from "../../../features/workflow/types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function loadAgentRuleDocs(params: {
  nodeCwd: string;
  cwd: string;
  cacheTtlMs: number;
  maxDocs: number;
  maxDocChars: number;
  agentRulesCacheRef: { current: Record<string, { loadedAt: number; docs: AgentRuleDoc[] }> };
  invokeFn: InvokeFn;
}): Promise<AgentRuleDoc[]> {
  const cwdKey = resolveNodeCwd(params.nodeCwd, params.cwd);
  if (!cwdKey) {
    return [];
  }

  const cached = params.agentRulesCacheRef.current[cwdKey];
  if (cached && Date.now() - cached.loadedAt <= params.cacheTtlMs) {
    return cached.docs;
  }

  try {
    const result = await params.invokeFn<AgentRulesReadResult>("agent_rules_read", {
      cwd: cwdKey,
      baseCwd: params.cwd,
    });
    const docs = (result.docs ?? [])
      .filter((row) => row && typeof row.path === "string" && typeof row.content === "string")
      .slice(0, params.maxDocs)
      .map((row) => ({
        path: String(row.path).trim() || "unknown.md",
        content: String(row.content).slice(0, params.maxDocChars).trim(),
      }))
      .filter((row) => row.content.length > 0);
    params.agentRulesCacheRef.current[cwdKey] = { loadedAt: Date.now(), docs };
    return docs;
  } catch {
    return [];
  }
}

export async function injectKnowledgeContext(params: {
  node: GraphNode;
  prompt: string;
  config: TurnConfig;
  workflowQuestion: string;
  activeRunPresetKind?: PresetKind;
  internalMemoryCorpus: InternalMemorySnippet[];
  enabledKnowledgeFiles: Array<{ id: string; name: string; enabled: boolean }>;
  graphKnowledge: { topK: number; maxChars: number };
  addNodeLog: (nodeId: string, message: string) => void;
  invokeFn: InvokeFn;
}): Promise<{
  prompt: string;
  trace: KnowledgeTraceEntry[];
  memoryTrace: InternalMemoryTraceEntry[];
}> {
  const knowledgeEnabled = params.config.knowledgeEnabled !== false;
  if (!knowledgeEnabled) {
    return { prompt: params.prompt, trace: [], memoryTrace: [] };
  }

  const nodeRoleHint = params.node.type === "turn" ? turnRoleLabel(params.node) : nodeTypeLabel(params.node.type);
  let mergedPrompt = params.prompt;
  const memoryTrace: InternalMemoryTraceEntry[] = [];
  const nodeConfig = params.node.config as Record<string, unknown>;
  const baseRoleId =
    params.node.type === "turn" && String(nodeConfig.sourceKind ?? "").trim().toLowerCase() === "handoff"
      ? toStudioRoleId(String(nodeConfig.handoffRoleId ?? ""))
      : null;
  const shouldResolvePmVariant =
    isLegacyPmStudioRole(baseRoleId)
    || (baseRoleId === "pm_planner" && String(nodeConfig.pmPlanningMode ?? "").trim().length > 0);
  const roleId = shouldResolvePmVariant
    ? resolveEffectiveStudioRoleId(baseRoleId, nodeConfig.pmPlanningMode)
    : baseRoleId;
  const roleInstanceId = String(nodeConfig.roleInstanceId ?? "").trim();
  const storedRoleKnowledge = roleId ? getRoleKnowledgeProfile(roleId) : null;
  const storedInstanceKnowledge =
    roleId && roleInstanceId ? getRoleInstanceKnowledgeProfile(roleId, roleInstanceId) : null;

  if (storedRoleKnowledge || storedInstanceKnowledge) {
    mergedPrompt = `${buildMergedRoleKnowledgePrompt({
      sharedProfile: storedRoleKnowledge,
      instanceProfile: storedInstanceKnowledge,
    })}\n\n[요청]\n${mergedPrompt}`.trim();
    params.addNodeLog(
      params.node.id,
      `[역할 지식] ${storedRoleKnowledge?.roleLabel ?? roleId ?? "role"} 누적 지식${storedInstanceKnowledge ? " + 관점 지식" : ""} 반영`,
    );
  }

  const rankedMemory = rankInternalMemorySnippets({
    query: `${params.workflowQuestion}\n${params.prompt}`,
    snippets: params.internalMemoryCorpus,
    nodeId: params.node.id,
    roleLabel: nodeRoleHint,
    topK: 3,
    presetKind: params.activeRunPresetKind,
  });
  if (rankedMemory.length > 0) {
    const memoryLines = rankedMemory.map(
      ({ snippet, score }) =>
        `- [run: ${snippet.runId}${snippet.nodeId ? ` / ${snippet.nodeId}` : ""} / score: ${score.toFixed(2)}] ${snippet.text}`,
    );
    mergedPrompt = `[내부 실행 메모리]
${memoryLines.join("\n")}
[/내부 실행 메모리]

[요청]
${mergedPrompt}`.trim();
    params.addNodeLog(params.node.id, `[메모리] 과거 실행 메모리 ${rankedMemory.length}개 반영`);
    memoryTrace.push(
      ...rankedMemory.map((entry) => ({
        nodeId: params.node.id,
        snippetId: entry.snippet.id,
        sourceRunId: entry.snippet.runId,
        score: Math.round(entry.score * 1000) / 1000,
        reason: entry.reason,
      })),
    );
  }

  if (params.enabledKnowledgeFiles.length === 0 || (params.graphKnowledge?.topK ?? 0) <= 0) {
    return { prompt: mergedPrompt, trace: [], memoryTrace };
  }

  try {
    const result = await params.invokeFn<KnowledgeRetrieveResult>("knowledge_retrieve", {
      files: params.enabledKnowledgeFiles,
      query: params.prompt,
      topK: params.graphKnowledge?.topK,
      maxChars: params.graphKnowledge?.maxChars,
    });

    for (const warning of result.warnings) {
      params.addNodeLog(params.node.id, `[첨부] ${warning}`);
    }

    if (result.snippets.length === 0) {
      params.addNodeLog(params.node.id, "[첨부] 관련 문단을 찾지 못해 기본 프롬프트로 실행합니다.");
      return { prompt: mergedPrompt, trace: [], memoryTrace };
    }

    const contextLines = result.snippets.map(
      (snippet) => `- [source: ${snippet.fileName}#${snippet.chunkIndex}] ${snippet.text}`,
    );
    const promptWithAttachments = `[첨부 참고자료]
${contextLines.join("\n")}
[/첨부 참고자료]

[요청]
${mergedPrompt}`.trim();

    params.addNodeLog(params.node.id, `[첨부] ${result.snippets.length}개 문단 반영`);

    const trace = result.snippets.map((snippet) => ({
      nodeId: params.node.id,
      fileId: snippet.fileId,
      fileName: snippet.fileName,
      chunkIndex: snippet.chunkIndex,
      score: snippet.score,
    }));

    return { prompt: promptWithAttachments, trace, memoryTrace };
  } catch (error) {
    params.addNodeLog(params.node.id, `[첨부] 검색 실패: ${String(error)}`);
    return { prompt: mergedPrompt, trace: [], memoryTrace };
  }
}

type TurnExecutionResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
  threadId?: string;
  turnId?: string;
  usage?: UsageStats;
  executor: TurnExecutor;
  provider: string;
  knowledgeTrace?: KnowledgeTraceEntry[];
  memoryTrace?: InternalMemoryTraceEntry[];
};

export async function executeTurnNodeWithOutputSchemaRetry(params: {
  node: GraphNode;
  input: unknown;
  executeTurnNode: (node: GraphNode, input: unknown) => Promise<TurnExecutionResult>;
  addNodeLog: (nodeId: string, message: string) => void;
  validateSimpleSchema: (schema: unknown, data: unknown) => string[];
  outputSchemaEnabled: boolean;
  maxRetryDefault: number;
  options?: { maxRetry?: number };
}): Promise<{
  result: TurnExecutionResult;
  normalizedOutput?: unknown;
  artifactWarnings: string[];
}> {
  const config = params.node.config as TurnConfig;
  const executor = getTurnExecutor(config);
  const provider = resolveProviderByExecutor(executor);
  const artifactType = toArtifactType(config.artifactType);
  const warnings: string[] = [];
  const schemaRaw = params.outputSchemaEnabled ? String(config.outputSchemaJson ?? "").trim() : "";

  let parsedSchema: unknown | null = null;
  if (schemaRaw) {
    try {
      parsedSchema = JSON.parse(schemaRaw);
    } catch (error) {
      return {
        result: {
          ok: false,
          error: `출력 스키마 JSON 형식 오류: ${String(error)}`,
          executor,
          provider,
        },
        artifactWarnings: warnings,
      };
    }
  }

  let result = await params.executeTurnNode(params.node, params.input);
  if (!result.ok) {
    return { result, artifactWarnings: warnings };
  }

  let normalized = normalizeArtifactOutput(params.node.id, artifactType, result.output);
  warnings.push(...normalized.warnings);
  let normalizedOutput = normalized.output;
  if (!parsedSchema) {
    return { result, normalizedOutput, artifactWarnings: warnings };
  }

  let schemaErrors = params.validateSimpleSchema(parsedSchema, extractSchemaValidationTarget(normalizedOutput));
  if (schemaErrors.length === 0) {
    return { result, normalizedOutput, artifactWarnings: warnings };
  }

  const maxRetry = Math.max(0, params.options?.maxRetry ?? params.maxRetryDefault);
  params.addNodeLog(params.node.id, `[스키마] 검증 실패: ${schemaErrors.join("; ")}`);
  if (maxRetry > 0) {
    params.addNodeLog(params.node.id, `[스키마] 재질문 ${maxRetry}회 제한 내에서 재시도합니다.`);
  } else {
    params.addNodeLog(params.node.id, "[스키마] 자동 재질문이 비활성화되어 즉시 실패 처리합니다.");
  }

  let attempts = 0;
  let accumulatedUsage = result.usage;

  while (attempts < maxRetry && schemaErrors.length > 0) {
    attempts += 1;
    const retryInput = buildSchemaRetryInput(params.input, normalizedOutput, parsedSchema, schemaErrors);
    const retryResult = await params.executeTurnNode(params.node, retryInput);
    accumulatedUsage = mergeUsageStats(accumulatedUsage, retryResult.usage);
    result = {
      ...retryResult,
      usage: accumulatedUsage,
    };
    if (!result.ok) {
      return {
        result: {
          ...result,
          error: `출력 스키마 재질문 실패: ${result.error ?? "턴 실행 실패"}`,
        },
        normalizedOutput,
        artifactWarnings: warnings,
      };
    }

    normalized = normalizeArtifactOutput(params.node.id, artifactType, result.output);
    warnings.push(...normalized.warnings);
    normalizedOutput = normalized.output;
    schemaErrors = params.validateSimpleSchema(parsedSchema, extractSchemaValidationTarget(normalizedOutput));
  }

  if (schemaErrors.length > 0) {
    return {
      result: {
        ...result,
        ok: false,
        output: normalizedOutput,
        error: `출력 스키마 검증 실패: ${schemaErrors.join("; ")}`,
        usage: accumulatedUsage,
      },
      normalizedOutput,
      artifactWarnings: warnings,
    };
  }

  params.addNodeLog(params.node.id, "[스키마] 출력 스키마 검증 PASS");
  return {
    result: {
      ...result,
      output: normalizedOutput,
      usage: accumulatedUsage,
    },
    normalizedOutput,
    artifactWarnings: warnings,
  };
}
