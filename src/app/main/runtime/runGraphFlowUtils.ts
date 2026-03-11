import { getTurnExecutor, type TurnConfig, type WebProvider } from "../../../features/workflow/domain";
import { resolveQuestionDirectInputNodeIds } from "../../../features/workflow/graph-utils";
import type { GraphData, GraphEdge, GraphNode, NodeExecutionStatus } from "../../../features/workflow/types";
import type {
  CodexMultiAgentMode,
  EvidenceEnvelope,
  FeedInputSource,
  FeedPost,
  NodeResponsibilityMemory,
  NodeRunState,
  RunRecord,
} from "../types";
import type { AdaptiveRecipeSnapshot } from "../../adaptation/types";

export function graphRequiresCodexEngine(nodes: GraphNode[]): boolean {
  return nodes.some((node) => node.type === "turn" && getTurnExecutor(node.config as TurnConfig) === "codex");
}

export function resolveDagMaxThreads(mode: CodexMultiAgentMode): number {
  if (mode === "max") {
    return 4;
  }
  if (mode === "balanced") {
    return 2;
  }
  return 1;
}

export function resolveGraphDagMaxThreads(mode: CodexMultiAgentMode, directInputNodeCount: number): number {
  const base = resolveDagMaxThreads(mode);
  if (directInputNodeCount <= 1) {
    return base;
  }
  return Math.max(base, directInputNodeCount);
}

export function buildWebConnectPreflightReasons(params: {
  bridgeRunning: boolean;
  tokenMasked: boolean;
  extensionOriginPolicy?: string;
  extensionOriginAllowlistConfigured?: boolean;
  missingProviders: WebProvider[];
  webProviderLabelFn: (provider: WebProvider) => string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): string[] {
  const reasons: string[] = [];
  if (!params.bridgeRunning || !params.tokenMasked) {
    reasons.push(params.t("modal.webConnectReasonNotRunning"));
  }
  if (params.extensionOriginPolicy === "allowlist" && params.extensionOriginAllowlistConfigured === false) {
    reasons.push(params.t("modal.webConnectReasonPolicy"));
  }
  if (params.missingProviders.length > 0) {
    reasons.push(
      params.t("modal.webConnectReasonMissingProviders", {
        providers: params.missingProviders.map((provider) => params.webProviderLabelFn(provider)).join(", "),
      }),
    );
  }
  return reasons;
}

export function findDirectInputNodeIds(graph: GraphData): string[] {
  return resolveQuestionDirectInputNodeIds(graph);
}

export function createRunNodeStateSnapshot(nodes: GraphNode[]): {
  nodeStates: Record<string, NodeRunState>;
  runLogs: Record<string, string[]>;
} {
  const nodeStates: Record<string, NodeRunState> = {};
  const runLogs: Record<string, string[]> = {};
  for (const node of nodes) {
    nodeStates[node.id] = {
      status: "idle",
      logs: [],
    };
    runLogs[node.id] = [];
  }
  return { nodeStates, runLogs };
}

export function createRunRecord(params: {
  graph: GraphData;
  question: string;
  workflowGroupName?: string;
  workflowGroupKind?: RunRecord["workflowGroupKind"];
  workflowPresetKind?: RunRecord["workflowPresetKind"];
  adaptiveRecipeSnapshot?: AdaptiveRecipeSnapshot;
  runId?: string;
}): RunRecord {
  return {
    runId: String(params.runId ?? `${Date.now()}`),
    question: params.question,
    startedAt: new Date().toISOString(),
    workflowGroupName: params.workflowGroupName,
    workflowGroupKind: params.workflowGroupKind,
    workflowPresetKind: params.workflowPresetKind,
    graphSnapshot: params.graph,
    transitions: [],
    summaryLogs: [],
    nodeLogs: {},
    threadTurnMap: {},
    providerTrace: [],
    knowledgeTrace: [],
    internalMemoryTrace: [],
    nodeMetrics: {},
    feedPosts: [],
    normalizedEvidenceByNodeId: {},
    conflictLedger: [],
    runMemory: {},
    adaptiveRecipeSnapshot: params.adaptiveRecipeSnapshot,
  };
}

export function resolveFinalNodeId(params: {
  graph: GraphData;
  transitions: RunRecord["transitions"];
  lastDoneNodeId: string;
}): string {
  const outgoingNodeIdSet = new Set(params.graph.edges.map((edge) => edge.from.nodeId));
  const sinkNodeIds = params.graph.nodes
    .map((node) => node.id)
    .filter((nodeId) => !outgoingNodeIdSet.has(nodeId));
  if (sinkNodeIds.length === 1) {
    return sinkNodeIds[0];
  }
  if (sinkNodeIds.length > 1) {
    const sinkSet = new Set(sinkNodeIds);
    for (let index = params.transitions.length - 1; index >= 0; index -= 1) {
      const row = params.transitions[index];
      if (sinkSet.has(row.nodeId)) {
        return row.nodeId;
      }
    }
  }
  return params.lastDoneNodeId || "";
}

export function buildFinalNodeFailureReason(params: {
  finalNodeId: string;
  finalNodeState?: NodeExecutionStatus;
  nodeStatusLabelFn: (state: NodeExecutionStatus) => string;
}): string {
  if (params.finalNodeId && params.finalNodeState) {
    return `최종 노드(${params.finalNodeId}) 상태=${params.nodeStatusLabelFn(params.finalNodeState)}`;
  }
  return "최종 노드를 확정하지 못했습니다.";
}

export function buildGraphExecutionIndex(graph: GraphData): {
  nodeMap: Map<string, GraphNode>;
  indegree: Map<string, number>;
  adjacency: Map<string, string[]>;
  incoming: Map<string, string[]>;
} {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of graph.edges) {
    indegree.set(edge.to.nodeId, (indegree.get(edge.to.nodeId) ?? 0) + 1);
    const children = adjacency.get(edge.from.nodeId) ?? [];
    children.push(edge.to.nodeId);
    adjacency.set(edge.from.nodeId, children);
    const parents = incoming.get(edge.to.nodeId) ?? [];
    parents.push(edge.from.nodeId);
    incoming.set(edge.to.nodeId, parents);
  }
  return { nodeMap, indegree, adjacency, incoming };
}

