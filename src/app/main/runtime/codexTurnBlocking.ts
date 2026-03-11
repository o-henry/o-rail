import type { MutableRefObject } from "react";
import { extractStringByPaths } from "../../../shared/lib/valueUtils";
import type { TurnReasoningEffort } from "../../../features/workflow/reasoningLevels";
import type { GraphNode } from "../../../features/workflow/types";
import { extractCompletedStatus, extractDeltaText, extractUsageStats } from "../../mainAppUtils";
import type { InternalMemoryTraceEntry, KnowledgeTraceEntry, ThreadStartResult, UsageStats } from "../types";
import { buildTurnStartArgs, type TurnRuntimeConfig } from "./turnRuntimeConfig";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type RunCodexTurnBlockingParams = {
  node: GraphNode;
  nodeCwd: string;
  nodeModelEngine: string;
  nodeReasoningEffort: TurnReasoningEffort;
  textToSend: string;
  turnRuntimeConfig: TurnRuntimeConfig;
  nodeStates: Record<string, { threadId?: string } | undefined>;
  pauseRequestedRef: MutableRefObject<boolean>;
  cancelRequestedRef: MutableRefObject<boolean>;
  pauseErrorToken: string;
  activeTurnNodeIdRef: MutableRefObject<string>;
  activeTurnThreadByNodeIdRef: MutableRefObject<Record<string, string>>;
  setNodeRuntimeFields: (nodeId: string, fields: Record<string, unknown>) => void;
  invokeFn: InvokeFn;
  t: (key: string) => string;
  knowledgeTrace: KnowledgeTraceEntry[];
  memoryTrace: InternalMemoryTraceEntry[];
};

type RunCodexTurnBlockingResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
  threadId?: string;
  turnId?: string;
  usage?: UsageStats;
  executor: "codex";
  provider: "codex";
  knowledgeTrace?: KnowledgeTraceEntry[];
  memoryTrace?: InternalMemoryTraceEntry[];
};

export async function runCodexTurnBlocking(
  params: RunCodexTurnBlockingParams,
): Promise<RunCodexTurnBlockingResult> {
  let activeThreadId = extractStringByPaths(params.nodeStates[params.node.id], ["threadId"]);
  if (!activeThreadId) {
    const threadStart = await params.invokeFn<ThreadStartResult>("thread_start", {
      model: params.nodeModelEngine,
      cwd: params.nodeCwd,
    });
    activeThreadId = threadStart.threadId;
  }
  if (!activeThreadId) {
    return {
      ok: false,
      error: "threadId를 가져오지 못했습니다.",
      executor: "codex",
      provider: "codex",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }

  params.setNodeRuntimeFields(params.node.id, { threadId: activeThreadId });
  params.activeTurnNodeIdRef.current = params.node.id;
  params.activeTurnThreadByNodeIdRef.current = {
    ...params.activeTurnThreadByNodeIdRef.current,
    [params.node.id]: activeThreadId,
  };

  let turnStartResponse: unknown;
  try {
    turnStartResponse = await params.invokeFn<unknown>("turn_start_blocking", buildTurnStartArgs({
      threadId: activeThreadId,
      text: params.textToSend,
      reasoningEffort: params.nodeReasoningEffort,
      config: params.turnRuntimeConfig,
    }));
  } catch (error) {
    delete params.activeTurnThreadByNodeIdRef.current[params.node.id];
    params.activeTurnNodeIdRef.current = "";
    if (params.pauseRequestedRef.current) {
      return {
        ok: false,
        error: params.pauseErrorToken,
        threadId: activeThreadId,
        executor: "codex",
        provider: "codex",
        knowledgeTrace: params.knowledgeTrace,
        memoryTrace: params.memoryTrace,
      };
    }
    if (params.cancelRequestedRef.current) {
      return {
        ok: false,
        error: params.t("run.cancelledByUserShort"),
        threadId: activeThreadId,
        executor: "codex",
        provider: "codex",
        knowledgeTrace: params.knowledgeTrace,
        memoryTrace: params.memoryTrace,
      };
    }
    return {
      ok: false,
      error: String(error),
      threadId: activeThreadId,
      executor: "codex",
      provider: "codex",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }

  delete params.activeTurnThreadByNodeIdRef.current[params.node.id];
  params.activeTurnNodeIdRef.current = "";
  const turnId =
    extractStringByPaths(turnStartResponse, ["turnId", "turn_id", "id", "turn.id"]) ??
    extractStringByPaths(turnStartResponse, ["response.turnId", "response.turn_id", "response.id"]);
  const usage = extractUsageStats(turnStartResponse);
  const completedStatus = (extractCompletedStatus(turnStartResponse) ?? "").toLowerCase();
  if (params.pauseRequestedRef.current) {
    return {
      ok: false,
      error: params.pauseErrorToken,
      threadId: activeThreadId,
      turnId: turnId ?? undefined,
      usage,
      executor: "codex",
      provider: "codex",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }
  if (params.cancelRequestedRef.current) {
    return {
      ok: false,
      error: params.t("run.cancelledByUserShort"),
      threadId: activeThreadId,
      turnId: turnId ?? undefined,
      usage,
      executor: "codex",
      provider: "codex",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }
  if (["failed", "error", "cancelled", "rejected"].includes(completedStatus)) {
    return {
      ok: false,
      error: `턴 실행 실패 (${completedStatus || "failed"})`,
      threadId: activeThreadId,
      turnId: turnId ?? undefined,
      usage,
      executor: "codex",
      provider: "codex",
      knowledgeTrace: params.knowledgeTrace,
      memoryTrace: params.memoryTrace,
    };
  }

  const completionText =
    extractStringByPaths(turnStartResponse, [
      "text",
      "output_text",
      "turn.output_text",
      "turn.response.output_text",
      "turn.response.text",
      "response.output_text",
      "response.text",
    ]) ?? extractDeltaText(turnStartResponse);

  return {
    ok: true,
    output: { text: completionText.trim() ? completionText : "", completion: turnStartResponse },
    threadId: activeThreadId,
    turnId: turnId ?? undefined,
    usage,
    executor: "codex",
    provider: "codex",
    knowledgeTrace: params.knowledgeTrace,
    memoryTrace: params.memoryTrace,
  };
}
