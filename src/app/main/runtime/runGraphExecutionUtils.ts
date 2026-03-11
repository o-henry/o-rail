import { buildConflictLedger, buildFinalSynthesisPacket } from "../../mainAppRuntimeHelpers";
import { getWebProviderFromExecutor, getTurnExecutor, type TurnConfig, type WebProvider } from "../../../features/workflow/domain";
import type { GraphEdge, GraphNode, NodeAnchorSide, NodeExecutionStatus } from "../../../features/workflow/types";
import type {
  EvidenceEnvelope,
  FinalSynthesisPacket,
  NodeResponsibilityMemory,
  RunRecord,
} from "../types";
export const PAUSE_ERROR_TOKEN = "__PAUSED_BY_USER__";

export function buildNodeInputForNode(params: {
  edges: GraphEdge[];
  nodeId: string;
  outputs: Record<string, unknown>;
  rootInput: string;
}): unknown {
  const incoming = params.edges.filter((edge) => edge.to.nodeId === params.nodeId);
  if (incoming.length === 0) {
    return params.rootInput;
  }
  if (incoming.length === 1) {
    return params.outputs[incoming[0].from.nodeId] ?? null;
  }

  const merged: Record<string, unknown> = {};
  for (const edge of incoming) {
    merged[edge.from.nodeId] = params.outputs[edge.from.nodeId];
  }
  return merged;
}

export function buildFinalTurnInputPacket(params: {
  edges: GraphEdge[];
  nodeId: string;
  currentInput: unknown;
  outputs: Record<string, unknown>;
  rootInput: string;
  normalizedEvidenceByNodeId: Record<string, EvidenceEnvelope[]>;
  runMemory: Record<string, NodeResponsibilityMemory>;
}): FinalSynthesisPacket | unknown {
  const incomingEdges = params.edges.filter((edge) => edge.to.nodeId === params.nodeId);
  if (incomingEdges.length === 0) {
    return params.currentInput;
  }
  const upstream: Record<string, unknown> = {};
  const packets: EvidenceEnvelope[] = [];
  for (const edge of incomingEdges) {
    const sourceNodeId = edge.from.nodeId;
    if (!(sourceNodeId in params.outputs)) {
      continue;
    }
    upstream[sourceNodeId] = params.outputs[sourceNodeId];
    const sourcePackets = params.normalizedEvidenceByNodeId[sourceNodeId] ?? [];
    if (sourcePackets.length > 0) {
      packets.push(sourcePackets[sourcePackets.length - 1]);
    }
  }

  if (Object.keys(upstream).length === 0) {
    return params.currentInput;
  }
  const unresolvedConflicts = buildConflictLedger(packets);
  return buildFinalSynthesisPacket({
    question: params.rootInput,
    evidencePackets: packets,
    conflicts: unresolvedConflicts,
    runMemory: params.runMemory,
  });
}

export function appendRunTransition(
  runRecord: RunRecord,
  nodeId: string,
  state: NodeExecutionStatus,
  message?: string,
) {
  runRecord.transitions.push({
    at: new Date().toISOString(),
    nodeId,
    status: state,
    message,
  });
  if (message) {
    runRecord.summaryLogs.push(`[${nodeId}] ${state}: ${message}`);
  } else {
    runRecord.summaryLogs.push(`[${nodeId}] ${state}`);
  }
}

export function collectRequiredWebProviders(nodes: GraphNode[]): WebProvider[] {
  const providers = new Set<WebProvider>();
  for (const node of nodes) {
    if (node.type !== "turn") {
      continue;
    }
    const executor = getTurnExecutor(node.config as TurnConfig);
    const provider = getWebProviderFromExecutor(executor);
    if (provider) {
      providers.add(provider);
    }
  }
  return Array.from(providers);
}

export function isPauseSignalError(input: unknown): boolean {
  const text = String(input ?? "").toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes(PAUSE_ERROR_TOKEN.toLowerCase()) ||
    text.includes("cancelled") ||
    text.includes("취소") ||
    text.includes("interrupt")
  );
}

