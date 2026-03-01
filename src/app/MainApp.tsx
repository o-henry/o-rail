import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../App.css";
import { invoke, listen, openUrl } from "../shared/tauri";
import AppNav from "../components/AppNav";
import BridgePage from "../pages/bridge/BridgePage";
import FeedPage from "../pages/feed/FeedPage";
import DashboardPage from "../pages/dashboard/DashboardPage";
import { type DashboardDetailTopic } from "../pages/dashboard/DashboardDetailPage";
import AgentsPage from "../pages/agents/AgentsPage";
import type { AgentQuickActionRequest, AgentWorkspaceLaunchRequest } from "../pages/agents/agentTypes";
import SettingsPage from "../pages/settings/SettingsPage";
import DashboardIntelligenceSettings from "../pages/settings/DashboardIntelligenceSettings";
import WorkflowPage from "../pages/workflow/WorkflowPage";
import { useFloatingPanel } from "../features/ui/useFloatingPanel";
import { useExecutionState } from "./hooks/useExecutionState";
import { useFeedRunActions } from "./hooks/useFeedRunActions";
import { useFeedInspectorEffects } from "./hooks/useFeedInspectorEffects";
import { useFeedState } from "./hooks/useFeedState";
import { useGraphFileActions } from "./hooks/useGraphFileActions";
import { useGraphState } from "./hooks/useGraphState";
import { useWebConnectState } from "./hooks/useWebConnectState";
import { useWorkflowGraphActions } from "./hooks/useWorkflowGraphActions";
import { useWorkflowShortcuts } from "./hooks/useWorkflowShortcuts";
import { useDashboardIntelligenceConfig } from "./hooks/useDashboardIntelligenceConfig";
import { useDashboardIntelligenceRunner } from "./hooks/useDashboardIntelligenceRunner";
import {
  COST_PRESET_DEFAULT_MODEL,
  DEFAULT_TURN_MODEL,
  TURN_EXECUTOR_OPTIONS,
  TURN_MODEL_OPTIONS,
  WEB_PROVIDER_OPTIONS,
  costPresetLabel,
  getCostPresetTargetModel,
  getTurnExecutor,
  getWebProviderFromExecutor,
  inferQualityProfile,
  isCostPreset,
  isPresetKind,
  normalizeWebResultMode,
  toArtifactType,
  toTurnModelDisplayName,
  turnExecutorLabel,
  webProviderHomeUrl,
  webProviderLabel,
  type ArtifactType,
  type CostPreset,
  type PresetKind,
  type QualityProfileId,
  type TurnConfig,
  type TurnExecutor,
  type WebProvider,
} from "../features/workflow/domain";
import {
  applyPresetOutputSchemaPolicies,
  applyPresetTurnPolicies,
  buildPresetGraphByKind,
  simplifyPresetForSimpleWorkflow,
} from "../features/workflow/presets";
import { localizePresetPromptTemplate } from "../features/workflow/presets/promptLocale";
import {
  approvalDecisionLabel,
  approvalSourceLabel,
  authModeLabel,
  extractFinalAnswer,
  formatRelativeFeedTime,
  lifecycleStateLabel,
  nodeSelectionLabel,
  nodeStatusLabel,
  nodeTypeLabel,
  turnRoleLabel,
} from "../features/workflow/labels";
import { QUALITY_DEFAULT_THRESHOLD } from "../features/workflow/quality";
import {
  injectOutputLanguageDirective,
  replaceInputPlaceholder,
  toHumanReadableFeedText,
} from "../features/workflow/promptUtils";
import {
  buildFeedAvatarLabel,
  formatFeedInputSourceLabel,
  formatUsageInfoForDisplay,
  hashStringToHue,
} from "../features/feed/displayUtils";
import { computeFeedDerivedState } from "../features/feed/derivedState";
import {
  autoArrangeGraphLayout,
  buildCanvasEdgeLines,
  buildRoundedEdgePath,
  cloneGraph,
  defaultNodeConfig,
  getAutoConnectionSides,
  getGraphEdgeKey,
  getNodeAnchorPoint,
  graphEquals,
  makeNodeId,
  nodeCardSummary,
  snapToLayoutGrid,
  snapToNearbyNodeAxis,
  turnModelLabel,
} from "../features/workflow/graph-utils";
import type {
  GraphNode,
} from "../features/workflow/types";
import { type DashboardTopicId } from "../features/dashboard/intelligence";
import {
  AUTH_MODE_STORAGE_KEY,
  CODEX_MULTI_AGENT_MODE_STORAGE_KEY,
  LOGIN_COMPLETED_STORAGE_KEY,
  WORKSPACE_CWD_STORAGE_KEY,
  extractAuthMode,
  extractDeltaText,
  extractStringByPaths,
  formatDuration,
  formatNodeElapsedTime,
  formatRunDateTime,
  formatUnknown,
  formatUsage,
  isEngineAlreadyStartedError,
  isNodeDragAllowedTarget,
  loadPersistedAuthMode,
  loadPersistedCodexMultiAgentMode,
  loadPersistedCwd,
  loadPersistedLoginCompleted,
  normalizeCodexMultiAgentMode,
  resolveNodeCwd,
  toErrorText,
  toOpenRunsFolderErrorMessage,
  toUsageCheckErrorMessage,
} from "./mainAppUtils";
import {
  GRAPH_SCHEMA_VERSION,
  KNOWLEDGE_DEFAULT_MAX_CHARS,
  KNOWLEDGE_DEFAULT_TOP_K,
  NavIcon,
  type WorkspaceTab,
  isTurnTerminalEvent,
  normalizeKnowledgeConfig,
  toWebBridgeStatus,
  validateSimpleSchema,
} from "./mainAppGraphHelpers";
import { useI18n } from "../i18n";
import {
  getArtifactTypeOptions,
  getCodexMultiAgentModeOptions,
  getCostPresetOptions,
  NODE_ANCHOR_SIDES,
  getPresetTemplateMeta,
  getPresetTemplateOptions,
  getQualityProfileOptions,
  getQualityThresholdOptions,
  buildFeedPost,
  buildQualityReport,
  defaultKnowledgeConfig,
  executeGateNode,
  executeTransformNode,
  feedAttachmentRawKey,
  inferRunGroupMeta,
  isCriticalTurnNode,
  normalizeEvidenceEnvelope,
  normalizeWebTurnOutput,
  buildConflictLedger,
  computeFinalConfidence,
  updateRunMemoryByEnvelope,
  normalizeQualityThreshold,
  normalizeRunRecord,
  summarizeQualityMetrics,
} from "./mainAppRuntimeHelpers";
import {
  AGENT_RULE_CACHE_TTL_MS,
  AGENT_RULE_MAX_DOC_CHARS,
  AGENT_RULE_MAX_DOCS,
  APPROVAL_DECISIONS,
  AUTH_LOGIN_REQUIRED_CONFIRM_COUNT,
  AUTH_LOGIN_REQUIRED_GRACE_MS,
  AUTO_LAYOUT_DRAG_SNAP_THRESHOLD,
  AUTO_LAYOUT_NODE_AXIS_SNAP_THRESHOLD,
  AUTO_LAYOUT_SNAP_THRESHOLD,
  CODEX_LOGIN_COOLDOWN_MS,
  FORCE_AGENT_RULES_ALL_TURNS,
  DEFAULT_STAGE_HEIGHT,
  DEFAULT_STAGE_WIDTH,
  GRAPH_STAGE_INSET_X,
  GRAPH_STAGE_INSET_Y,
  GRAPH_STAGE_INSET_BOTTOM,
  KNOWLEDGE_MAX_CHARS_OPTIONS,
  KNOWLEDGE_TOP_K_OPTIONS,
  MAX_CANVAS_ZOOM,
  MAX_STAGE_HEIGHT,
  MAX_STAGE_WIDTH,
  MIN_CANVAS_ZOOM,
  NODE_DRAG_MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
  QUESTION_INPUT_MAX_HEIGHT,
  SIMPLE_WORKFLOW_UI,
  STAGE_GROW_LIMIT,
  STAGE_GROW_MARGIN,
  TURN_OUTPUT_SCHEMA_MAX_RETRY,
  TURN_OUTPUT_SCHEMA_ENABLED,
  WEB_BRIDGE_CLAIM_WARN_MS,
  WEB_BRIDGE_PROMPT_FILLED_WARN_MS,
  WEB_TURN_FLOATING_DEFAULT_X,
  WEB_TURN_FLOATING_DEFAULT_Y,
  WEB_TURN_FLOATING_MARGIN,
  WEB_TURN_FLOATING_MIN_VISIBLE_HEIGHT,
  WEB_TURN_FLOATING_MIN_VISIBLE_WIDTH,
} from "./main";
import WorkflowCanvasPane from "./main/presentation/WorkflowCanvasPane";
import WorkflowInspectorPane from "./main/presentation/WorkflowInspectorPane";
import { buildFeedPageVm, buildWorkflowInspectorPaneProps } from "./main/presentation/mainAppPropsBuilders";
import {
  cancelFeedReplyFeedbackClearTimer,
  scheduleFeedReplyFeedbackAutoClear,
} from "./main/runtime/feedFollowupUtils";
import { ensureFeedRunRecordFromCache, submitFeedAgentRequest as submitFeedAgentRequestAction } from "./main/runtime/feedFollowupActions";
import {
  clearDetachedWebTurnResolverAction,
  clearQueuedWebTurnRequestsAction,
  requestWebTurnResponseAction,
  resolvePendingWebTurnAction,
} from "./main/runtime/webTurnQueueActions";
import { createWebInteractionHandlers } from "./main/runtime/webInteractionHandlers";
import { createEngineBridgeHandlers } from "./main/runtime/engineBridgeHandlers";
import { createCanvasDragZoomHandlers } from "./main/canvas/canvasDragZoomHandlers";
import { createCanvasConnectionHandlers } from "./main/canvas/canvasConnectionHandlers";
import { createCoreStateHandlers } from "./main/runtime/coreStateHandlers";
import { createFeedKnowledgeHandlers } from "./main/runtime/feedKnowledgeHandlers";
import { useMainAppStateEffects } from "./main/canvas/useMainAppStateEffects";
import { useEngineEventListeners } from "./main/runtime/useEngineEventListeners";
import { useMainAppRuntimeEffects } from "./main/runtime/useMainAppRuntimeEffects";
import { createRunGraphControlHandlers } from "./main/runtime/runGraphControlHandlers";
import { createRunGraphRunner } from "./main/runtime/runGraphRunner";
import { createWorkflowPresetHandlers } from "./main/runtime/workflowPresetHandlers";
import { createWebTurnRunHandlers } from "./main/runtime/webTurnRunHandlers";
import {
  createWorkspaceEventEntry,
  workspaceEventLogFileName,
  workspaceEventLogToMarkdown,
  type WorkspaceEventEntry,
} from "./main/runtime/workspaceEventLog";
import { useBatchScheduler } from "./main/runtime/useBatchScheduler";
import { useCanvasGraphDerivedState } from "./main/canvas/useCanvasGraphDerivedState";
import { MainAppModals } from "./main/presentation/MainAppModals";
import { WorkspaceQuickPanel } from "./main/presentation/WorkspaceQuickPanel";
import {
  buildRailCompatibleDagSnapshot,
  buildRunApprovalSnapshot,
  buildRunMissionFlow,
  buildRunUnityArtifacts,
  evaluateApprovalDecisionGate,
  validateUnifiedRunInput,
} from "./main/runtime/orchestrationRuntimeAdapter";
import type { BatchSchedule, BatchTriggerType } from "../features/orchestration/types";
import {
  PAUSE_ERROR_TOKEN,
  appendRunTransition,
  buildConnectPreviewLine,
  buildFinalTurnInputPacket,
  buildNodeInputForNode,
  cancelGraphRun,
  collectRequiredWebProviders,
  isPauseSignalError,
} from "./main/runtime/runGraphExecutionUtils";
import {
  appendNodeEvidenceWithMemory,
  buildFinalNodeFailureReason,
  buildGraphExecutionIndex,
  buildWebConnectPreflightReasons,
  createRunNodeStateSnapshot,
  createRunRecord,
  enqueueZeroIndegreeNodes,
  findDirectInputNodeIds,
  graphRequiresCodexEngine,
  rememberFeedSource,
  resolveDagMaxThreads,
  resolveFeedInputSources as resolveFeedInputSourcesForNode,
  resolveFinalNodeId,
  scheduleRunnableGraphNodes,
  scheduleChildrenWhenReady,
} from "./main/runtime/runGraphFlowUtils";
import {
  buildRegressionSummary,
  exportRunFeedMarkdownFiles,
  loadInternalMemoryCorpus,
  persistRunRecordFile as persistRunRecordFileHelper,
} from "./main/runtime/runHistoryUtils";
import {
  executeTurnNodeWithOutputSchemaRetry,
  injectKnowledgeContext,
  loadAgentRuleDocs,
} from "./main/runtime/turnExecutionUtils";
import { executeTurnNodeWithContext } from "./main/runtime/executeTurnNode";
import type {
  FeedCategory,
  InternalMemorySnippet,
  WebProviderRunResult,
  RunRecord,
} from "./main";