export function enqueueZeroIndegreeNodes(params: {
  indegree: Map<string, number>;
  queue: string[];
  onQueued: (nodeId: string) => void;
}) {
  params.indegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      params.queue.push(nodeId);
      params.onQueued(nodeId);
    }
  });
}

export function scheduleChildrenWhenReady(params: {
  nodeId: string;
  adjacency: Map<string, string[]>;
  indegree: Map<string, number>;
  queue: string[];
  onQueued: (nodeId: string) => void;
}) {
  const children = params.adjacency.get(params.nodeId) ?? [];
  for (const childId of children) {
    const next = (params.indegree.get(childId) ?? 0) - 1;
    params.indegree.set(childId, next);
    if (next === 0) {
      params.queue.push(childId);
      params.onQueued(childId);
    }
  }
}

export function resolveFeedInputSources(params: {
  targetNodeId: string;
  edges: GraphEdge[];
  nodeMap: Map<string, GraphNode>;
  workflowQuestion: string;
  latestFeedSourceByNodeId: Map<string, FeedInputSource>;
  turnRoleLabelFn: (node: GraphNode) => string;
  nodeTypeLabelFn: (type: GraphNode["type"]) => string;
  nodeSelectionLabelFn: (node: GraphNode) => string;
}): FeedInputSource[] {
  const incomingEdges = params.edges.filter((edge) => edge.to.nodeId === params.targetNodeId);
  if (incomingEdges.length === 0) {
    return [
      {
        kind: "question",
        agentName: "사용자 입력 질문",
        summary: params.workflowQuestion.trim() || undefined,
      },
    ];
  }
  const seenNodeIds = new Set<string>();
  const sources: FeedInputSource[] = [];
  for (const edge of incomingEdges) {
    const sourceNodeId = edge.from.nodeId;
    if (!sourceNodeId || seenNodeIds.has(sourceNodeId)) {
      continue;
    }
    seenNodeIds.add(sourceNodeId);
    const known = params.latestFeedSourceByNodeId.get(sourceNodeId);
    const sourceNode = params.nodeMap.get(sourceNodeId);
    const sourceRoleLabel =
      sourceNode?.type === "turn"
        ? params.turnRoleLabelFn(sourceNode)
        : sourceNode
          ? params.nodeTypeLabelFn(sourceNode.type)
          : known?.roleLabel;
    const sourceAgentName = known?.agentName ?? (sourceNode ? params.nodeSelectionLabelFn(sourceNode) : sourceNodeId);
    sources.push({
      kind: "node",
      nodeId: sourceNodeId,
      agentName: sourceAgentName,
      roleLabel: sourceRoleLabel,
      summary: known?.summary,
      sourcePostId: known?.sourcePostId,
    });
  }
  return sources;
}