export function buildConnectPreviewLine(params: {
  connectFromNodeId: string;
  connectPreviewPoint: { x: number; y: number } | null;
  connectPreviewStartPoint: { x: number; y: number } | null;
  connectFromSide: NodeAnchorSide | null;
  canvasNodeMap: Map<string, GraphNode>;
  getNodeVisualSize: (nodeId: string) => { width: number; height: number };
  getNodeAnchorPointFn: (
    node: GraphNode,
    side: NodeAnchorSide,
    size: { width: number; height: number },
  ) => { x: number; y: number } | null;
  buildRoundedEdgePathFn: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    readOnly: boolean,
    fromSide: NodeAnchorSide,
    toSide: NodeAnchorSide,
  ) => string;
}): string | null {
  if (!params.connectFromNodeId || !params.connectPreviewPoint) {
    return null;
  }
  const startPoint = (() => {
    if (params.connectPreviewStartPoint) {
      return params.connectPreviewStartPoint;
    }
    const fromNode = params.canvasNodeMap.get(params.connectFromNodeId);
    if (!fromNode) {
      return null;
    }
    return params.getNodeAnchorPointFn(
      fromNode,
      params.connectFromSide ?? "right",
      params.getNodeVisualSize(fromNode.id),
    );
  })();
  if (!startPoint) {
    return null;
  }
  const dx = params.connectPreviewPoint.x - startPoint.x;
  const dy = params.connectPreviewPoint.y - startPoint.y;
  const guessedToSide: NodeAnchorSide =
    Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0
        ? "left"
        : "right"
      : dy >= 0
        ? "top"
        : "bottom";
  return params.buildRoundedEdgePathFn(
    startPoint.x,
    startPoint.y,
    params.connectPreviewPoint.x,
    params.connectPreviewPoint.y,
    false,
    params.connectFromSide ?? "right",
    guessedToSide,
  );
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function cancelGraphRun(params: {
  isGraphRunning: boolean;
  setIsGraphPaused: (value: boolean) => void;
  setStatus: (value: string) => void;
  pendingWebLogin: boolean;
  resolvePendingWebLogin: (continueAfterLogin: boolean) => void;
  activeWebNodeByProvider: Partial<Record<WebProvider, string>>;
  invokeFn: InvokeFn;
  addNodeLog: (nodeId: string, message: string) => void;
  clearWebBridgeStageWarnTimer: (provider: WebProvider) => void;
  activeWebPromptByProvider: Partial<Record<WebProvider, string>>;
  setError: (value: string) => void;
  pendingWebTurn: unknown;
  suspendedWebTurn: unknown;
  clearQueuedWebTurnRequests: (reason: string) => void;
  resolvePendingWebTurn: (result: { ok: boolean; output?: unknown; error?: string }) => void;
  pauseErrorToken: string;
  activeTurnThreadByNodeId: Record<string, string>;
}) {
  if (!params.isGraphRunning) {
    return;
  }
  params.setIsGraphPaused(true);
  params.setStatus("일시정지 요청됨");

  if (params.pendingWebLogin) {
    params.resolvePendingWebLogin(false);
  }

  const activeWebProviders = Object.keys(params.activeWebNodeByProvider) as WebProvider[];
  if (activeWebProviders.length > 0) {
    for (const provider of activeWebProviders) {
      const activeWebNodeId = params.activeWebNodeByProvider[provider];
      try {
        await params.invokeFn("web_provider_cancel", { provider });
        if (activeWebNodeId) {
          params.addNodeLog(activeWebNodeId, "[WEB] 취소 요청 전송");
        }
        params.clearWebBridgeStageWarnTimer(provider);
        delete params.activeWebPromptByProvider[provider];
        delete params.activeWebNodeByProvider[provider];
      } catch (error) {
        params.setError(String(error));
      }
    }
  }

  if (params.pendingWebTurn) {
    params.clearQueuedWebTurnRequests(params.pauseErrorToken);
    params.resolvePendingWebTurn({ ok: false, error: params.pauseErrorToken });
    return;
  }
  if (params.suspendedWebTurn) {
    params.clearQueuedWebTurnRequests(params.pauseErrorToken);
    params.resolvePendingWebTurn({ ok: false, error: params.pauseErrorToken });
    return;
  }

  const activeTurnEntries = Object.entries(params.activeTurnThreadByNodeId).filter(([, threadId]) =>
    String(threadId ?? "").trim(),
  );
  for (const [activeNodeId, threadId] of activeTurnEntries) {
    try {
      await params.invokeFn("turn_interrupt", { threadId });
      params.addNodeLog(activeNodeId, "turn_interrupt 요청 전송");
    } catch (error) {
      params.setError(String(error));
    }
  }
}
