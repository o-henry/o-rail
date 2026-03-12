import type { MutableRefObject } from "react";
import { extractStringByPaths } from "../../../shared/lib/valueUtils";
import {
  buildCodexMultiAgentDirective,
  buildDocumentCompletenessDirective,
  buildExpertOrchestrationDirective,
  buildFinalVisualizationDirective,
  buildForcedAgentRuleBlock,
  buildMultiPerspectiveReviewDirective,
  buildOutputSchemaDirective,
  buildReadableDocumentDirective,
  extractFinalSynthesisInputText,
  extractPromptInputText,
  injectOutputLanguageDirective,
  isLikelyWebPromptEcho,
  replaceInputPlaceholder,
  stringifyInput,
} from "../../../features/workflow/promptUtils";
import { codexMultiAgentModeLabel, resolveNodeCwd } from "../../mainAppUtils";
import {
  getTurnExecutor,
  getWebProviderFromExecutor,
  inferQualityProfile,
  normalizeWebResultMode,
  toTurnModelDisplayName,
  toTurnModelEngineId,
  webProviderHomeUrl,
  webProviderLabel,
  type TurnConfig,
  type TurnExecutor,
  type WebProvider,
} from "../../../features/workflow/domain";
import { DEFAULT_TURN_REASONING_LEVEL, toTurnReasoningEffort } from "../../../features/workflow/reasoningLevels";
import {
  applyTurnInputBudget, resolveTurnRuntimeConfig,
} from "./turnRuntimeConfig";
import { normalizeWebEvidenceOutput } from "../../mainAppRuntimeHelpers";
import { runViaFlowTurn } from "./viaTurnRunHandler";
import { applyUnityAutomationPromptContext } from "./unityAutomationPromptApply";
import type { InternalMemoryTraceEntry, KnowledgeTraceEntry, UsageStats, WebProviderRunResult } from "../types";
import type { GraphNode } from "../../../features/workflow/types";
import type { TurnTerminal } from "../../mainAppGraphHelpers";
import { runCodexTurnBlocking } from "./codexTurnBlocking";
import { isStructuredNodeInputPacket } from "./nodeInputPackets";
export type ExecuteTurnNodeResult = {
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
type LoadAgentRuleDocsFn = (nodeCwd: string) => Promise<Array<{ path: string; content: string }>>;
type InjectKnowledgeContextFn = (params: { node: GraphNode; prompt: string; config: TurnConfig }) => Promise<{
  prompt: string; trace: KnowledgeTraceEntry[]; memoryTrace: InternalMemoryTraceEntry[];
}>;
type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type RequestWebTurnResponseFn = (nodeId: string, provider: WebProvider, prompt: string, mode: "auto" | "bridgeAssisted" | "manualPasteText" | "manualPasteJson") => Promise<{ ok: boolean; output?: unknown; error?: string }>;
export type ExecuteTurnNodeContext = {
  model: string;
  cwd: string;
  locale: "ko" | "en" | "jp" | "zh";
  workflowQuestion: string;
  codexMultiAgentMode: "off" | "balanced" | "max";
  forceAgentRulesAllTurns: boolean;
  turnOutputSchemaEnabled: boolean;
  pauseErrorToken: string;
  nodeStates: Record<string, { threadId?: string } | undefined>;
  activeRunPresetKindRef: MutableRefObject<any>;
  internalMemoryCorpusRef: MutableRefObject<any[]>;
  activeWebNodeByProviderRef: MutableRefObject<Partial<Record<WebProvider, string>>>;
  activeWebPromptRef: MutableRefObject<Partial<Record<WebProvider, string>>>;
  activeWebProviderByNodeRef: MutableRefObject<Record<string, WebProvider | undefined>>;
  activeWebPromptByNodeRef: MutableRefObject<Record<string, string | undefined>>;
  manualWebFallbackNodeRef: MutableRefObject<Record<string, boolean | undefined>>;
  pauseRequestedRef: MutableRefObject<boolean>;
  cancelRequestedRef: MutableRefObject<boolean>;
  activeTurnNodeIdRef: MutableRefObject<string>;
  activeTurnThreadByNodeIdRef: MutableRefObject<Record<string, string>>;
  activeRunDeltaRef: MutableRefObject<Record<string, string>>;
  turnTerminalResolverRef: MutableRefObject<((value: TurnTerminal) => void) | null>;
  consumeNodeRequests: (nodeId: string) => string[];
  addNodeLog: (nodeId: string, message: string) => void;
  setStatus: (status: string) => void;
  setNodeStatus: (nodeId: string, status: any, message?: string) => void;
  setNodeRuntimeFields: (nodeId: string, fields: Record<string, unknown>) => void;
  requestWebTurnResponse: RequestWebTurnResponseFn;
  ensureWebWorkerReady: () => Promise<boolean>;
  clearWebBridgeStageWarnTimer: (provider: WebProvider) => void;
  loadAgentRuleDocs: LoadAgentRuleDocsFn;
  injectKnowledgeContext: InjectKnowledgeContextFn;
  invokeFn: InvokeFn;
  openUrlFn: (url: string) => Promise<void>;
  t: (key: string) => string;
};
export async function executeTurnNodeWithContext(
  node: GraphNode,
  input: unknown,
  ctx: ExecuteTurnNodeContext,
): Promise<ExecuteTurnNodeResult> {
  const config = node.config as TurnConfig;
  const executor = getTurnExecutor(config);
  const nodeModel = toTurnModelDisplayName(String(config.model ?? ctx.model).trim() || ctx.model);
  const nodeModelEngine = toTurnModelEngineId(nodeModel);
  const nodeReasoningEffort = toTurnReasoningEffort(config.reasoningLevel ?? DEFAULT_TURN_REASONING_LEVEL);
  const turnRuntimeConfig = resolveTurnRuntimeConfig(config);
  const nodeCwd = resolveNodeCwd(config.cwd ?? ctx.cwd, ctx.cwd);
  const promptTemplate = injectOutputLanguageDirective(String(config.promptTemplate ?? "{{input}}"), ctx.locale);
  const nodeOllamaModel = String(config.ollamaModel ?? "llama3.1:8b").trim() || "llama3.1:8b";
  const qualityProfile = inferQualityProfile(node, config);
  const rawInputText = qualityProfile === "synthesis_final" ? extractFinalSynthesisInputText(input) : extractPromptInputText(input);
  const { text: inputText, clipped: inputTextClipped } = applyTurnInputBudget(rawInputText, turnRuntimeConfig);
  const queuedRequests = ctx.consumeNodeRequests(node.id);
  const queuedRequestBlock =
    queuedRequests.length > 0
      ? `\n\n[사용자 추가 요청]\n${queuedRequests.map((line, index) => `${index + 1}. ${line}`).join("\n")}`
      : "";
  if (queuedRequests.length > 0) {
    ctx.addNodeLog(node.id, `[요청 반영] ${queuedRequests.length}개 추가 요청을 이번 실행에 반영했습니다.`);
  }
  if (inputTextClipped) {
    ctx.addNodeLog(node.id, `[컨텍스트] 입력을 ${turnRuntimeConfig.maxInputChars}자로 제한했습니다. (budget=${turnRuntimeConfig.contextBudget})`);
  }
  const basePrompt = promptTemplate.includes("{{input}}")
    ? replaceInputPlaceholder(promptTemplate, inputText)
    : `${promptTemplate}${inputText ? `\n${inputText}` : ""}`;
  const promptWithRequests = `${basePrompt}${queuedRequestBlock}`.trim();
  const agentRuleDocs = await ctx.loadAgentRuleDocs(nodeCwd);
  const shouldForceAgentRules = ctx.forceAgentRulesAllTurns || inferQualityProfile(node, config) === "code_implementation";
  if (agentRuleDocs.length > 0 && shouldForceAgentRules) {
    ctx.addNodeLog(node.id, `[규칙] agent/skill 문서 ${agentRuleDocs.length}개 강제 적용`);
  }
  const forcedRuleBlock = shouldForceAgentRules ? buildForcedAgentRuleBlock(agentRuleDocs) : "";
  const withKnowledge = await ctx.injectKnowledgeContext({
    node,
    prompt: promptWithRequests,
    config,
  });
  let textToSend = forcedRuleBlock ? `${forcedRuleBlock}\n\n${withKnowledge.prompt}`.trim() : withKnowledge.prompt;
  const knowledgeTrace = withKnowledge.trace;
  const memoryTrace = withKnowledge.memoryTrace;
  const orchestrationDirective = buildExpertOrchestrationDirective(ctx.locale, qualityProfile);
  if (orchestrationDirective) {
    textToSend = `${orchestrationDirective}\n\n${textToSend}`.trim();
    ctx.addNodeLog(node.id, "[오케스트레이션] 전문가 실행 계약 지침 자동 적용");
  }
  const outputSchemaRaw = String(config.outputSchemaJson ?? "").trim();
  const hasStrictOutputSchema = ctx.turnOutputSchemaEnabled && outputSchemaRaw.length > 0;
  const multiPerspectiveDirective =
    isStructuredNodeInputPacket(input) && input.parentOutputs.length > 1 && qualityProfile !== "code_implementation"
      ? buildMultiPerspectiveReviewDirective(ctx.locale)
      : "";
  if (multiPerspectiveDirective) {
    textToSend = `${multiPerspectiveDirective}\n\n${textToSend}`.trim();
    ctx.addNodeLog(node.id, "[검토] 다관점 전문 검토 계약 자동 적용");
  }
  const readableDocumentDirective = qualityProfile === "synthesis_final" && !hasStrictOutputSchema ? buildReadableDocumentDirective(ctx.locale) : "";
  if (readableDocumentDirective) {
    textToSend = `${textToSend}\n\n${readableDocumentDirective}`.trim();
    ctx.addNodeLog(node.id, "[포맷] 최종 문서 가독성 포맷 지침 자동 적용");
  }
  const documentCompletenessDirective =
    (qualityProfile === "synthesis_final" || String(config.artifactType ?? "") !== "none") && !hasStrictOutputSchema
      ? buildDocumentCompletenessDirective(ctx.locale)
      : "";
  if (documentCompletenessDirective) {
    textToSend = `${textToSend}\n\n${documentCompletenessDirective}`.trim();
    ctx.addNodeLog(node.id, "[완전성] 문서 비절단/비추측 계약 자동 적용");
  }
  const visualizationDirective = qualityProfile === "synthesis_final" ? buildFinalVisualizationDirective() : "";
  if (visualizationDirective) {
    textToSend = `${textToSend}\n\n${visualizationDirective}`.trim();
    ctx.addNodeLog(node.id, "[시각화] 품질 프로필(최종 종합) 기반 시각화 지침 자동 적용");
  }
  const outputSchemaDirective = ctx.turnOutputSchemaEnabled ? buildOutputSchemaDirective(outputSchemaRaw) : "";
  if (outputSchemaDirective) {
    textToSend = `${textToSend}\n\n${outputSchemaDirective}`.trim();
    ctx.addNodeLog(node.id, "[스키마] 출력 스키마 지시를 프롬프트에 자동 주입했습니다.");
  }
  textToSend = await applyUnityAutomationPromptContext({
    presetKind: ctx.activeRunPresetKindRef.current,
    cwd: nodeCwd,
    text: textToSend,
    invokeFn: ctx.invokeFn,
    addNodeLog: (message) => ctx.addNodeLog(node.id, message),
  });
  if (executor === "codex" && qualityProfile === "synthesis_final") {
    const multiAgentDirective = buildCodexMultiAgentDirective(ctx.codexMultiAgentMode);
    if (multiAgentDirective) {
      textToSend = `${multiAgentDirective}\n\n${textToSend}`.trim();
      ctx.addNodeLog(node.id, `[멀티에이전트] Codex 최적화 모드 적용: ${codexMultiAgentModeLabel(ctx.codexMultiAgentMode)}`);
    }
  }
  if (executor === "ollama") {
    try {
      const raw = await ctx.invokeFn<unknown>("ollama_generate", {
        model: nodeOllamaModel,
        prompt: textToSend,
      });
      const text = extractStringByPaths(raw, ["response", "message.content", "content"]) ?? stringifyInput(raw);
      return {
        ok: true,
        output: { provider: "ollama", timestamp: new Date().toISOString(), text, raw },
        executor,
        provider: "ollama",
        knowledgeTrace,
        memoryTrace,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Ollama 실행 실패: ${String(error)}`,
        executor,
        provider: "ollama",
        knowledgeTrace,
        memoryTrace,
      };
    }
  }
  if (executor === "via_flow") {
    return runViaFlowTurn({
      node,
      config,
      cwd: nodeCwd,
      invokeFn: ctx.invokeFn,
      pauseRequestedRef: ctx.pauseRequestedRef,
      cancelRequestedRef: ctx.cancelRequestedRef,
      pauseErrorToken: ctx.pauseErrorToken,
      addNodeLog: ctx.addNodeLog,
      t: ctx.t,
      executor,
      knowledgeTrace,
      memoryTrace,
    });
  }
  const webProvider = getWebProviderFromExecutor(executor);
  if (webProvider) {
    const webResultMode = normalizeWebResultMode(config.webResultMode);
    const webTimeoutMs = Math.max(5_000, Number(config.webTimeoutMs ?? 180_000) || 180_000);
    if (webResultMode === "bridgeAssisted") {
      ctx.activeWebNodeByProviderRef.current[webProvider] = node.id;
      ctx.activeWebPromptRef.current[webProvider] = textToSend;
      ctx.activeWebProviderByNodeRef.current[node.id] = webProvider;
      ctx.activeWebPromptByNodeRef.current[node.id] = textToSend;
      ctx.addNodeLog(node.id, `[WEB] ${webProviderLabel(webProvider)} 웹 연결 반자동 시작`);
      ctx.addNodeLog(node.id, "[WEB] 프롬프트 자동 주입/전송을 시도합니다. 자동 전송 실패 시 웹 탭에서 전송 1회가 필요합니다.");
      ctx.setStatus(`${webProviderLabel(webProvider)} 웹 연결 대기 중 - 자동 주입/전송 준비`);
      const requestManualFallback = async (reasonLine: string): Promise<ExecuteTurnNodeResult> => {
        ctx.addNodeLog(node.id, reasonLine);
        ctx.addNodeLog(node.id, "[WEB] 수동 입력 모달로 전환합니다.");
        ctx.setNodeStatus(node.id, "waiting_user", `${webProvider} 응답 입력 대기`);
        ctx.setNodeRuntimeFields(node.id, { status: "waiting_user" });
        const fallback = await ctx.requestWebTurnResponse(node.id, webProvider, textToSend, "manualPasteText");
        const normalizedFallback =
          fallback.ok && fallback.output !== undefined
            ? {
                ...fallback,
                output: normalizeWebEvidenceOutput(webProvider, fallback.output, "manualPasteText"),
              }
            : fallback;
        return {
          ...normalizedFallback,
          executor,
          provider: webProvider,
          knowledgeTrace,
          memoryTrace,
        };
      };
      try {
        await ctx.openUrlFn(webProviderHomeUrl(webProvider));
        ctx.addNodeLog(node.id, `[WEB] ${webProviderLabel(webProvider)} 웹 탭을 자동으로 열었습니다.`);
      } catch (error) {
        ctx.addNodeLog(node.id, `[WEB] 웹 탭 자동 열기 실패: ${String(error)}`);
      }
      const workerReady = await ctx.ensureWebWorkerReady();
      if (!workerReady) {
        ctx.clearWebBridgeStageWarnTimer(webProvider);
        if (ctx.activeWebNodeByProviderRef.current[webProvider] === node.id) {
          delete ctx.activeWebNodeByProviderRef.current[webProvider];
        }
        delete ctx.activeWebProviderByNodeRef.current[node.id];
        if (ctx.activeWebPromptRef.current[webProvider] === textToSend) {
          delete ctx.activeWebPromptRef.current[webProvider];
        }
        delete ctx.activeWebPromptByNodeRef.current[node.id];
        return requestManualFallback("[WEB] 웹 연결 워커 준비 실패, 수동 입력으로 전환");
      }
      const runBridgeAssisted = async (timeoutMs = webTimeoutMs) =>
        ctx.invokeFn<WebProviderRunResult>("web_provider_run", {
          provider: webProvider,
          prompt: textToSend,
          timeoutMs,
          mode: "bridgeAssisted",
        });
      let result: WebProviderRunResult | null = null;
      try {
        const runPromise = runBridgeAssisted().then(
          (value) => ({ state: "resolved" as const, value }),
          (error) => ({ state: "rejected" as const, error }),
        );
        let settled: Awaited<typeof runPromise> | null = null;
        while (!settled) {
          if (ctx.pauseRequestedRef.current) {
            ctx.addNodeLog(node.id, "[WEB] 일시정지 요청 감지 - 자동 수집 취소 요청");
            try {
              await ctx.invokeFn("web_provider_cancel", { provider: webProvider });
            } catch (cancelError) {
              ctx.addNodeLog(node.id, `[WEB] 자동 수집 취소 요청 실패: ${String(cancelError)}`);
            }
            await runPromise;
            return { ok: false, error: ctx.pauseErrorToken, executor, provider: webProvider, knowledgeTrace, memoryTrace };
          }
          if (ctx.manualWebFallbackNodeRef.current[node.id]) {
            ctx.addNodeLog(node.id, "[WEB] 수동 입력 전환 요청 감지 - 자동 수집 취소 요청");
            try {
              await ctx.invokeFn("web_provider_cancel", { provider: webProvider });
            } catch (cancelError) {
              ctx.addNodeLog(node.id, `[WEB] 자동 수집 취소 요청 실패: ${String(cancelError)}`);
            }
            const cancelSettled = await Promise.race([
              runPromise,
              new Promise<null>((resolve) => {
                window.setTimeout(() => resolve(null), 1200);
              }),
            ]);
            if (!cancelSettled) {
              ctx.addNodeLog(node.id, "[WEB] 자동 수집 취소 확인이 지연되어 즉시 수동 입력 모달로 전환합니다.");
            }
            delete ctx.manualWebFallbackNodeRef.current[node.id];
            return requestManualFallback("[WEB] 사용자 요청으로 자동 수집을 중단하고 수동 입력으로 전환합니다.");
          }
          const polled = await Promise.race([
            runPromise,
            new Promise<null>((resolve) => {
              window.setTimeout(() => resolve(null), 200);
            }),
          ]);
          if (polled) {
            settled = polled;
          }
        }
        if (settled.state === "rejected") {
          throw settled.error;
        }
        result = settled.value;
        if (result.ok && result.text && isLikelyWebPromptEcho(result.text, textToSend)) {
          ctx.addNodeLog(node.id, `[WEB] 입력 에코로 보이는 응답을 감지해 폐기했습니다. (${webProviderLabel(webProvider)})`);
          result = { ok: false, errorCode: "PROMPT_ECHO", error: "웹 응답이 입력 에코로 감지되어 폐기되었습니다." } as WebProviderRunResult;
        }
        if (result.ok && result.text) {
          ctx.addNodeLog(node.id, `[WEB] ${webProviderLabel(webProvider)} 웹 연결 응답 수집 완료`);
          return {
            ok: true,
            output: normalizeWebEvidenceOutput(
              webProvider,
              { provider: webProvider, timestamp: new Date().toISOString(), text: result.text, raw: result.raw, meta: result.meta },
              "bridgeAssisted",
            ),
            executor,
            provider: webProvider,
            knowledgeTrace,
            memoryTrace,
          };
        }
        if (ctx.cancelRequestedRef.current || ctx.pauseRequestedRef.current || result?.errorCode === "CANCELLED") {
          if (ctx.manualWebFallbackNodeRef.current[node.id]) {
            delete ctx.manualWebFallbackNodeRef.current[node.id];
            return requestManualFallback("[WEB] 사용자 요청으로 자동 수집을 중단하고 수동 입력으로 전환합니다.");
          }
          if (ctx.pauseRequestedRef.current) {
            return { ok: false, error: ctx.pauseErrorToken, executor, provider: webProvider, knowledgeTrace, memoryTrace };
          }
          return { ok: false, error: ctx.t("run.cancelledByUserShort"), executor, provider: webProvider, knowledgeTrace, memoryTrace };
        }
        return requestManualFallback(`[WEB] 웹 연결 수집 실패 (${result?.errorCode ?? "UNKNOWN"}): ${result?.error ?? "unknown error"}`);
      } catch (error) {
        if (ctx.cancelRequestedRef.current || ctx.pauseRequestedRef.current) {
          if (ctx.manualWebFallbackNodeRef.current[node.id]) {
            delete ctx.manualWebFallbackNodeRef.current[node.id];
            return requestManualFallback("[WEB] 사용자 요청으로 자동 수집을 중단하고 수동 입력으로 전환합니다.");
          }
          if (ctx.pauseRequestedRef.current) {
            return { ok: false, error: ctx.pauseErrorToken, executor, provider: webProvider, knowledgeTrace, memoryTrace };
          }
          return { ok: false, error: ctx.t("run.cancelledByUserShort"), executor, provider: webProvider, knowledgeTrace, memoryTrace };
        }
        return requestManualFallback(`[WEB] 웹 연결 예외: ${String(error)}`);
      } finally {
        ctx.clearWebBridgeStageWarnTimer(webProvider);
        if (ctx.activeWebNodeByProviderRef.current[webProvider] === node.id) {
          delete ctx.activeWebNodeByProviderRef.current[webProvider];
        }
        delete ctx.activeWebProviderByNodeRef.current[node.id];
        if (ctx.activeWebPromptRef.current[webProvider] === textToSend) {
          delete ctx.activeWebPromptRef.current[webProvider];
        }
        delete ctx.activeWebPromptByNodeRef.current[node.id];
        delete ctx.manualWebFallbackNodeRef.current[node.id];
      }
    }
    try {
      await ctx.openUrlFn(webProviderHomeUrl(webProvider));
    } catch (error) {
      return {
        ok: false,
        error: `웹 서비스 브라우저 열기 실패(${webProvider}): ${String(error)}`,
        executor,
        provider: webProvider,
        knowledgeTrace,
        memoryTrace,
      };
    }
    ctx.setNodeStatus(node.id, "waiting_user", `${webProvider} 응답 입력 대기`);
    ctx.setNodeRuntimeFields(node.id, { status: "waiting_user" });
    return ctx.requestWebTurnResponse(node.id, webProvider, textToSend, webResultMode).then((result) => ({
      ...result,
      executor,
      provider: webProvider,
      knowledgeTrace,
      memoryTrace,
    }));
  }
  return runCodexTurnBlocking({
    node,
    nodeCwd,
    nodeModelEngine,
    nodeReasoningEffort,
    textToSend,
    turnRuntimeConfig,
    nodeStates: ctx.nodeStates,
    pauseRequestedRef: ctx.pauseRequestedRef,
    cancelRequestedRef: ctx.cancelRequestedRef,
    pauseErrorToken: ctx.pauseErrorToken,
    activeTurnNodeIdRef: ctx.activeTurnNodeIdRef,
    activeTurnThreadByNodeIdRef: ctx.activeTurnThreadByNodeIdRef,
    setNodeRuntimeFields: ctx.setNodeRuntimeFields,
    invokeFn: ctx.invokeFn,
    t: ctx.t,
    knowledgeTrace,
    memoryTrace,
  });
}