export function rememberFeedSource(latestFeedSourceByNodeId: Map<string, FeedInputSource>, post: FeedPost) {
  latestFeedSourceByNodeId.set(post.nodeId, {
    kind: "node",
    nodeId: post.nodeId,
    agentName: post.agentName,
    roleLabel: post.roleLabel,
    summary: post.summary,
    sourcePostId: post.id,
  });
}

export function appendNodeEvidenceWithMemory(params: {
  node: GraphNode;
  output: unknown;
  provider?: string;
  summary?: string;
  createdAt?: string;
  normalizedEvidenceByNodeId: Record<string, EvidenceEnvelope[]>;
  runMemoryByNodeId: Record<string, NodeResponsibilityMemory>;
  runRecord: RunRecord;
  turnRoleLabelFn: (node: GraphNode) => string;
  nodeTypeLabelFn: (type: GraphNode["type"]) => string;
  normalizeEvidenceEnvelopeFn: (params: {
    nodeId: string;
    roleLabel: string;
    provider?: string;
    output: unknown;
    fallbackCapturedAt?: string;
  }) => EvidenceEnvelope;
  updateRunMemoryByEnvelopeFn: (
    current: Record<string, NodeResponsibilityMemory>,
    params: {
      nodeId: string;
      roleLabel: string;
      summary?: string;
      envelope: EvidenceEnvelope;
    },
  ) => Record<string, NodeResponsibilityMemory>;
}): {
  envelope: EvidenceEnvelope;
  runMemoryByNodeId: Record<string, NodeResponsibilityMemory>;
} {
  const roleLabel =
    params.node.type === "turn" ? params.turnRoleLabelFn(params.node) : params.nodeTypeLabelFn(params.node.type);
  const envelope = params.normalizeEvidenceEnvelopeFn({
    nodeId: params.node.id,
    roleLabel,
    provider: params.provider,
    output: params.output,
    fallbackCapturedAt: params.createdAt,
  });
  params.normalizedEvidenceByNodeId[params.node.id] = [
    ...(params.normalizedEvidenceByNodeId[params.node.id] ?? []),
    envelope,
  ];
  const nextRunMemoryByNodeId = params.updateRunMemoryByEnvelopeFn(params.runMemoryByNodeId, {
    nodeId: params.node.id,
    roleLabel,
    summary: params.summary,
    envelope,
  });
  params.runRecord.normalizedEvidenceByNodeId = params.normalizedEvidenceByNodeId;
  params.runRecord.runMemory = nextRunMemoryByNodeId;
  return {
    envelope,
    runMemoryByNodeId: nextRunMemoryByNodeId,
  };
}

export function scheduleRunnableGraphNodes(params: {
  queue: string[];
  activeTasks: Map<string, Promise<void>>;
  dagMaxThreads: number;
  nodeMap: Map<string, GraphNode>;
  activeTurnTasks: number;
  processNode: (nodeId: string) => Promise<void>;
  reportSoftError: (prefix: string, error: unknown) => void;
}): number {
  for (let index = 0; index < params.queue.length && params.activeTasks.size < params.dagMaxThreads; ) {
    const nodeId = params.queue[index];
    const node = params.nodeMap.get(nodeId);
    if (!node) {
      params.queue.splice(index, 1);
      continue;
    }
    params.queue.splice(index, 1);
    const task = params.processNode(nodeId)
      .catch((error) => {
        params.reportSoftError(`노드 실행 실패(${nodeId})`, error);
      })
      .finally(() => {
        params.activeTasks.delete(nodeId);
      });
    params.activeTasks.set(nodeId, task);
  }
  return params.activeTurnTasks;
}