function saveToLocalStorageSafely(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota/security failures so UI interaction remains available.
  }
}

function toCssBackgroundImageValue(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "none";
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "");
  return `url("${escaped}")`;
}

function App() {
  const USER_BG_IMAGE_STORAGE_KEY = "rail.settings.user_bg_image";
  const USER_BG_OPACITY_STORAGE_KEY = "rail.settings.user_bg_opacity";
  const { locale, t, tp } = useI18n();
  const defaultCwd = useMemo(() => loadPersistedCwd(""), []);
  const defaultLoginCompleted = useMemo(() => loadPersistedLoginCompleted(), []);
  const defaultAuthMode = useMemo(() => loadPersistedAuthMode(), []);
  const defaultCodexMultiAgentMode = useMemo(() => loadPersistedCodexMultiAgentMode(), []);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("dashboard");
  const [dashboardDetailTopic, setDashboardDetailTopic] = useState<DashboardDetailTopic | null>(null);
  const [agentLaunchRequest, setAgentLaunchRequest] = useState<AgentWorkspaceLaunchRequest | null>(null);
  const agentLaunchRequestSeqRef = useRef(0);
  const [workspaceEvents, setWorkspaceEvents] = useState<WorkspaceEventEntry[]>([]);
  const workspaceEventPersistTimerRef = useRef<number | null>(null);
  const lastLoggedStatusRef = useRef("");
  const lastLoggedErrorRef = useRef("");
  const workspaceBackStackRef = useRef<WorkspaceTab[]>([]);
  const workspaceForwardStackRef = useRef<WorkspaceTab[]>([]);
  const suppressWorkspaceHistoryPushRef = useRef(false);
  const {
    config: dashboardIntelligenceConfig,
    runStateByTopic: dashboardIntelligenceRunStateByTopic,
    setRunStateByTopic: setDashboardIntelligenceRunStateByTopic,
  } = useDashboardIntelligenceConfig();
  const [quickPanelOpen, setQuickPanelOpen] = useState(false);
  const [quickPanelQuery, setQuickPanelQuery] = useState("");
  const [pendingWebConnectCheck, setPendingWebConnectCheck] = useState<{
    providers: WebProvider[];
    reason: string;
  } | null>(null);
  const manualInputWaitNoticeByNodeRef = useRef<Record<string, boolean>>({});

  const [cwd, setCwd] = useState(defaultCwd);
  const [model, setModel] = useState<string>(DEFAULT_TURN_MODEL);
  const [userBackgroundImage, setUserBackgroundImage] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return window.localStorage.getItem(USER_BG_IMAGE_STORAGE_KEY) ?? "";
  });
  const [userBackgroundOpacity, setUserBackgroundOpacity] = useState<number>(() => {
    if (typeof window === "undefined") {
      return 0;
    }
    const raw = window.localStorage.getItem(USER_BG_OPACITY_STORAGE_KEY);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.min(1, Math.max(0, parsed));
  });
  const [costPreset, setCostPreset] = useState<CostPreset>("balanced");
  const [workflowQuestion, setWorkflowQuestion] = useState(
    "",
  );

  const {
    engineStarted,
    setEngineStarted,
    status,
    setStatus: setStatusState,
    running,
    setRunning,
    error,
    setErrorState,
    setErrorLogs,
    usageInfoText,
    setUsageInfoText,
    usageResultClosed,
    setUsageResultClosed,
    authMode,
    setAuthMode,
    codexMultiAgentMode,
    setCodexMultiAgentMode,
    loginCompleted,
    setLoginCompleted,
    codexAuthBusy,
    setCodexAuthBusy,
    pendingApprovals,
    setPendingApprovals,
    approvalSubmitting,
    setApprovalSubmitting,
    nodeStates,
    setNodeStates,
    isGraphRunning,
    setIsGraphRunning,
    isGraphPaused,
    setIsGraphPaused,
    isRunStarting,
    setIsRunStarting,
    runtimeNowMs,
    setRuntimeNowMs,
    cancelRequestedRef,
    pauseRequestedRef,
    activeTurnNodeIdRef,
    turnTerminalResolverRef,
    activeRunDeltaRef,
    collectingRunRef,
    runLogCollectorRef,
    feedRunCacheRef,
    runStartGuardRef,
    authLoginRequiredProbeCountRef,
    lastAuthenticatedAtRef,
    codexLoginLastAttemptAtRef,
  } = useExecutionState({
    defaultAuthMode,
    defaultCodexMultiAgentMode,
    defaultLoginCompleted,
  });
  const {
    pendingWebTurn,
    setPendingWebTurn,
    suspendedWebTurn,
    setSuspendedWebTurn,
    suspendedWebResponseDraft,
    setSuspendedWebResponseDraft,
    pendingWebLogin,
    setPendingWebLogin,
    webResponseDraft,
    setWebResponseDraft,
    setWebWorkerHealth,
    webWorkerBusy,
    setWebWorkerBusy,
    webBridgeStatus,
    setWebBridgeStatus,
    setWebBridgeLogs,
    webBridgeConnectCode,
    setWebBridgeConnectCode,
    providerChildViewOpen,
    setProviderChildViewOpen,
    activeWebNodeByProviderRef,
    webTurnResolverRef,
    webTurnQueueRef,
    webLoginResolverRef,
    pendingWebTurnAutoOpenKeyRef,
    webTurnFloatingRef,
    pendingWebLoginAutoOpenKeyRef,
    webBridgeStageWarnTimerRef,
    activeWebPromptRef,
    activeWebProviderByNodeRef,
    activeWebPromptByNodeRef,
    manualWebFallbackNodeRef,
  } = useWebConnectState();
  const {
    graph,
    setGraph,
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeKey,
    setSelectedEdgeKey,
    connectFromNodeId,
    setConnectFromNodeId,
    connectFromSide,
    setConnectFromSide,
    connectPreviewStartPoint,
    setConnectPreviewStartPoint,
    connectPreviewPoint,
    setConnectPreviewPoint,
    isConnectingDrag,
    setIsConnectingDrag,
    draggingNodeIds,
    setDraggingNodeIds,
    graphFileName,
    setGraphFileName,
    selectedGraphFileName,
    setSelectedGraphFileName,
    graphRenameOpen,
    setGraphRenameOpen,
    graphRenameDraft,
    setGraphRenameDraft,
    graphFiles,
    setGraphFiles,
    canvasZoom,
    setCanvasZoom,
    panMode,
    setPanMode,
    canvasFullscreen,
    setCanvasFullscreen,
    canvasLogicalViewport,
    setCanvasLogicalViewport,
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    setNodeSizeVersion,
    marqueeSelection,
    setMarqueeSelection,
    dragRef,
    edgeDragRef,
    graphCanvasRef,
    nodeSizeMapRef,
    questionInputRef,
    panRef,
    dragPointerRef,
    dragAutoPanFrameRef,
    dragWindowMoveHandlerRef,
    dragWindowUpHandlerRef,
    dragStartSnapshotRef,
    edgeDragStartSnapshotRef,
    edgeDragWindowMoveHandlerRef,
    edgeDragWindowUpHandlerRef,
    zoomStatusTimerRef,
    lastAppliedPresetRef,
    graphClipboardRef,
    graphPasteSerialRef,
  } = useGraphState({
    initialGraph: {
      version: GRAPH_SCHEMA_VERSION,
      nodes: [],
      edges: [],
      knowledge: defaultKnowledgeConfig(),
    },
    defaultStageWidth: DEFAULT_STAGE_WIDTH,
    defaultStageHeight: DEFAULT_STAGE_HEIGHT,
  });
  const {
    feedPosts,
    setFeedPosts,
    feedLoading,
    setFeedLoading,
    feedStatusFilter,
    setFeedStatusFilter,
    feedExecutorFilter,
    setFeedExecutorFilter,
    feedPeriodFilter,
    setFeedPeriodFilter,
    feedKeyword,
    setFeedKeyword,
    feedCategory,
    setFeedCategory,
    feedFilterOpen,
    setFeedFilterOpen,
    feedGroupExpandedByRunId,
    setFeedGroupExpandedByRunId,
    feedGroupRenameRunId,
    setFeedGroupRenameRunId,
    feedGroupRenameDraft,
    setFeedGroupRenameDraft,
    feedExpandedByPost,
    setFeedExpandedByPost,
    feedShareMenuPostId,
    setFeedShareMenuPostId,
    feedReplyDraftByPost,
    setFeedReplyDraftByPost,
    feedReplySubmittingByPost,
    setFeedReplySubmittingByPost,
    feedReplyFeedbackByPost,
    setFeedReplyFeedbackByPost,
    feedInspectorPostId,
    setFeedInspectorPostId,
    feedInspectorSnapshotNode,
    setFeedInspectorSnapshotNode,
    setFeedInspectorRuleDocs,
    setFeedInspectorRuleLoading,
    pendingNodeRequests,
    setPendingNodeRequests,
    activeFeedRunMeta,
    setActiveFeedRunMeta,
    setLastSavedRunFile,
    feedRawAttachmentRef,
    pendingNodeRequestsRef,
    agentRulesCacheRef,
    feedReplyFeedbackClearTimerRef,
  } = useFeedState();
  const hasTauriRuntime = useMemo(
    () => Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__),
    [],
  );
  const {
    snapshotsByTopic: dashboardSnapshotsByTopic,
    refreshSnapshots: refreshDashboardSnapshots,
    runTopic: runDashboardTopic,
  } = useDashboardIntelligenceRunner({
    cwd,
    hasTauriRuntime,
    config: dashboardIntelligenceConfig,
    setRunStateByTopic: setDashboardIntelligenceRunStateByTopic,
    invokeFn: invoke,
    setStatus: setStatusState,
    setError: setErrorState,
  });
  const internalMemoryCorpusRef = useRef<InternalMemorySnippet[]>([]);
  const activeRunPresetKindRef = useRef<PresetKind | undefined>(undefined);
  const webTurnPanel = useFloatingPanel({
    enabled: Boolean(pendingWebTurn),
    panelRef: webTurnFloatingRef,
    defaultPosition: {
      x: WEB_TURN_FLOATING_DEFAULT_X,
      y: WEB_TURN_FLOATING_DEFAULT_Y,
    },
    margin: WEB_TURN_FLOATING_MARGIN,
    minVisibleWidth: WEB_TURN_FLOATING_MIN_VISIBLE_WIDTH,
    minVisibleHeight: WEB_TURN_FLOATING_MIN_VISIBLE_HEIGHT,
  });

  const activeApproval = pendingApprovals[0];
  const {
    canvasNodes,
    canvasNodeIdSet,
    canvasNodeMap,
    canvasDisplayEdges,
    selectedEdgeNodeIdSet,
    selectedNode,
    questionDirectInputNodeIds,
    graphKnowledge,
    enabledKnowledgeFiles,
    selectedKnowledgeMaxCharsOption,
  } = useCanvasGraphDerivedState({
    graph,
    selectedNodeId,
    selectedEdgeKey,
    simpleWorkflowUi: SIMPLE_WORKFLOW_UI,
    normalizeKnowledgeConfig,
    knowledgeMaxCharsOptions: KNOWLEDGE_MAX_CHARS_OPTIONS,
    knowledgeDefaultMaxChars: KNOWLEDGE_DEFAULT_MAX_CHARS,
  });

  const {
    setStatus: setStatusCore,
    setError: setErrorCore,
    persistRunRecordFile,
    getNodeVisualSize,
    setNodeSelection,
    addNodeLog,
    setNodeStatus,
    setNodeRuntimeFields,
    enqueueNodeRequest,
    consumeNodeRequests,
    markCodexNodesStatusOnEngineIssue,
    applyGraphChange,
    onUndoGraph,
    onRedoGraph,
    onClearGraphCanvas,
    reportSoftError,
    normalizeWebBridgeProgressMessage,
    clearWebBridgeStageWarnTimer,
    scheduleWebBridgeStageWarn,
  } = createCoreStateHandlers({
    tp,
    setStatusState,
    setErrorState,
    setErrorLogs,
    invokeFn: invoke,
    persistRunRecordFileHelper,
    nodeSizeMapRef,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    setSelectedNodeIds,
    setSelectedNodeId,
    selectedNodeId,
    collectingRunRef,
    runLogCollectorRef,
    setNodeStates,
    pendingNodeRequestsRef,
    setPendingNodeRequests,
    graph,
    getTurnExecutor,
    setGraph,
    autoArrangeGraphLayout,
    graphEquals,
    setUndoStack,
    setRedoStack,
    cloneGraph,
    isGraphRunning,
    isRunStarting,
    setSelectedEdgeKey,
    toErrorText,
    webBridgeStageWarnTimerRef,
    activeWebNodeByProviderRef,
  });

  const appendWorkspaceEvent = useCallback((params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
  }) => {
    const message = String(params.message ?? "").trim();
    if (!message) {
      return;
    }
    const next = createWorkspaceEventEntry({
      source: params.source,
      message,
      actor: params.actor,
      level: params.level,
    });
    setWorkspaceEvents((prev) => [next, ...prev].slice(0, 300));
  }, []);

  const setStatus = useCallback((message: string) => {
    setStatusCore(message);
  }, [setStatusCore]);

  const setError = useCallback((message: string) => {
    setErrorCore(message);
  }, [setErrorCore]);

  let webTurnRunHandlers: ReturnType<typeof createWebTurnRunHandlers> | null = null;

  function resolvePendingWebTurn(result: { ok: boolean; output?: unknown; error?: string }) {
    if (!webTurnRunHandlers) {
      return;
    }
    webTurnRunHandlers.resolvePendingWebTurn(result);
  }

  function clearQueuedWebTurnRequests(reason: string) {
    if (!webTurnRunHandlers) {
      return;
    }
    webTurnRunHandlers.clearQueuedWebTurnRequests(reason);
  }

  function clearDetachedWebTurnResolver(reason: string) {
    if (!webTurnRunHandlers) {
      return;
    }
    webTurnRunHandlers.clearDetachedWebTurnResolver(reason);
  }

  async function executeTurnNode(node: GraphNode, input: unknown) {
    if (!webTurnRunHandlers) {
      return { ok: false, error: "턴 실행 핸들러가 초기화되지 않았습니다." };
    }
    return webTurnRunHandlers.executeTurnNode(node, input);
  }

  async function saveRunRecord(runRecord: RunRecord) {
    if (!webTurnRunHandlers) {
      return;
    }
    await webTurnRunHandlers.saveRunRecord(runRecord);
  }

  const {
    refreshGraphFiles,
    refreshFeedTimeline,
    onOpenRunsFolder,
    onOpenFeedMarkdownFile,
    ensureFeedRunRecord,
    onSubmitFeedAgentRequest,
    onOpenKnowledgeFilePicker,
    onRemoveKnowledgeFile,
    onToggleKnowledgeFileEnabled,
  } = createFeedKnowledgeHandlers({
    hasTauriRuntime,
    invokeFn: invoke,
    setGraphFiles,
    setFeedPosts,
    setFeedLoading,
    setStatus,
    setError,
    toOpenRunsFolderErrorMessage,
    feedRunCacheRef,
    normalizeRunRecordFn: normalizeRunRecord,
    ensureFeedRunRecordFromCacheFn: ensureFeedRunRecordFromCache,
    submitFeedAgentRequestAction,
    graph,
    isGraphRunning,
    workflowQuestion,
    cwd,
    nodeStates,
    feedReplyDraftByPost,
    feedReplySubmittingByPost,
    feedRawAttachmentRef,
    feedReplyFeedbackClearTimerRef,
    setFeedReplySubmittingByPost,
    setFeedReplyFeedbackByPost,
    setFeedReplyDraftByPost,
    setNodeStatus,
    setNodeRuntimeFields,
    addNodeLog,
    enqueueNodeRequest,
    persistRunRecordFile,
    executeTurnNode,
    validateSimpleSchemaFn: validateSimpleSchema,
    turnOutputSchemaEnabled: TURN_OUTPUT_SCHEMA_ENABLED,
    turnOutputSchemaMaxRetry: TURN_OUTPUT_SCHEMA_MAX_RETRY,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    defaultKnowledgeConfig,
    buildFeedPostFn: buildFeedPost,
    feedAttachmentRawKeyFn: feedAttachmentRawKey,
    exportRunFeedMarkdownFilesFn: exportRunFeedMarkdownFiles,
    cancelFeedReplyFeedbackClearTimerFn: cancelFeedReplyFeedbackClearTimer,
    scheduleFeedReplyFeedbackAutoClearFn: scheduleFeedReplyFeedbackAutoClear,
    turnModelLabelFn: turnModelLabel,
    t,
    applyGraphChange,
  });

  const {
    onShareFeedPost,
    onDeleteFeedRunGroup,
    onSubmitFeedRunGroupRename,
  } = useFeedRunActions({
    setError,
    setStatus,
    setFeedShareMenuPostId,
    setFeedPosts,
    setFeedInspectorPostId,
    setFeedGroupExpandedByRunId,
    feedGroupRenameRunId,
    setFeedGroupRenameRunId,
    feedGroupRenameDraft,
    setFeedGroupRenameDraft,
    activeFeedRunMeta,
    setActiveFeedRunMeta,
    feedRunCacheRef,
    ensureFeedRunRecord,
    persistRunRecordFile,
  });


  const {
    ensureEngineStarted,
    refreshAuthStateFromEngine,
    onCheckUsage,
    onLoginCodex,
    onSelectCwdDirectory,
    onOpenPendingProviderWindow,
    onCloseProviderChildView,
    refreshWebWorkerHealth,
    refreshWebBridgeStatus,
    onRestartWebBridge,
    onCopyWebBridgeConnectCode,
    onOpenProviderSession,
  } = createEngineBridgeHandlers({
    engineStarted,
    cwd,
    invokeFn: invoke,
    setEngineStarted,
    isEngineAlreadyStartedError,
    setError,
    setStatus,
    toErrorText,
    markCodexNodesStatusOnEngineIssue,
    setRunning,
    setIsGraphRunning,
    setUsageInfoText,
    extractAuthMode,
    setAuthMode,
    authLoginRequiredProbeCountRef,
    lastAuthenticatedAtRef,
    setLoginCompleted,
    loginCompleted,
    authLoginRequiredGraceMs: AUTH_LOGIN_REQUIRED_GRACE_MS,
    authLoginRequiredConfirmCount: AUTH_LOGIN_REQUIRED_CONFIRM_COUNT,
    formatUsageInfoForDisplay,
    setUsageResultClosed,
    toUsageCheckErrorMessage,
    codexAuthBusy,
    codexLoginLastAttemptAtRef,
    codexLoginCooldownMs: CODEX_LOGIN_COOLDOWN_MS,
    setCodexAuthBusy,
    openUrlFn: openUrl,
    setCwd,
    pendingWebTurn,
    webProviderHomeUrl,
    webProviderLabel,
    setProviderChildViewOpen,
    setWebWorkerHealth,
    setWebBridgeStatus,
    toWebBridgeStatus,
    setWebWorkerBusy,
    setWebBridgeConnectCode,
  });
  const autoEngineStartRequestedRef = useRef(false);

  useEffect(() => {
    if (!hasTauriRuntime || engineStarted) {
      return;
    }
    const resolvedCwd = String(cwd ?? "").trim();
    if (!resolvedCwd || resolvedCwd === ".") {
      return;
    }
    if (autoEngineStartRequestedRef.current) {
      return;
    }
    autoEngineStartRequestedRef.current = true;
    void ensureEngineStarted()
      .then(() => refreshAuthStateFromEngine(true))
      .then(() => setStatus("준비됨"))
      .catch((error) => {
        autoEngineStartRequestedRef.current = false;
        setError(toErrorText(error));
      });
  }, [cwd, engineStarted, ensureEngineStarted, hasTauriRuntime, refreshAuthStateFromEngine, setError, setStatus]);

  const batchScheduler = useBatchScheduler({
    enabled: hasTauriRuntime,
    setStatus,
    providerAvailable: (provider: string) => {
      const webProvider = String(provider).replace(/^web\//, "");
      return (webBridgeStatus.connectedProviders ?? []).some((row) => row.provider === webProvider);
    },
    runBatchSchedule: async (schedule: BatchSchedule, trigger: BatchTriggerType) => {
      const webProvider = String(schedule.provider).replace(/^web\//, "");
      try {
        const result = await invoke<WebProviderRunResult>("web_provider_run", {
          provider: webProvider,
          prompt: schedule.query,
          timeoutMs: 90_000,
          mode: "auto",
        });
        if (result.ok) {
          return { ok: true };
        }
        if (trigger !== "schedule") {
          await onOpenProviderSession(webProvider as WebProvider);
        }
        return { ok: false, reason: result.error ?? "manual fallback required" };
      } catch (error) {
        if (trigger !== "schedule") {
          await onOpenProviderSession(webProvider as WebProvider);
        }
        return { ok: false, reason: `manual fallback required: ${String(error)}` };
      }
    },
  });

  useEngineEventListeners({
    hasTauriRuntime,
    listenFn: listen,
    extractDeltaText,
    activeTurnNodeIdRef,
    activeRunDeltaRef,
    authLoginRequiredProbeCountRef,
    lastAuthenticatedAtRef,
    setLoginCompleted,
    setStatus,
    refreshAuthStateFromEngine,
    extractAuthMode,
    setAuthMode,
    extractStringByPaths,
    webProviderOptions: WEB_PROVIDER_OPTIONS,
    activeWebNodeByProviderRef,
    normalizeWebBridgeProgressMessage,
    addNodeLog,
    setWebBridgeLogs,
    webProviderLabel,
    scheduleWebBridgeStageWarn,
    activeWebPromptRef,
    webBridgeClaimWarnMs: WEB_BRIDGE_CLAIM_WARN_MS,
    webBridgePromptFilledWarnMs: WEB_BRIDGE_PROMPT_FILLED_WARN_MS,
    clearWebBridgeStageWarnTimer,
    setWebWorkerHealth,
    isTurnTerminalEvent,
    turnTerminalResolverRef,
    reportSoftError,
    setPendingApprovals,
    lifecycleStateLabel,
    setEngineStarted,
    markCodexNodesStatusOnEngineIssue,
    setUsageInfoText,
    setApprovalSubmitting,
  });


  useMainAppRuntimeEffects({
    webBridgeStageWarnTimerRef,
    reportSoftError,
    refreshGraphFiles,
    refreshFeedTimeline,
    setStatus,
    feedReplyFeedbackClearTimerRef,
    workspaceTab,
    webProviderOptions: WEB_PROVIDER_OPTIONS,
    providerChildViewOpen,
    onCloseProviderChildView,
    pendingWebTurn,
    pendingWebTurnAutoOpenKeyRef,
    webTurnPanel,
    webTurnFloatingDefaultX: WEB_TURN_FLOATING_DEFAULT_X,
    webTurnFloatingDefaultY: WEB_TURN_FLOATING_DEFAULT_Y,
    webTurnFloatingRef,
    openUrlFn: openUrl,
    webProviderHomeUrl,
    webProviderLabel,
    setError,
    pendingWebLogin,
    pendingWebLoginAutoOpenKeyRef,
    invokeFn: invoke,
    refreshWebWorkerHealth,
    setFeedShareMenuPostId,
    nodeStates,
    setRuntimeNowMs,
  });

  const {
    ensureWebWorkerReady,
    resolvePendingWebLogin,
    onCopyPendingWebPrompt,
    onSubmitPendingWebTurn,
    onDismissPendingWebTurn,
    onReopenPendingWebTurn,
    onOpenWebInputForNode,
    onCancelPendingWebTurn,
  } = createWebInteractionHandlers({
    invokeFn: invoke,
    refreshWebWorkerHealth,
    webLoginResolverRef,
    setPendingWebLogin,
    pendingWebTurn,
    webTurnResolverRef,
    manualInputWaitNoticeByNodeRef,
    setStatus,
    normalizeWebTurnOutput,
    webResponseDraft,
    setError,
    resolvePendingWebTurn,
    webTurnPanel,
    setSuspendedWebTurn,
    setSuspendedWebResponseDraft,
    setPendingWebTurn,
    suspendedWebTurn,
    setWebResponseDraft,
    suspendedWebResponseDraft,
    webProviderLabel,
    clearDetachedWebTurnResolver,
    webTurnFloatingDefaultX: WEB_TURN_FLOATING_DEFAULT_X,
    webTurnFloatingDefaultY: WEB_TURN_FLOATING_DEFAULT_Y,
    webTurnQueueRef,
    activeWebProviderByNodeRef,
    webProviderOptions: WEB_PROVIDER_OPTIONS,
    activeWebNodeByProviderRef,
    manualWebFallbackNodeRef,
    activeWebPromptByNodeRef,
    activeWebPromptRef,
    graphNodes: graph.nodes,
    getWebProviderFromExecutor,
    getTurnExecutor,
    injectOutputLanguageDirective,
    locale,
    workflowQuestion,
    replaceInputPlaceholder,
    addNodeLog,
    t,
  });

  const {
    onRespondApproval,
    pickDefaultCanvasNodeId,
    applyPreset,
    applyCostPreset,
  } = createWorkflowPresetHandlers({
    activeApproval,
    invokeFn: invoke,
    setError,
    setApprovalSubmitting,
    setPendingApprovals,
    setStatus,
    approvalDecisionLabel,
    simpleWorkflowUi: SIMPLE_WORKFLOW_UI,
    buildPresetGraphByKind,
    applyPresetOutputSchemaPolicies,
    applyPresetTurnPolicies,
    simplifyPresetForSimpleWorkflow,
    localizePresetPromptTemplate,
    locale,
    injectOutputLanguageDirective,
    autoArrangeGraphLayout,
    normalizeKnowledgeConfig,
    graph,
    setGraph,
    cloneGraph,
    setUndoStack,
    setRedoStack,
    setNodeSelection,
    setSelectedEdgeKey,
    setNodeStates,
    setConnectFromNodeId,
    setConnectFromSide,
    setConnectPreviewStartPoint,
    setConnectPreviewPoint,
    setIsConnectingDrag,
    setMarqueeSelection,
    lastAppliedPresetRef,
    presetTemplateMeta: getPresetTemplateMeta(locale),
    setCostPreset,
    setModel,
    costPresetDefaultModel: COST_PRESET_DEFAULT_MODEL,
    costPresetLabel,
    getTurnExecutor,
    getCostPresetTargetModel,
    isCriticalTurnNode,
    toTurnModelDisplayName,
    defaultTurnModel: DEFAULT_TURN_MODEL,
    applyGraphChange,
    evaluateApprovalDecisionGate,
  });

  const {
    addNode,
    deleteNodes,
    deleteNode,
    hasUserTextSelection,
    copySelectedNodesToClipboard,
    pasteNodesFromClipboard,
    onNodeAnchorDragStart,
    onNodeAnchorDrop,
    onNodeConnectDrop,
  } = useWorkflowGraphActions({
    graph,
    canvasNodeIdSet,
    selectedNodeIds,
    getBoundedStageSize: () => ({ width: boundedStageWidth, height: boundedStageHeight }),
    canvasZoom,
    graphCanvasRef,
    graphClipboardRef,
    graphPasteSerialRef,
    connectFromNodeId,
    connectFromSide,
    setConnectFromNodeId,
    setConnectFromSide,
    setConnectPreviewStartPoint,
    setConnectPreviewPoint,
    setIsConnectingDrag,
    setMarqueeSelection,
    setNodeSelection,
    setSelectedEdgeKey,
    setNodeStates,
    setStatus,
    applyGraphChange,
    getNodeVisualSize,
  });


  const {
    clampCanvasZoom,
    scheduleZoomStatus,
    syncQuestionInputHeight,
    syncCanvasLogicalViewport,
    clientToLogicalPoint,
    snapConnectPreviewPoint,
    resolveConnectDropTarget,
    onEdgeDragStart,
    onAssignSelectedEdgeAnchor,
    reconnectSelectedEdgeEndpoint,
  } = createCanvasConnectionHandlers({
    minCanvasZoom: MIN_CANVAS_ZOOM,
    maxCanvasZoom: MAX_CANVAS_ZOOM,
    zoomStatusTimerRef,
    setStatus,
    questionInputRef,
    questionInputMaxHeight: QUESTION_INPUT_MAX_HEIGHT,
    graphCanvasRef,
    canvasZoom,
    graphStageInsetX: GRAPH_STAGE_INSET_X,
    graphStageInsetY: GRAPH_STAGE_INSET_Y,
    setCanvasLogicalViewport,
    getNodeVisualSize,
    canvasNodes,
    connectFromNodeId,
    getNodeAnchorPoint,
    setConnectPreviewPoint,
    panMode,
    isConnectingDrag,
    setNodeSelection,
    setSelectedEdgeKey,
    graph,
    getGraphEdgeKey,
    canvasNodeMap,
    getAutoConnectionSides,
    cloneGraph,
    edgeDragStartSnapshotRef,
    edgeDragRef,
    setConnectFromNodeId,
    setConnectFromSide,
    setConnectPreviewStartPoint,
    setIsConnectingDrag,
    selectedEdgeKey,
    applyGraphChange,
  });

  const {
    onNodeDragStart,
    onCanvasMouseMove,
    onCanvasMouseUp,
    onCanvasMouseDown,
    onCanvasWheel,
    onCanvasZoomIn,
    onCanvasZoomOut,
    onCanvasKeyDown,
  } = createCanvasDragZoomHandlers({
    graphCanvasRef,
    setCanvasZoom,
    graphStageInsetX: GRAPH_STAGE_INSET_X,
    graphStageInsetY: GRAPH_STAGE_INSET_Y,
    canvasZoom,
    dragRef,
    clientToLogicalPoint,
    nodeDragMargin: NODE_DRAG_MARGIN,
    getNodeVisualSize,
    getBoundedStageWidth: () => boundedStageWidth,
    getBoundedStageHeight: () => boundedStageHeight,
    setGraph,
    snapToLayoutGrid,
    autoLayoutDragSnapThreshold: AUTO_LAYOUT_DRAG_SNAP_THRESHOLD,
    autoLayoutSnapThreshold: AUTO_LAYOUT_SNAP_THRESHOLD,
    snapToNearbyNodeAxis,
    autoLayoutNodeAxisSnapThreshold: AUTO_LAYOUT_NODE_AXIS_SNAP_THRESHOLD,
    dragAutoPanFrameRef,
    dragPointerRef,
    panMode,
    canvasNodes,
    selectedNodeIds,
    setNodeSelection,
    cloneGraph,
    graph,
    dragStartSnapshotRef,
    setDraggingNodeIds,
    setMarqueeSelection,
    dragWindowMoveHandlerRef,
    dragWindowUpHandlerRef,
    panRef,
    isConnectingDrag,
    connectFromNodeId,
    snapConnectPreviewPoint,
    marqueeSelection,
    edgeDragRef,
    connectPreviewPoint,
    resolveConnectDropTarget,
    reconnectSelectedEdgeEndpoint,
    onNodeConnectDrop,
    setIsConnectingDrag,
    setConnectPreviewStartPoint,
    setConnectPreviewPoint,
    setConnectFromNodeId,
    setConnectFromSide,
    edgeDragStartSnapshotRef,
    setSelectedEdgeKey,
    graphEquals,
    setUndoStack,
    setRedoStack,
    clampCanvasZoom,
    scheduleZoomStatus,
  });

  const {
    updateNodeConfigById,
    updateSelectedNodeConfig,
    saveGraph,
    renameGraph,
    onOpenRenameGraph,
    onCloseRenameGraph,
    deleteGraph,
    loadGraph,
  } = useGraphFileActions({
    graph,
    graphFileName,
    selectedGraphFileName,
    graphRenameDraft,
    isGraphRunning,
    selectedNode,
    setError,
    refreshGraphFiles,
    setGraphFileName,
    setSelectedGraphFileName,
    setStatus,
    setGraphRenameDraft,
    setGraphRenameOpen,
    setGraph,
    setUndoStack,
    setRedoStack,
    setNodeSelection,
    setSelectedEdgeKey,
    setNodeStates,
    setConnectFromNodeId,
    setConnectFromSide,
    setConnectPreviewStartPoint,
    setConnectPreviewPoint,
    setIsConnectingDrag,
    setMarqueeSelection,
    lastAppliedPresetRef,
    pickDefaultCanvasNodeId,
    extractSelectedNodeId: (node) => node.id,
  });

  useMainAppStateEffects({
    canvasNodes,
    selectedNodeIds,
    selectedNodeId,
    setSelectedNodeIds,
    setSelectedNodeId,
    selectedEdgeKey,
    canvasDisplayEdges,
    setSelectedEdgeKey,
    cwd,
    workspaceCwdStorageKey: WORKSPACE_CWD_STORAGE_KEY,
    loginCompleted,
    loginCompletedStorageKey: LOGIN_COMPLETED_STORAGE_KEY,
    authMode,
    authModeStorageKey: AUTH_MODE_STORAGE_KEY,
    codexMultiAgentMode,
    codexMultiAgentModeStorageKey: CODEX_MULTI_AGENT_MODE_STORAGE_KEY,
    syncQuestionInputHeight,
    workflowQuestion,
    syncCanvasLogicalViewport,
    graphCanvasRef,
    canvasZoom,
    canvasFullscreen,
    workspaceTab,
    graph,
    nodeSizeMapRef,
    setNodeSizeVersion,
    dragAutoPanFrameRef,
    dragWindowMoveHandlerRef,
    dragWindowUpHandlerRef,
    edgeDragWindowMoveHandlerRef,
    edgeDragWindowUpHandlerRef,
    zoomStatusTimerRef,
    webTurnResolverRef,
    clearQueuedWebTurnRequests,
    isConnectingDrag,
    connectFromNodeId,
    clientToLogicalPoint,
    snapConnectPreviewPoint,
    onCanvasMouseUp,
  });

  useWorkflowShortcuts({
    workspaceTab,
    setWorkspaceTab,
    setStatus,
    canvasFullscreen,
    setCanvasFullscreen,
    selectedNodeId,
    selectedNodeIds,
    canvasNodes,
    canvasNodeIdSet,
    canvasDisplayEdges,
    selectedEdgeKey,
    setSelectedEdgeKey,
    setNodeSelection,
    applyGraphChange,
    deleteNodes,
    copySelectedNodesToClipboard,
    pasteNodesFromClipboard,
    hasUserTextSelection,
    setPanMode,
    graph,
  });
  webTurnRunHandlers = createWebTurnRunHandlers({
    exportRunFeedMarkdownFiles,
    cwd,
    invokeFn: invoke,
    feedRawAttachmentRef,
    setError,
    persistRunRecordFile,
    setLastSavedRunFile,
    refreshFeedTimeline,
    resolvePendingWebTurnAction,
    pendingWebTurn,
    webTurnResolverRef,
    webTurnQueueRef,
    webTurnPanel,
    manualInputWaitNoticeByNodeRef,
    setPendingWebTurn,
    setSuspendedWebTurn,
    setSuspendedWebResponseDraft,
    setWebResponseDraft,
    setStatus,
    webProviderLabel,
    webTurnFloatingDefaultX: WEB_TURN_FLOATING_DEFAULT_X,
    webTurnFloatingDefaultY: WEB_TURN_FLOATING_DEFAULT_Y,
    clearQueuedWebTurnRequestsAction,
    clearDetachedWebTurnResolverAction,
    suspendedWebTurn,
    suspendedWebResponseDraft,
    requestWebTurnResponseAction,
    addNodeLog,
    executeTurnNodeWithContext,
    model,
    locale,
    workflowQuestion,
    codexMultiAgentMode,
    forceAgentRulesAllTurns: FORCE_AGENT_RULES_ALL_TURNS,
    turnOutputSchemaEnabled: TURN_OUTPUT_SCHEMA_ENABLED,
    pauseErrorToken: PAUSE_ERROR_TOKEN,
    nodeStates,
    activeRunPresetKindRef,
    internalMemoryCorpusRef,
    activeWebNodeByProviderRef,
    activeWebPromptRef,
    activeWebProviderByNodeRef,
    activeWebPromptByNodeRef,
    manualWebFallbackNodeRef,
    pauseRequestedRef,
    cancelRequestedRef,
    activeTurnNodeIdRef,
    activeRunDeltaRef,
    turnTerminalResolverRef,
    consumeNodeRequests,
    setNodeStatus,
    setNodeRuntimeFields,
    ensureWebWorkerReady,
    clearWebBridgeStageWarnTimer,
    loadAgentRuleDocs,
    agentRuleCacheTtlMs: AGENT_RULE_CACHE_TTL_MS,
    agentRuleMaxDocs: AGENT_RULE_MAX_DOCS,
    agentRuleMaxDocChars: AGENT_RULE_MAX_DOC_CHARS,
    agentRulesCacheRef,
    injectKnowledgeContext,
    enabledKnowledgeFiles,
    graphKnowledge,
    openUrlFn: openUrl,
    t,
  });

  const {
    prepareRunGraphStart,
    cleanupRunGraphExecutionState,
    handleRunPauseIfNeeded,
    onCancelGraphRun,
  } = createRunGraphControlHandlers({
    cwd,
    setError,
    setStatus,
    collectRequiredWebProviders,
    graph,
    refreshWebBridgeStatus,
    webBridgeStatus,
    buildWebConnectPreflightReasons,
    webProviderLabel,
    t,
    setPendingWebConnectCheck,
    inferRunGroupMeta,
    lastAppliedPresetRef,
    locale,
    findDirectInputNodeIds,
    webBridgeStageWarnTimerRef,
    activeWebPromptRef,
    activeWebNodeByProviderRef,
    turnTerminalResolverRef,
    webTurnResolverRef,
    webLoginResolverRef,
    clearQueuedWebTurnRequests,
    manualInputWaitNoticeByNodeRef,
    setPendingWebTurn,
    setSuspendedWebTurn,
    setSuspendedWebResponseDraft,
    setPendingWebLogin,
    setWebResponseDraft,
    internalMemoryCorpusRef,
    activeRunPresetKindRef,
    activeTurnNodeIdRef,
    setIsGraphRunning,
    setIsGraphPaused,
    setIsRunStarting,
    runStartGuardRef,
    cancelRequestedRef,
    pauseRequestedRef,
    collectingRunRef,
    setActiveFeedRunMeta,
    isGraphRunning,
    pendingWebLogin,
    resolvePendingWebLogin,
    invokeFn: invoke,
    addNodeLog,
    clearWebBridgeStageWarnTimer,
    pendingWebTurn,
    suspendedWebTurn,
    resolvePendingWebTurn,
    pauseErrorToken: PAUSE_ERROR_TOKEN,
    nodeStates,
    cancelGraphRun,
  });

  const onRunGraphCore = createRunGraphRunner({
    isGraphRunning,
    isGraphPaused,
    pauseRequestedRef,
    setIsGraphPaused,
    runStartGuardRef,
    prepareRunGraphStart,
    setPendingWebConnectCheck,
    setIsRunStarting,
    setError,
    setStatus,
    setIsGraphRunning,
    cancelRequestedRef,
    collectingRunRef,
    createRunNodeStateSnapshot,
    graph,
    runLogCollectorRef,
    setNodeStates,
    createRunRecord,
    workflowQuestion,
    locale,
    setActiveFeedRunMeta,
    activeRunPresetKindRef,
    loadInternalMemoryCorpus,
    invokeFn: invoke,
    graphRequiresCodexEngine,
    ensureEngineStarted,
    buildGraphExecutionIndex,
    appendNodeEvidenceWithMemory,
    turnRoleLabel,
    nodeTypeLabel,
    normalizeEvidenceEnvelope,
    updateRunMemoryByEnvelope,
    enqueueZeroIndegreeNodes,
    setNodeStatus,
    appendRunTransition,
    resolveDagMaxThreads,
    codexMultiAgentMode,
    scheduleChildrenWhenReady,
    nodeSelectionLabel,
    resolveFeedInputSourcesForNode,
    buildNodeInputForNode,
    buildFinalTurnInputPacket,
    buildFeedPost,
    rememberFeedSource,
    feedRawAttachmentRef,
    feedAttachmentRawKey,
    setNodeRuntimeFields,
    t,
    executeTurnNodeWithOutputSchemaRetry,
    executeTurnNode,
    addNodeLog,
    validateSimpleSchema,
    turnOutputSchemaEnabled: TURN_OUTPUT_SCHEMA_ENABLED,
    turnOutputSchemaMaxRetry: TURN_OUTPUT_SCHEMA_MAX_RETRY,
    isPauseSignalError,
    buildQualityReport,
    cwd,
    executeTransformNode,
    executeGateNode,
    simpleWorkflowUi: SIMPLE_WORKFLOW_UI,
    handleRunPauseIfNeeded,
    scheduleRunnableGraphNodes,
    reportSoftError,
    buildConflictLedger,
    computeFinalConfidence,
    summarizeQualityMetrics,
    resolveFinalNodeId,
    extractFinalAnswer,
    buildFinalNodeFailureReason,
    nodeStatusLabel,
    buildRegressionSummary,
    saveRunRecord,
    normalizeRunRecord,
    feedRunCacheRef,
    validateUnifiedRunInput,
    buildRailCompatibleDagSnapshot,
    buildRunMissionFlow,
    buildRunApprovalSnapshot,
    buildRunUnityArtifacts,
    markCodexNodesStatusOnEngineIssue,
    cleanupRunGraphExecutionState,
  });
  const onRunGraph = async (skipWebConnectPreflight = false) => {
    batchScheduler.triggerByUserEvent();
    await onRunGraphCore(skipWebConnectPreflight);
  };
  const edgeLines = buildCanvasEdgeLines({
    entries: canvasDisplayEdges,
    nodeMap: canvasNodeMap,
    getNodeVisualSize,
  });
  const connectPreviewLine = buildConnectPreviewLine({
    connectFromNodeId,
    connectPreviewPoint,
    connectPreviewStartPoint,
    connectFromSide,
    canvasNodeMap,
    getNodeVisualSize,
    getNodeAnchorPointFn: getNodeAnchorPoint,
    buildRoundedEdgePathFn: buildRoundedEdgePath,
  });

  const selectedTurnConfig: TurnConfig | null =
    selectedNode?.type === "turn" ? (selectedNode.config as TurnConfig) : null;
  const selectedTurnExecutor: TurnExecutor =
    selectedTurnConfig ? getTurnExecutor(selectedTurnConfig) : "codex";
  const selectedQualityProfile: QualityProfileId =
    selectedNode?.type === "turn" && selectedTurnConfig
      ? inferQualityProfile(selectedNode, selectedTurnConfig)
      : "generic";
  const selectedQualityThresholdOption = String(
    normalizeQualityThreshold(selectedTurnConfig?.qualityThreshold ?? QUALITY_DEFAULT_THRESHOLD),
  );
  const selectedArtifactType: ArtifactType = toArtifactType(selectedTurnConfig?.artifactType);
  const qualityProfileOptions = useMemo(() => getQualityProfileOptions(locale), [locale]);
  const qualityThresholdOptions = useMemo(() => getQualityThresholdOptions(locale), [locale]);
  const artifactTypeOptions = useMemo(() => getArtifactTypeOptions(locale), [locale]);
  const costPresetOptions = useMemo(() => getCostPresetOptions(locale), [locale]);
  const codexMultiAgentModeOptions = useMemo(() => getCodexMultiAgentModeOptions(locale), [locale]);
  const presetTemplateOptions = useMemo(() => getPresetTemplateOptions(locale), [locale]);
  const knowledgeTopKOptions = useMemo(
    () => KNOWLEDGE_TOP_K_OPTIONS.map((option) => ({ ...option, label: tp(option.label) })),
    [locale],
  );
  const knowledgeMaxCharsOptions = useMemo(
    () => KNOWLEDGE_MAX_CHARS_OPTIONS.map((option) => ({ ...option, label: tp(option.label) })),
    [locale],
  );
  const outgoingFromSelected = selectedNode
    ? graph.edges
        .filter((edge) => edge.from.nodeId === selectedNode.id)
        .map((edge) => edge.to.nodeId)
        .filter((value, index, arr) => arr.indexOf(value) === index)
    : [];
  const outgoingNodeOptions = outgoingFromSelected.map((nodeId) => {
    const target = graph.nodes.find((node) => node.id === nodeId);
    return {
      value: nodeId,
      label: target ? nodeSelectionLabel(target) : t("workflow.node.connection"),
    };
  });
  const canResumeGraph = isGraphRunning && isGraphPaused;
  const isWorkflowBusy = (isGraphRunning && !isGraphPaused) || isRunStarting;
  const canClearGraph = !isWorkflowBusy && (graph.nodes.length > 0 || graph.edges.length > 0);
  const isWorkspaceCwdConfigured = String(cwd ?? "").trim().length > 0 && String(cwd ?? "").trim() !== ".";
  const canRunGraphNow =
    canResumeGraph ||
    (isWorkspaceCwdConfigured && !isWorkflowBusy && graph.nodes.length > 0 && workflowQuestion.trim().length > 0);
  const {
    currentFeedPosts,
    feedCategoryPosts,
    feedInspectorEditable,
    feedInspectorEditableNodeId,
    feedInspectorGraphNode,
    feedInspectorPost,
    feedInspectorPostKey,
    feedInspectorPostNodeId,
    feedInspectorPostSourceFile,
    feedInspectorPromptTemplate,
    feedInspectorQualityProfile,
    feedInspectorQualityThresholdOption,
    feedInspectorRuleCwd,
    feedInspectorTurnConfig,
    feedInspectorTurnExecutor,
    feedInspectorTurnNode,
    groupedFeedRuns,
  } = computeFeedDerivedState({
    activeFeedRunMeta,
    graph,
    nodeStates,
    feedPosts,
    feedStatusFilter,
    feedExecutorFilter,
    feedPeriodFilter,
    feedKeyword,
    feedCategory,
    feedRunCache: feedRunCacheRef.current,
    feedInspectorPostId,
    feedInspectorSnapshotNode,
    cwd: resolveNodeCwd(cwd, cwd),
    nodeTypeLabelFn: nodeTypeLabel,
    turnRoleLabelFn: turnRoleLabel,
    turnModelLabelFn: turnModelLabel,
  });

  const feedCategoryMeta: Array<{ key: FeedCategory; label: string }> = [
    { key: "all_posts", label: t("feed.category.all_posts") },
    { key: "completed_posts", label: t("feed.category.completed_posts") },
    { key: "web_posts", label: t("feed.category.web_posts") },
    { key: "error_posts", label: t("feed.category.error_posts") },
  ];

  const loadFeedInspectorRuleDocs = useCallback(
    (nodeCwd: string) =>
      loadAgentRuleDocs({
        nodeCwd,
        cwd,
        cacheTtlMs: AGENT_RULE_CACHE_TTL_MS,
        maxDocs: AGENT_RULE_MAX_DOCS,
        maxDocChars: AGENT_RULE_MAX_DOC_CHARS,
        agentRulesCacheRef,
        invokeFn: invoke,
      }),
    [cwd, agentRulesCacheRef],
  );

  useFeedInspectorEffects({
    groupedFeedRuns,
    setFeedGroupExpandedByRunId,
    setFeedGroupRenameRunId,
    workspaceTab,
    currentFeedPosts,
    setFeedInspectorPostId,
    feedInspectorPost,
    feedInspectorGraphNode,
    feedInspectorPostSourceFile,
    feedInspectorPostNodeId,
    feedInspectorPostKey,
    ensureFeedRunRecord,
    setFeedInspectorSnapshotNode,
    feedInspectorRuleCwd,
    setFeedInspectorRuleDocs,
    setFeedInspectorRuleLoading,
    loadAgentRuleDocsForCwd: loadFeedInspectorRuleDocs,
  });

  const onAddCrawlerNode = useCallback(() => {
    const nodeId = makeNodeId("turn");
    const maxX = graph.nodes.reduce((max, node) => Math.max(max, Number(node.position?.x ?? 0)), 40);
    const maxY = graph.nodes.reduce((max, node) => Math.max(max, Number(node.position?.y ?? 0)), 40);
    const nextNode: GraphNode = {
      id: nodeId,
      type: "turn",
      position: {
        x: maxX + 300,
        y: Math.max(40, maxY),
      },
      config: {
        ...defaultNodeConfig("turn"),
        role: "Crawler Operator",
        promptTemplate:
          "Allowlist 소스를 기준으로 최신 데이터를 수집하고 핵심 시그널/출처를 간결하게 정리해줘.",
        qualityProfile: "research_evidence",
        artifactType: "EvidenceArtifact",
      },
    };
    applyGraphChange((prev) => ({
      ...prev,
      nodes: [...prev.nodes, nextNode],
    }));
    setNodeSelection([nodeId], nodeId);
    appendWorkspaceEvent({
      source: "workflow",
      message: "크롤러 노드 추가",
      actor: "user",
      level: "info",
    });
    setStatus("그래프에 크롤러 노드를 추가했습니다.");
  }, [appendWorkspaceEvent, applyGraphChange, graph.nodes, setNodeSelection, setStatus]);

  const viewportWidth = Math.ceil(canvasLogicalViewport.width);
  const viewportHeight = Math.ceil(canvasLogicalViewport.height);
  const stagePadding = canvasNodes.length > 0 ? STAGE_GROW_MARGIN : 0;
  const maxNodeRight = canvasNodes.reduce((max, node) => Math.max(max, node.position.x + NODE_WIDTH), 0);
  const maxNodeBottom = canvasNodes.reduce((max, node) => Math.max(max, node.position.y + NODE_HEIGHT), 0);
  const softMaxWidth = viewportWidth + STAGE_GROW_LIMIT;
  const softMaxHeight = viewportHeight + STAGE_GROW_LIMIT;
  const stageWidth = Math.max(
    viewportWidth,
    Math.min(softMaxWidth, Math.max(viewportWidth, maxNodeRight + stagePadding)),
  );
  const stageHeight = Math.max(
    viewportHeight,
    Math.min(softMaxHeight, Math.max(viewportHeight, maxNodeBottom + stagePadding)),
  );
  const boundedStageWidth = Math.min(stageWidth, MAX_STAGE_WIDTH);
  const boundedStageHeight = Math.min(stageHeight, MAX_STAGE_HEIGHT);
  const workflowInspectorPaneProps = buildWorkflowInspectorPaneProps({
    nodeProps: {
      artifactTypeOptions: [...artifactTypeOptions],
      cwd,
      model,
      nodeSettingsTitle: t("workflow.nodeSettings"),
      normalizeQualityThreshold,
      outgoingNodeOptions,
      qualityProfileOptions: [...qualityProfileOptions],
      qualityThresholdOptions: [...qualityThresholdOptions],
      selectedArtifactType,
      selectedNode,
      selectedQualityProfile,
      selectedQualityThresholdOption,
      selectedTurnConfig,
      selectedTurnExecutor,
      simpleWorkflowUI: SIMPLE_WORKFLOW_UI,
      turnExecutorLabel,
      turnExecutorOptions: [...TURN_EXECUTOR_OPTIONS],
      turnModelOptions: [...TURN_MODEL_OPTIONS],
      updateSelectedNodeConfig,
    },
    toolsProps: {
      addNode,
      addCrawlerNode: onAddCrawlerNode,
      applyCostPreset,
      applyGraphChange,
      applyPreset,
      costPreset,
      costPresetOptions: [...costPresetOptions],
      defaultKnowledgeConfig,
      deleteGraph,
      graphFiles,
      graphKnowledge,
      graphRenameDraft,
      graphRenameOpen,
      isCostPreset,
      isPresetKind,
      knowledgeDefaultMaxChars: KNOWLEDGE_DEFAULT_MAX_CHARS,
      knowledgeDefaultTopK: KNOWLEDGE_DEFAULT_TOP_K,
      knowledgeMaxCharsOptions: [...knowledgeMaxCharsOptions],
      knowledgeTopKOptions: [...knowledgeTopKOptions],
      loadGraph,
      onCloseRenameGraph,
      onOpenKnowledgeFilePicker,
      onOpenRenameGraph,
      onRemoveKnowledgeFile,
      onToggleKnowledgeFileEnabled,
      presetTemplateOptions: [...presetTemplateOptions],
      refreshGraphFiles,
      renameGraph,
      saveGraph,
      selectedGraphFileName,
      selectedKnowledgeMaxCharsOption,
      setGraphFileName,
      setGraphRenameDraft,
      setSelectedGraphFileName,
      simpleWorkflowUI: SIMPLE_WORKFLOW_UI,
    },
  });
  const feedPageVm = buildFeedPageVm({
    feedInspectorTurnNode,
    feedInspectorPost,
    feedInspectorEditable,
    feedInspectorEditableNodeId,
    feedInspectorTurnExecutor,
    feedInspectorTurnConfig,
    feedInspectorQualityProfile,
    feedInspectorQualityThresholdOption,
    feedInspectorPromptTemplate,
    updateNodeConfigById,
    turnModelLabel,
    turnRoleLabel,
    TURN_EXECUTOR_OPTIONS,
    turnExecutorLabel,
    TURN_MODEL_OPTIONS,
    toTurnModelDisplayName,
    DEFAULT_TURN_MODEL,
    getWebProviderFromExecutor,
    normalizeWebResultMode,
    cwd,
    QUALITY_PROFILE_OPTIONS: qualityProfileOptions,
    normalizeQualityThreshold,
    QUALITY_THRESHOLD_OPTIONS: qualityThresholdOptions,
    ARTIFACT_TYPE_OPTIONS: artifactTypeOptions,
    toArtifactType,
    feedFilterOpen,
    setFeedFilterOpen,
    setFeedStatusFilter,
    setFeedExecutorFilter,
    setFeedPeriodFilter,
    setFeedKeyword,
    feedStatusFilter,
    feedExecutorFilter,
    feedPeriodFilter,
    feedKeyword,
    feedCategoryMeta,
    feedCategory,
    feedCategoryPosts,
    setFeedCategory,
    feedShareMenuPostId,
    setFeedShareMenuPostId,
    feedLoading,
    currentFeedPosts,
    groupedFeedRuns,
    feedGroupExpandedByRunId,
    setFeedGroupExpandedByRunId,
    feedGroupRenameRunId,
    setFeedGroupRenameRunId,
    setFeedGroupRenameDraft,
    feedGroupRenameDraft,
    onSubmitFeedRunGroupRename,
    toHumanReadableFeedText,
    hashStringToHue,
    buildFeedAvatarLabel,
    pendingNodeRequests,
    feedReplyDraftByPost,
    feedReplySubmittingByPost,
    feedReplyFeedbackByPost,
    feedExpandedByPost,
    onShareFeedPost,
    onDeleteFeedRunGroup,
    setFeedExpandedByPost,
    formatFeedInputSourceLabel,
    formatRunDateTime,
    formatRelativeFeedTime,
    formatDuration,
    formatUsage,
    setFeedReplyDraftByPost,
    onSubmitFeedAgentRequest,
    onOpenFeedMarkdownFile,
    graphNodes: graph.nodes,
    setFeedInspectorPostId,
    setNodeSelection,
  });
  const onSelectWorkspaceTab = (tab: WorkspaceTab) => {
    const nextTab = tab === "bridge" ? "settings" : tab;
    if (nextTab !== workspaceTab) {
      workspaceForwardStackRef.current = [];
    }
    if (nextTab !== workspaceTab) {
      appendWorkspaceEvent({
        source: "navigation",
        message: `탭 이동: ${workspaceTab} -> ${nextTab}`,
        actor: "user",
        level: "info",
      });
    }
    setWorkspaceTab(nextTab);
    if (nextTab !== "dashboard") {
      setDashboardDetailTopic(null);
    }
  };
  useEffect(() => {
    const next = String(status ?? "").trim();
    if (!next || lastLoggedStatusRef.current === next) {
      return;
    }
    lastLoggedStatusRef.current = next;
    appendWorkspaceEvent({
      source: "status",
      message: next,
      actor: "ai",
      level: "info",
    });
  }, [appendWorkspaceEvent, status]);
  useEffect(() => {
    const next = String(error ?? "").trim();
    if (!next || lastLoggedErrorRef.current === next) {
      return;
    }
    lastLoggedErrorRef.current = next;
    appendWorkspaceEvent({
      source: "error",
      message: next,
      actor: "system",
      level: "error",
    });
  }, [appendWorkspaceEvent, error]);
  useEffect(() => {
    if (suppressWorkspaceHistoryPushRef.current) {
      suppressWorkspaceHistoryPushRef.current = false;
      return;
    }
    workspaceForwardStackRef.current = [];
    const stack = workspaceBackStackRef.current;
    if (stack.length === 0 || stack[stack.length - 1] !== workspaceTab) {
      stack.push(workspaceTab);
      if (stack.length > 40) {
        stack.splice(0, stack.length - 40);
      }
    }
  }, [workspaceTab]);
  const onNavigateWorkspaceBack = useCallback(() => {
    if (dashboardDetailTopic) {
      setDashboardDetailTopic(null);
      return;
    }
    const forwardStack = workspaceForwardStackRef.current;
    const stack = workspaceBackStackRef.current;
    if (stack.length <= 1) {
      return;
    }
    const current = stack.pop();
    if (current && (forwardStack.length === 0 || forwardStack[forwardStack.length - 1] !== current)) {
      forwardStack.push(current);
      if (forwardStack.length > 40) {
        forwardStack.splice(0, forwardStack.length - 40);
      }
    }
    let previous = stack[stack.length - 1];
    while (previous === current && stack.length > 1) {
      stack.pop();
      previous = stack[stack.length - 1];
    }
    if (!previous) {
      return;
    }
    suppressWorkspaceHistoryPushRef.current = true;
    setWorkspaceTab(previous);
  }, [dashboardDetailTopic]);
  const onNavigateWorkspaceForward = useCallback(() => {
    const forwardStack = workspaceForwardStackRef.current;
    if (forwardStack.length === 0) {
      return;
    }
    const next = forwardStack.pop();
    if (!next) {
      return;
    }
    const backStack = workspaceBackStackRef.current;
    if (backStack.length === 0 || backStack[backStack.length - 1] !== next) {
      backStack.push(next);
      if (backStack.length > 40) {
        backStack.splice(0, backStack.length - 40);
      }
    }
    suppressWorkspaceHistoryPushRef.current = true;
    setWorkspaceTab(next);
  }, []);
  useEffect(() => {
    const onMouseHistoryButton = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        onNavigateWorkspaceBack();
        return;
      }
      if (event.button === 4) {
        event.preventDefault();
        onNavigateWorkspaceForward();
      }
    };
    window.addEventListener("mousedown", onMouseHistoryButton);
    return () => window.removeEventListener("mousedown", onMouseHistoryButton);
  }, [onNavigateWorkspaceBack, onNavigateWorkspaceForward]);
  const applyTurnExecutionFromModelSelection = useCallback(
    (selection: {
      executor: TurnExecutor;
      turnModel?: string;
      modelLabel: string;
      sourceLabel: string;
    }) => {
      const selectedTurnNodeIds = graph.nodes
        .filter((node) => node.type === "turn" && selectedNodeIds.includes(node.id))
        .map((node) => node.id);
      const fallbackTurnNodeId = graph.nodes.find((node) => node.type === "turn")?.id;
      const targetTurnNodeIds = selectedTurnNodeIds.length > 0 ? selectedTurnNodeIds : fallbackTurnNodeId ? [fallbackTurnNodeId] : [];

      if (targetTurnNodeIds.length === 0) {
        setStatus(`${selection.sourceLabel}: 적용할 턴 노드가 없습니다.`);
        return;
      }

      for (const nodeId of targetTurnNodeIds) {
        updateNodeConfigById(nodeId, "executor", selection.executor);
        if (selection.executor === "codex") {
          updateNodeConfigById(nodeId, "model", selection.turnModel ?? DEFAULT_TURN_MODEL);
        } else {
          updateNodeConfigById(nodeId, "webResultMode", "bridgeAssisted");
        }
      }

      const targetLabel = targetTurnNodeIds.length > 1 ? `${targetTurnNodeIds.length}개 턴` : targetTurnNodeIds[0];
      setStatus(`${selection.sourceLabel}: ${targetLabel} 실행 모델을 ${selection.modelLabel}로 설정했습니다.`);
    },
    [graph.nodes, selectedNodeIds, setStatus, updateNodeConfigById],
  );

  const onAgentQuickAction = (request: AgentQuickActionRequest) => {
    appendWorkspaceEvent({
      source: "agents",
      message: `에이전트 요청 전송: ${request.modelLabel}`,
      actor: "user",
      level: "info",
    });
    applyTurnExecutionFromModelSelection({
      executor: request.executor,
      turnModel: request.turnModel,
      modelLabel: request.modelLabel,
      sourceLabel: "에이전트",
    });
    setWorkflowQuestion(request.prompt);
    setWorkspaceTab("workflow");
  };
  const openAgentWorkspaceForTopic = useCallback(
    (topic: DashboardTopicId, draft?: string) => {
      agentLaunchRequestSeqRef.current += 1;
      setAgentLaunchRequest({
        id: agentLaunchRequestSeqRef.current,
        setId: `data-${topic}`,
        draft,
      });
      setWorkspaceTab("agents");
      appendWorkspaceEvent({
        source: "data",
        message: `에이전트 실행 요청: ${topic}`,
        actor: "user",
        level: "info",
      });
      setStatus(`${t(`dashboard.widget.${topic}.title`)} 실행 요청을 에이전트 탭으로 전달했습니다.`);
    },
    [appendWorkspaceEvent, setStatus, t],
  );
  const onOpenAgentsWorkspaceFromData = useCallback(() => {
    setWorkspaceTab("agents");
    setStatus("에이전트 탭에서 데이터 파이프라인 실행을 시작할 수 있습니다.");
  }, [setStatus]);
  const onRequestDashboardTopicRunInAgents = useCallback(
    (topic: DashboardTopicId, followupInstruction?: string) => {
      openAgentWorkspaceForTopic(topic, followupInstruction);
    },
    [openAgentWorkspaceForTopic],
  );
  const onRunDashboardTopicFromAgents = useCallback(
    async (topic: DashboardTopicId, followupInstruction?: string) => {
      if (!loginCompleted) {
        setError("Codex 로그인이 필요합니다. 설정에서 먼저 로그인해 주세요.");
        setWorkspaceTab("settings");
        return;
      }
      setStatus(`에이전트 실행: ${t(`dashboard.widget.${topic}.title`)} 파이프라인 시작`);
      await runDashboardTopic(topic, followupInstruction);
      await refreshDashboardSnapshots();
    },
    [loginCompleted, refreshDashboardSnapshots, runDashboardTopic, setError, setStatus, t],
  );
  const workspaceTopbarTabs = useMemo(
    () => [
      { tab: "dashboard" as WorkspaceTab, label: "대시보드" },
      { tab: "intelligence" as WorkspaceTab, label: "데이터" },
      { tab: "agents" as WorkspaceTab, label: "에이전트" },
      { tab: "workflow" as WorkspaceTab, label: "그래프" },
      { tab: "feed" as WorkspaceTab, label: "피드" },
      { tab: "settings" as WorkspaceTab, label: "설정" },
    ],
    [],
  );

  const quickPanelWorkspaceLabel = useMemo(() => {
    const byTab: Record<WorkspaceTab, string> = {
      dashboard: "홈 오버뷰",
      intelligence: "대시보드 인텔리전스",
      agents: "에이전트 채팅",
      workflow: "워크플로우",
      feed: "요점 정리",
      settings: "설정",
      bridge: "설정",
    };
    return byTab[workspaceTab] ?? "워크스페이스";
  }, [workspaceTab]);
  const quickPanelRecentPosts = useMemo(
    () =>
      [...feedPosts]
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, 5)
        .map((post) => ({
          id: post.id,
          title: post.summary.trim().slice(0, 90) || ("[" + post.agentName + "] " + post.status),
          meta: post.agentName + " · " + formatRelativeFeedTime(post.createdAt),
        })),
    [feedPosts],
  );
  const onToggleQuickPanel = () => {
    setQuickPanelOpen((prev) => !prev);
  };
  const onCloseQuickPanel = () => {
    setQuickPanelOpen(false);
  };
  const onOpenQuickPanelFeed = () => {
    setWorkspaceTab("feed");
    setFeedCategory("all_posts");
    setFeedStatusFilter("all");
    setFeedKeyword("");
    setQuickPanelOpen(false);
  };
  const onOpenQuickPanelAgents = () => {
    setWorkspaceTab("agents");
    setQuickPanelOpen(false);
  };
  const onSubmitQuickPanelQuery = () => {
    const next = quickPanelQuery.trim();
    if (!next) {
      setWorkspaceTab("agents");
      setQuickPanelOpen(false);
      return;
    }
    setWorkflowQuestion(next);
    setWorkspaceTab("workflow");
    setStatus("우측 패널 입력이 워크플로우에 반영되었습니다.");
    setQuickPanelQuery("");
    setQuickPanelOpen(false);
  };
  useEffect(() => {
    const onQuickPanelHotkey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "k") {
        event.preventDefault();
        setQuickPanelOpen((prev) => !prev);
        return;
      }
      if (event.key === "Escape") {
        setQuickPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onQuickPanelHotkey);
    return () => window.removeEventListener("keydown", onQuickPanelHotkey);
  }, []);
  useEffect(() => {
    if (canvasFullscreen) {
      setQuickPanelOpen(false);
    }
  }, [canvasFullscreen]);
  useEffect(() => {
    saveToLocalStorageSafely(USER_BG_IMAGE_STORAGE_KEY, userBackgroundImage);
  }, [USER_BG_IMAGE_STORAGE_KEY, userBackgroundImage]);
  useEffect(() => {
    saveToLocalStorageSafely(USER_BG_OPACITY_STORAGE_KEY, String(userBackgroundOpacity));
  }, [USER_BG_OPACITY_STORAGE_KEY, userBackgroundOpacity]);
  const appShellStyle = useMemo(
    () =>
      ({
        "--user-bg-image": toCssBackgroundImageValue(userBackgroundImage),
        "--user-bg-opacity": userBackgroundImage ? String(userBackgroundOpacity) : "0",
      }) as CSSProperties,
    [userBackgroundImage, userBackgroundOpacity],
  );
  useEffect(() => {
    if (!hasTauriRuntime) {
      return;
    }
    const baseCwd = String(cwd ?? "").trim();
    if (!baseCwd || workspaceEvents.length === 0) {
      return;
    }
    if (workspaceEventPersistTimerRef.current != null) {
      window.clearTimeout(workspaceEventPersistTimerRef.current);
      workspaceEventPersistTimerRef.current = null;
    }
    workspaceEventPersistTimerRef.current = window.setTimeout(() => {
      const eventsDir = `${baseCwd.replace(/[\\/]+$/, "")}/.rail/dashboard/events`;
      const fileName = workspaceEventLogFileName();
      const markdown = workspaceEventLogToMarkdown(workspaceEvents);
      void invoke<string>("workspace_write_markdown", {
        cwd: eventsDir,
        name: fileName,
        content: markdown,
      }).catch(() => {
        // Ignore persistence failures to avoid blocking UI interactions.
      });
    }, 450);
    return () => {
      if (workspaceEventPersistTimerRef.current != null) {
        window.clearTimeout(workspaceEventPersistTimerRef.current);
        workspaceEventPersistTimerRef.current = null;
      }
    };
  }, [cwd, hasTauriRuntime, workspaceEvents]);
  return (
    <main className={`app-shell ${canvasFullscreen ? "canvas-fullscreen-mode" : ""}`} style={appShellStyle}>
      <div aria-hidden="true" className="window-drag-region" data-tauri-drag-region />
      <AppNav
        activeTab={workspaceTab}
        onSelectTab={onSelectWorkspaceTab}
        renderIcon={(tab, active) => <NavIcon active={active} tab={tab} />}
      />

      <section
        className={`workspace ${canvasFullscreen ? "canvas-fullscreen-active" : ""} ${error ? "workspace-has-error" : ""}`.trim()}
      >
        {!canvasFullscreen && <header className="workspace-header workspace-header-spacer" />}
        {!canvasFullscreen && (
          <div className="workspace-topbar">
            <nav aria-label="Workspace top navigation" className="workspace-topbar-nav">
              {workspaceTopbarTabs.map((item) => {
                const active = workspaceTab === item.tab;
                return (
                  <button
                    className={active ? "workspace-topbar-tab is-active" : "workspace-topbar-tab"}
                    key={item.tab}
                    onClick={() => onSelectWorkspaceTab(item.tab)}
                    type="button"
                  >
                    <span aria-hidden="true" className="workspace-topbar-tab-icon">
                      <NavIcon active={active} tab={item.tab} />
                    </span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="workspace-topbar-actions">
              <WorkspaceQuickPanel
                isOpen={quickPanelOpen}
                onChangeQuery={setQuickPanelQuery}
                onClose={onCloseQuickPanel}
                onOpenAgents={onOpenQuickPanelAgents}
                onOpenFeed={onOpenQuickPanelFeed}
                onSubmitQuery={onSubmitQuickPanelQuery}
                onToggle={onToggleQuickPanel}
                query={quickPanelQuery}
                recentPosts={quickPanelRecentPosts}
                workspaceLabel={quickPanelWorkspaceLabel}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="error">
            <span>{t("feed.status.failed")}: {error}</span>
            <button
              aria-label={t("common.close")}
              className="error-close"
              onClick={() => setError("")}
              type="button"
            >
              ×
            </button>
          </div>
        )}

        {workspaceTab === "workflow" && (
          <WorkflowPage canvasFullscreen={canvasFullscreen}>
            <WorkflowCanvasPane
              boundedStageHeight={boundedStageHeight}
              boundedStageWidth={boundedStageWidth}
              canRunGraphNow={canRunGraphNow}
              canvasFullscreen={canvasFullscreen}
              canvasNodes={canvasNodes}
              canvasZoom={canvasZoom}
              connectPreviewLine={connectPreviewLine}
              deleteNode={deleteNode}
              draggingNodeIds={draggingNodeIds}
              edgeLines={edgeLines}
              formatNodeElapsedTime={formatNodeElapsedTime}
              graphCanvasRef={graphCanvasRef}
              isConnectingDrag={isConnectingDrag}
              isGraphRunning={isGraphRunning}
              isNodeDragAllowedTarget={isNodeDragAllowedTarget}
              isWorkflowBusy={isWorkflowBusy}
              marqueeSelection={marqueeSelection}
              nodeAnchorSides={NODE_ANCHOR_SIDES}
              nodeCardSummary={nodeCardSummary}
              nodeStates={nodeStates}
              nodeStatusLabel={nodeStatusLabel}
              nodeTypeLabel={nodeTypeLabel}
              onCancelGraphRun={onCancelGraphRun}
              onCanvasKeyDown={onCanvasKeyDown}
              onCanvasMouseDown={onCanvasMouseDown}
              onCanvasMouseMove={onCanvasMouseMove}
              onCanvasMouseUp={onCanvasMouseUp}
              onCanvasWheel={onCanvasWheel}
              onCanvasZoomIn={onCanvasZoomIn}
              onCanvasZoomOut={onCanvasZoomOut}
              onEdgeDragStart={onEdgeDragStart}
              onAssignSelectedEdgeAnchor={onAssignSelectedEdgeAnchor}
              onNodeAnchorDragStart={onNodeAnchorDragStart}
              onNodeAnchorDrop={onNodeAnchorDrop}
              onNodeDragStart={onNodeDragStart}
              onOpenFeedFromNode={(nodeId) => {
                setWorkspaceTab("feed");
                setFeedCategory("all_posts");
                setFeedStatusFilter("all");
                setFeedKeyword("");
                setStatus(`피드에서 ${nodeId} 노드 결과를 확인하세요.`);
              }}
              onOpenWebInputForNode={onOpenWebInputForNode}
              onClearGraph={onClearGraphCanvas}
              onRedoGraph={onRedoGraph}
              onReopenPendingWebTurn={onReopenPendingWebTurn}
              onRunGraph={onRunGraph}
              onUndoGraph={onUndoGraph}
              panMode={panMode}
              pendingWebTurn={pendingWebTurn}
              questionDirectInputNodeIds={questionDirectInputNodeIds}
              questionInputRef={questionInputRef}
              redoStackLength={redoStack.length}
              runtimeNowMs={runtimeNowMs}
              selectedEdgeKey={selectedEdgeKey}
              selectedEdgeNodeIdSet={selectedEdgeNodeIdSet}
              selectedNodeIds={selectedNodeIds}
              setCanvasFullscreen={setCanvasFullscreen}
              setNodeSelection={setNodeSelection}
              setPanMode={setPanMode}
              setSelectedEdgeKey={setSelectedEdgeKey}
              onApplyModelSelection={(selection) =>
                applyTurnExecutionFromModelSelection({
                  executor: selection.executor,
                  turnModel: selection.turnModel,
                  modelLabel: selection.modelLabel,
                  sourceLabel: "그래프 입력",
                })
              }
              setWorkflowQuestion={setWorkflowQuestion}
              stageInsetX={GRAPH_STAGE_INSET_X}
              stageInsetY={GRAPH_STAGE_INSET_Y}
              stageInsetBottom={GRAPH_STAGE_INSET_BOTTOM}
              suspendedWebTurn={suspendedWebTurn}
              turnModelLabel={turnModelLabel}
              turnRoleLabel={turnRoleLabel}
              canClearGraph={canClearGraph}
              undoStackLength={undoStack.length}
              workflowQuestion={workflowQuestion}
            />

            <WorkflowInspectorPane
              canvasFullscreen={canvasFullscreen}
              nodeProps={workflowInspectorPaneProps.nodeProps}
              toolsProps={workflowInspectorPaneProps.toolsProps}
            />
          </WorkflowPage>
        )}
        {workspaceTab === "dashboard" && (
          <DashboardPage
            connectedProviderCount={webBridgeStatus.connectedProviders.length}
            enabledScheduleCount={batchScheduler.schedules.filter((item) => item.status === "enabled").length}
            focusTopic={dashboardDetailTopic}
            isGraphRunning={isGraphRunning}
            onFocusTopic={(topic) => setDashboardDetailTopic(topic)}
            pendingApprovalsCount={pendingApprovals.length}
            runStateByTopic={dashboardIntelligenceRunStateByTopic}
            scheduleCount={batchScheduler.schedules.length}
            stockDocumentPosts={feedPosts}
            topicSnapshots={dashboardSnapshotsByTopic}
            webBridgeRunning={webBridgeStatus.running}
            workspaceEvents={workspaceEvents}
          />
        )}

        {workspaceTab === "feed" && (
          <FeedPage vm={feedPageVm} />
        )}
        {workspaceTab === "agents" && (
          <AgentsPage
            codexMultiAgentMode={codexMultiAgentMode}
            launchRequest={agentLaunchRequest}
            onQuickAction={onAgentQuickAction}
            onOpenDataTab={() => onSelectWorkspaceTab("intelligence")}
            onRunDataTopic={onRunDashboardTopicFromAgents}
            runStateByTopic={dashboardIntelligenceRunStateByTopic}
            topicSnapshots={dashboardSnapshotsByTopic}
          />
        )}

        {workspaceTab === "settings" && (
          <section className="panel-card settings-view workspace-tab-panel">
            <SettingsPage
              authModeText={authModeLabel(authMode)}
              codexAuthBusy={codexAuthBusy}
              compact={false}
              cwd={cwd}
              engineStarted={engineStarted}
              isGraphRunning={isGraphRunning}
              loginCompleted={loginCompleted}
              codexMultiAgentMode={codexMultiAgentMode}
              codexMultiAgentModeOptions={[...codexMultiAgentModeOptions]}
              userBackgroundImage={userBackgroundImage}
              userBackgroundOpacity={userBackgroundOpacity}
              onCheckUsage={() => void onCheckUsage()}
              onCloseUsageResult={() => setUsageResultClosed(true)}
              onOpenRunsFolder={() => void onOpenRunsFolder()}
              onSelectCwdDirectory={() => void onSelectCwdDirectory()}
              onSetCodexMultiAgentMode={(next) => setCodexMultiAgentMode(normalizeCodexMultiAgentMode(next))}
              onSetUserBackgroundImage={setUserBackgroundImage}
              onSetUserBackgroundOpacity={(next) =>
                setUserBackgroundOpacity(Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0)
              }
              onToggleCodexLogin={() => void onLoginCodex()}
              running={running}
              status={status}
              usageInfoText={usageInfoText}
              usageResultClosed={usageResultClosed}
            />
            <BridgePage
              busy={webWorkerBusy}
              connectCode={webBridgeConnectCode}
              embedded
              onCopyConnectCode={() => void onCopyWebBridgeConnectCode()}
              onRefreshStatus={() => void refreshWebBridgeStatus()}
              onRestartBridge={() => void onRestartWebBridge()}
              status={webBridgeStatus}
            />
            {/* {lastSavedRunFile && <div>최근 실행 파일: {formatRunFileLabel(lastSavedRunFile)}</div>} */}
          </section>
        )}
        {workspaceTab === "intelligence" && (
          <section className="panel-card settings-view data-intelligence-view workspace-tab-panel">
            <DashboardIntelligenceSettings
              config={dashboardIntelligenceConfig}
              disabled={running || isGraphRunning}
              onOpenAgentsWorkspace={onOpenAgentsWorkspaceFromData}
              onRequestRunInAgents={onRequestDashboardTopicRunInAgents}
              runStateByTopic={dashboardIntelligenceRunStateByTopic}
              snapshotsByTopic={dashboardSnapshotsByTopic}
            />
          </section>
        )}

      </section>
      <MainAppModals
        activeApproval={activeApproval}
        approvalDecisionLabel={approvalDecisionLabel}
        approvalDecisions={APPROVAL_DECISIONS}
        approvalSourceLabel={approvalSourceLabel}
        approvalSubmitting={approvalSubmitting}
        formatUnknown={formatUnknown}
        onCancelPendingWebTurn={onCancelPendingWebTurn}
        onCopyPendingWebPrompt={onCopyPendingWebPrompt}
        onDismissPendingWebTurn={onDismissPendingWebTurn}
        onOpenPendingProviderWindow={onOpenPendingProviderWindow}
        onOpenProviderSession={onOpenProviderSession}
        onRespondApproval={onRespondApproval}
        onRunGraph={onRunGraph}
        onSubmitPendingWebTurn={onSubmitPendingWebTurn}
        pendingWebConnectCheck={pendingWebConnectCheck}
        pendingWebLogin={pendingWebLogin}
        pendingWebTurn={pendingWebTurn}
        refreshWebBridgeStatus={refreshWebBridgeStatus}
        resolvePendingWebLogin={resolvePendingWebLogin}
        setPendingWebConnectCheck={setPendingWebConnectCheck}
        setStatus={setStatus}
        setWebResponseDraft={setWebResponseDraft}
        setWorkspaceTab={(next: WorkspaceTab) => setWorkspaceTab(next === "bridge" ? "settings" : next)}
        t={t}
        webProviderLabel={webProviderLabel}
        webResponseDraft={webResponseDraft}
        webTurnFloatingRef={webTurnFloatingRef}
        webTurnPanel={webTurnPanel}
      />
    </main>
  );
}

export default App;
