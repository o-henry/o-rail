import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import WorkflowRoleDock from "../pages/workflow/WorkflowRoleDock";
import { buildRoleDockStatusByRole, type RoleDockRuntimeState } from "../pages/workflow/roleDockState";
import KnowledgeBasePage from "../pages/knowledge/KnowledgeBasePage";
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
import { DASHBOARD_TOPIC_IDS } from "../features/dashboard/intelligence";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { useWorkspaceQuickPanel } from "./hooks/useWorkspaceQuickPanel";
import { useDashboardAgentBridge } from "./hooks/useDashboardAgentBridge";
import { useAgenticOrchestrationBridge } from "./hooks/useAgenticOrchestrationBridge";
import { useWorkspaceEventPersistence } from "./hooks/useWorkspaceEventPersistence";
import { useAgenticActionBus } from "./hooks/useAgenticActionBus";
import { useWorkflowHandoffPanel } from "./hooks/useWorkflowHandoffPanel";
import { STUDIO_ROLE_TEMPLATES } from "../features/studio/roleTemplates";
import type { StudioRoleId } from "../features/studio/handoffTypes";
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
import type { GraphNode } from "../features/workflow/types";
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
import { saveToLocalStorageSafely, toCssBackgroundImageValue } from "./mainAppUiUtils";
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
import { createAgenticQueue } from "./main/runtime/agenticQueue";
import { createWorkspaceEventEntry, type WorkspaceEventEntry } from "./main/runtime/workspaceEventLog";
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
import type { FeedCategory, InternalMemorySnippet, WebProviderRunResult, RunRecord } from "./main";

const HIDDEN_WORKSPACE_TABS = new Set<WorkspaceTab>(["intelligence", "feed", "handoff", "agents"]);

const WORKSPACE_TOPBAR_TABS: Array<{ tab: WorkspaceTab; label: string }> = [
  { tab: "dashboard", label: "대시보드" }, { tab: "workflow", label: "그래프" },
  { tab: "knowledge", label: "데이터베이스" }, { tab: "settings", label: "설정" },
];

const STUDIO_ROLE_PROMPTS: Record<StudioRoleId, string> = {
  pm_planner: "요구사항을 태스크 단위로 분해하고 우선순위를 확정해 인수인계 가능한 계획으로 정리해줘.",
  client_programmer: "게임플레이/UX 구현 관점에서 즉시 실행 가능한 코드 변경안과 테스트 기준을 제시해줘.",
  system_programmer: "시스템 구조/데이터 흐름/성능 병목 관점에서 안정화 계획을 제시해줘.",
  tooling_engineer: "개발 자동화/툴링 스크립트 중심으로 반복 작업을 줄이는 실행안을 제시해줘.",
  art_pipeline: "리소스 임포트/빌드 최적화/파이프라인 자동화 관점의 실행안을 제시해줘.",
  qa_engineer: "재현 가능한 테스트 시나리오와 회귀 방지 체크리스트를 우선으로 작성해줘.",
  build_release: "빌드/릴리즈 검증 항목과 배포 전 점검 체크를 실행 순서로 제시해줘.",
  technical_writer: "핵심 결정사항과 변경사항을 다음 담당자가 바로 실행할 수 있게 문서화해줘.",
};

function toStudioRoleId(value: string): StudioRoleId | null {
  const normalized = String(value ?? "").trim();
  if (
    normalized === "pm_planner" ||
    normalized === "client_programmer" ||
    normalized === "system_programmer" ||
    normalized === "tooling_engineer" ||
    normalized === "art_pipeline" ||
    normalized === "qa_engineer" ||
    normalized === "build_release" ||
    normalized === "technical_writer"
  ) {
    return normalized;
  }
  return null;
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
  const [workflowRoleId, setWorkflowRoleId] = useState<StudioRoleId>("pm_planner");
  const [workflowRoleTaskId, setWorkflowRoleTaskId] = useState("TASK-001");
  const [workflowRolePrompt, setWorkflowRolePrompt] = useState("");
  const [workflowRoleRuntimeStateByRole, setWorkflowRoleRuntimeStateByRole] = useState<
    Partial<Record<StudioRoleId, RoleDockRuntimeState>>
  >({});
  const [dashboardDetailTopic, setDashboardDetailTopic] = useState<DashboardDetailTopic | null>(null);
  const [agentLaunchRequest, setAgentLaunchRequest] = useState<AgentWorkspaceLaunchRequest | null>(null);
  const agentLaunchRequestSeqRef = useRef(0);
  const graphRunOverrideIdRef = useRef<string | null>(null);
  const [workspaceEvents, setWorkspaceEvents] = useState<WorkspaceEventEntry[]>([]);
  const {
    config: dashboardIntelligenceConfig,
    runStateByTopic: dashboardIntelligenceRunStateByTopic,
    setRunStateByTopic: setDashboardIntelligenceRunStateByTopic,
  } = useDashboardIntelligenceConfig();
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
    feedTopicFilter,
    setFeedTopicFilter,
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
  const agenticQueue = useMemo(() => createAgenticQueue(), []);

  useEffect(() => {
    if (HIDDEN_WORKSPACE_TABS.has(workspaceTab)) {
      setWorkspaceTab("dashboard");
    }
  }, [workspaceTab]);
  const { publishAction, subscribeAction } = useAgenticActionBus();
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
    runId?: string;
    topic?: string;
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
      runId: params.runId,
      topic: params.topic,
    });
    setWorkspaceEvents((prev) => [next, ...prev].slice(0, 300));
  }, []);

  const setStatus = useCallback((message: string) => {
    setStatusCore(message);
  }, [setStatusCore]);

  const setError = useCallback((message: string) => {
    setErrorCore(message);
  }, [setErrorCore]);

  const handleConsumeHandoff = useCallback((payload: {
    handoffId: string;
    toRole: string;
    taskId: string;
    request: string;
  }) => {
    publishAction({
      type: "handoff_consume",
      payload: { handoffId: payload.handoffId },
    });
    agentLaunchRequestSeqRef.current += 1;
    setAgentLaunchRequest({
      id: agentLaunchRequestSeqRef.current,
      setId: `role-${payload.toRole}`,
      draft: `[핸드오프 ${payload.taskId}] ${payload.request}`,
    });
  }, [publishAction]);

  const workflowHandoffPanel = useWorkflowHandoffPanel({
    cwd,
    publishAction,
    setStatus,
    onConsumeHandoff: handleConsumeHandoff,
  });
  const workflowRoleStatusByRole = useMemo(() => {
    return buildRoleDockStatusByRole({
      roles: STUDIO_ROLE_TEMPLATES,
      runtimeByRole: workflowRoleRuntimeStateByRole,
      handoffRecords: workflowHandoffPanel.handoffRecords,
    });
  }, [workflowHandoffPanel.handoffRecords, workflowRoleRuntimeStateByRole]);
  const workflowSelectedRoleHandoffs = useMemo(
    () =>
      workflowHandoffPanel.handoffRecords
        .filter((row) => row.fromRole === workflowRoleId || row.toRole === workflowRoleId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 4),
    [workflowHandoffPanel.handoffRecords, workflowRoleId],
  );
  const workflowSelectedRoleBlockers = useMemo(
    () =>
      workflowHandoffPanel.handoffRecords
        .filter((row) => (row.fromRole === workflowRoleId || row.toRole === workflowRoleId) && row.status === "rejected")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 3),
    [workflowHandoffPanel.handoffRecords, workflowRoleId],
  );

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
    feedPosts,
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
    cwd,
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
    createRunRecord: (params: Parameters<typeof createRunRecord>[0]) =>
      createRunRecord({
        ...params,
        runId: graphRunOverrideIdRef.current ?? undefined,
      }),
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
    feedTopicFilter,
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
  const feedTopicOptions = useMemo(
    () => [
      { value: "all", label: t("feed.topic.all") },
      ...DASHBOARD_TOPIC_IDS.map((topic) => ({
        value: topic,
        label: t(`dashboard.widget.${topic}.title`),
      })),
    ],
    [t],
  );

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
        role: "Data Pipeline Operator",
        promptTemplate:
          "Allowlist 소스를 기준으로 최신 데이터를 수집하고 핵심 시그널/출처를 간결하게 정리해줘.",
        qualityProfile: "research_evidence",
        artifactType: "EvidenceArtifact",
        sourceKind: "data_pipeline",
      },
    };
    applyGraphChange((prev) => ({
      ...prev,
      nodes: [...prev.nodes, nextNode],
    }));
    setNodeSelection([nodeId], nodeId);
    appendWorkspaceEvent({
      source: "workflow",
      message: "데이터 노드 추가",
      actor: "user",
      level: "info",
    });
    setStatus("그래프에 데이터 노드를 추가했습니다.");
  }, [appendWorkspaceEvent, applyGraphChange, graph.nodes, setNodeSelection, setStatus]);

  const onAddHandoffNodes = useCallback(
    (fromRole: StudioRoleId, toRole: StudioRoleId) => {
      const maxX = graph.nodes.reduce((max, node) => Math.max(max, Number(node.position?.x ?? 0)), 40);
      const maxY = graph.nodes.reduce((max, node) => Math.max(max, Number(node.position?.y ?? 0)), 40);
      const baseX = maxX + 320;
      const baseY = Math.max(40, maxY);
      const fromTemplate = STUDIO_ROLE_TEMPLATES.find((row) => row.id === fromRole);
      const toTemplate = STUDIO_ROLE_TEMPLATES.find((row) => row.id === toRole);
      const fromLabel = fromTemplate?.label ?? fromRole;
      const toLabel = toTemplate?.label ?? toRole;
      const fromNodeId = makeNodeId("turn");
      const toNodeId = fromRole === toRole ? "" : makeNodeId("turn");
      const fromNode: GraphNode = {
        id: fromNodeId,
        type: "turn",
        position: { x: baseX, y: baseY },
        config: {
          ...defaultNodeConfig("turn"),
          role: `${fromLabel} AGENT`,
          promptTemplate: STUDIO_ROLE_PROMPTS[fromRole],
          qualityProfile: "design_planning",
          artifactType: "TaskPlanArtifact",
          sourceKind: "handoff",
          handoffRoleId: fromRole,
          handoffToRoleId: toRole,
          handoffStage: "analyze",
        },
      };
      const toNode: GraphNode | null = toNodeId
        ? {
            id: toNodeId,
            type: "turn",
            position: { x: baseX + 320, y: baseY },
            config: {
              ...defaultNodeConfig("turn"),
              role: `${toLabel} AGENT`,
              promptTemplate: STUDIO_ROLE_PROMPTS[toRole],
              qualityProfile: "code_implementation",
              artifactType: "ChangePlanArtifact",
              sourceKind: "handoff",
              handoffRoleId: toRole,
              handoffToRoleId: toRole,
              handoffStage: "implement",
            },
          }
        : null;
      const previousNodeId = selectedNodeIds[0] ?? "";
      applyGraphChange(
        (prev) => ({
          ...prev,
          nodes: toNode ? [...prev.nodes, fromNode, toNode] : [...prev.nodes, fromNode],
          edges: [
            ...prev.edges,
            ...(previousNodeId
              ? [{ from: { nodeId: previousNodeId, port: "out" as const }, to: { nodeId: fromNodeId, port: "in" as const } }]
              : []),
            ...(toNodeId
              ? [{ from: { nodeId: fromNodeId, port: "out" as const }, to: { nodeId: toNodeId, port: "in" as const } }]
              : []),
          ],
        }),
        { autoLayout: true },
      );
      const nextSelection = toNodeId ? [fromNodeId, toNodeId] : [fromNodeId];
      setNodeSelection(nextSelection, toNodeId || fromNodeId);
      appendWorkspaceEvent({
        source: "workflow",
        message: toNodeId
          ? `핸드오프 노드 추가: ${fromLabel} → ${toLabel}`
          : `핸드오프 노드 추가: ${fromLabel}`,
        actor: "user",
        level: "info",
      });
      setStatus(toNodeId ? `핸드오프 노드 추가 완료 (${fromLabel} → ${toLabel})` : `핸드오프 노드 추가 완료 (${fromLabel})`);
    },
    [appendWorkspaceEvent, applyGraphChange, graph.nodes, selectedNodeIds, setNodeSelection, setStatus],
  );

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
      addHandoffNodes: onAddHandoffNodes,
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
      handoffRecords: workflowHandoffPanel.handoffRecords,
      selectedHandoffId: workflowHandoffPanel.selectedHandoffId,
      handoffRoleOptions: workflowHandoffPanel.handoffRoleOptions,
      handoffFromRole: workflowHandoffPanel.handoffFromRole,
      handoffToRole: workflowHandoffPanel.handoffToRole,
      handoffTaskId: workflowHandoffPanel.handoffTaskId,
      handoffRequestText: workflowHandoffPanel.handoffRequestText,
      setSelectedHandoffId: workflowHandoffPanel.setSelectedHandoffId,
      setHandoffFromRole: workflowHandoffPanel.setHandoffFromRole,
      setHandoffToRole: workflowHandoffPanel.setHandoffToRole,
      setHandoffTaskId: workflowHandoffPanel.setHandoffTaskId,
      setHandoffRequestText: workflowHandoffPanel.setHandoffRequestText,
      createHandoff: workflowHandoffPanel.createHandoff,
      updateHandoffStatus: workflowHandoffPanel.updateHandoffStatus,
      consumeHandoff: workflowHandoffPanel.consumeHandoff,
    },
  });
  const workflowInspectorPaneElement = (
    <WorkflowInspectorPane
      canvasFullscreen={canvasFullscreen}
      nodeProps={workflowInspectorPaneProps.nodeProps}
      toolsProps={workflowInspectorPaneProps.toolsProps}
    />
  );
  const workflowRoleDockElement = (
    <WorkflowRoleDock
      onChangePrompt={setWorkflowRolePrompt}
      onChangeTaskId={setWorkflowRoleTaskId}
      onRunRole={() => {
        const taskId = workflowRoleTaskId.trim();
        if (!taskId) {
          setStatus("TASK ID를 입력해 주세요.");
          return;
        }
        const latestIncomingHandoff = workflowHandoffPanel.handoffRecords
          .filter((row) => row.toRole === workflowRoleId && (row.status === "requested" || row.status === "accepted"))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        const basePrompt = workflowRolePrompt.trim();
        const handoffInjectedPrompt = latestIncomingHandoff
          ? `[HANDOFF_CONTEXT ${latestIncomingHandoff.taskId}] ${latestIncomingHandoff.request}\n\n${basePrompt}`.trim()
          : basePrompt;
        setWorkflowRoleRuntimeStateByRole((prev) => ({
          ...prev,
          [workflowRoleId]: {
            status: "RUNNING",
            taskId,
            message: "RUN_PENDING",
          },
        }));
        publishAction({
          type: "run_role",
          payload: {
            roleId: workflowRoleId,
            taskId,
            prompt: handoffInjectedPrompt || undefined,
            sourceTab: "workflow",
            handoffToRole: workflowHandoffPanel.handoffToRole,
            handoffRequest: basePrompt || undefined,
          },
        });
      }}
      onSelectRoleId={setWorkflowRoleId}
      roleStatusById={workflowRoleStatusByRole}
      selectedRoleBlockers={workflowSelectedRoleBlockers}
      selectedRoleHandoffs={workflowSelectedRoleHandoffs}
      prompt={workflowRolePrompt}
      roleId={workflowRoleId}
      runDisabled={isWorkflowBusy}
      taskId={workflowRoleTaskId}
    />
  );
  const showRoleDockFirst = Boolean(selectedNode);
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
    setFeedTopicFilter,
    setFeedKeyword,
    feedStatusFilter,
    feedExecutorFilter,
    feedPeriodFilter,
    feedTopicFilter,
    feedKeyword,
    feedTopicOptions,
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
  const { onSelectWorkspaceTab } = useWorkspaceNavigation({
    workspaceTab,
    setWorkspaceTab,
    dashboardDetailTopic,
    setDashboardDetailTopic,
    appendWorkspaceEvent,
  });
  const onOpenBriefingDocumentFromData = useCallback(
    async (runId: string, postId?: string) => {
      const resolvedRunId = String(runId ?? "").trim();
      if (!resolvedRunId) {
        setStatus("열 수 있는 브리핑 실행 기록이 없습니다.");
        return;
      }
      const resolvedPostId = String(postId ?? "").trim();
      const existingRunPosts = feedPosts.filter((post) => String(post.runId ?? "").trim() === resolvedRunId);
      let fallbackPostId = resolvedPostId;
      let hasOpenablePost = existingRunPosts.length > 0;
      if (existingRunPosts.length === 0) {
        const snapshot = Object.values(dashboardSnapshotsByTopic)
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .find((row) => String(row.runId ?? "").trim() === resolvedRunId);
        if (snapshot) {
          const topicLabel = t(`dashboard.widget.${snapshot.topic}.title`);
          const syntheticNodeId = `dashboard-${snapshot.topic}`;
          const syntheticPostId = `${resolvedRunId}:${syntheticNodeId}:${snapshot.status === "degraded" ? "low_quality" : "done"}`;
          const alreadyExists = feedPosts.some((post) => post.id === syntheticPostId);
          if (!alreadyExists) {
            const built = buildFeedPost({
              runId: resolvedRunId,
              node: {
                id: syntheticNodeId,
                type: "turn",
                config: {
                  executor: "codex",
                  model: snapshot.model,
                  role: "DASHBOARD BRIEFING",
                },
              },
              isFinalDocument: true,
              status: snapshot.status === "degraded" ? "low_quality" : "done",
              createdAt: String(snapshot.generatedAt ?? new Date().toISOString()),
              topic: snapshot.topic,
              topicLabel,
              groupName: topicLabel,
              agentName: topicLabel,
              roleLabel: `${String(snapshot.model ?? "").toUpperCase()} · DASHBOARD BRIEFING`,
              summary: String(snapshot.summary ?? "").trim() || `${topicLabel} 브리핑 생성`,
              logs: [
                `${topicLabel} 브리핑 생성`,
                ...(Array.isArray(snapshot.highlights) ? snapshot.highlights.slice(0, 8) : []),
              ],
              output: snapshot,
            });
            let markdownFilePath = "";
            let jsonFilePath = "";
            const normalizedCwd = String(cwd ?? "").trim();
            if (hasTauriRuntime && normalizedCwd) {
              try {
                const runDir = `${normalizedCwd.replace(/[\\/]+$/, "")}/.rail/runs/${resolvedRunId}`;
                const topicToken = String(snapshot.topic ?? "dashboard")
                  .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
                  .replace(/[^a-zA-Z0-9]+/g, "_")
                  .replace(/_+/g, "_")
                  .replace(/^_|_$/g, "")
                  .toLowerCase();
                const stamp = String(snapshot.generatedAt ?? new Date().toISOString())
                  .replace(/[-:.TZ]/g, "")
                  .slice(0, 14) || String(Date.now());
                const fileBase = `dashboard_${topicToken}_${stamp}`;
                markdownFilePath = await invoke<string>("workspace_write_text", {
                  cwd: runDir,
                  name: `${fileBase}.md`,
                  content: built.rawAttachments.markdown,
                });
                jsonFilePath = await invoke<string>("workspace_write_text", {
                  cwd: runDir,
                  name: `${fileBase}.json`,
                  content: built.rawAttachments.json,
                });
              } catch {
                // Ignore file persistence failures here; feed can still render in-memory content.
              }
            }
            built.post.inputSources = (snapshot.references ?? []).slice(0, 10).map((reference) => ({
              kind: "node",
              nodeId: syntheticNodeId,
              agentName: String(reference.source ?? "").trim() || "REFERENCE",
              roleLabel: "SOURCE",
              summary: [reference.title, reference.url].filter((part) => String(part ?? "").trim().length > 0).join(" · "),
            }));
            built.post.steps = [
              ...(Array.isArray(snapshot.highlights) ? snapshot.highlights.slice(0, 6) : []),
              ...(Array.isArray(snapshot.risks) ? snapshot.risks.slice(0, 3).map((risk) => `리스크: ${risk}`) : []),
            ].filter((line) => String(line ?? "").trim().length > 0);
            const syntheticPost = {
              ...built.post,
              id: syntheticPostId,
              topic: snapshot.topic,
              topicLabel,
              groupName: topicLabel,
              sourceFile: jsonFilePath || `dashboard-${snapshot.topic}-${resolvedRunId}.json`,
              question: `${topicLabel} 데이터 파이프라인 실행 결과`,
              attachments: Array.isArray(built.post.attachments)
                ? built.post.attachments.map((attachment: any) => {
                    if (attachment?.kind === "markdown" && markdownFilePath) {
                      return { ...attachment, filePath: markdownFilePath };
                    }
                    if (attachment?.kind === "json" && jsonFilePath) {
                      return { ...attachment, filePath: jsonFilePath };
                    }
                    return attachment;
                  })
                : built.post.attachments,
            };
            feedRawAttachmentRef.current[feedAttachmentRawKey(syntheticPost.id, "markdown")] = built.rawAttachments.markdown;
            feedRawAttachmentRef.current[feedAttachmentRawKey(syntheticPost.id, "json")] = built.rawAttachments.json;
            setFeedPosts((prev) => {
              if (prev.some((row) => row.id === syntheticPost.id)) {
                return prev;
              }
              return [syntheticPost, ...prev];
            });
            fallbackPostId = syntheticPost.id;
            hasOpenablePost = true;
          }
        }
      }
      if (!hasOpenablePost && !fallbackPostId) {
        setError("해당 실행의 브리핑 문서를 찾지 못했습니다. 실행 완료 후 다시 시도해 주세요.");
        setStatus("브리핑 문서 없음");
        return;
      }
      setFeedCategory("all_posts");
      setFeedStatusFilter("all");
      setFeedExecutorFilter("all");
      setFeedPeriodFilter("all");
      setFeedTopicFilter("all");
      setFeedKeyword(resolvedRunId);
      setFeedFilterOpen(true);
      setFeedGroupExpandedByRunId((prev) => ({
        ...prev,
        [resolvedRunId]: true,
      }));
      if (fallbackPostId) {
        setFeedInspectorPostId(fallbackPostId);
        setFeedExpandedByPost((prev) => ({
          ...prev,
          [fallbackPostId]: true,
        }));
      }
      setWorkspaceTab("feed");
      setStatus(`피드에서 브리핑 문서를 여는 중: ${resolvedRunId}`);
      appendWorkspaceEvent({
        source: "intelligence",
        actor: "user",
        level: "info",
        runId: resolvedRunId,
        message: resolvedPostId ? `브리핑 문서 열기: ${resolvedPostId}` : "브리핑 전체 문서 열기",
      });
    },
    [
      appendWorkspaceEvent,
      cwd,
      hasTauriRuntime,
      setFeedCategory,
      setFeedExecutorFilter,
      setFeedExpandedByPost,
      setFeedFilterOpen,
      setFeedGroupExpandedByRunId,
      setFeedInspectorPostId,
      setFeedKeyword,
      setFeedPeriodFilter,
      setFeedStatusFilter,
      setFeedTopicFilter,
      setFeedPosts,
      setError,
      setStatus,
      setWorkspaceTab,
      dashboardSnapshotsByTopic,
      feedPosts,
      feedRawAttachmentRef,
      invoke,
      t,
    ],
  );
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
    const ragSourceCount = request.selectedDataSourceIds?.length ?? 0;
    appendWorkspaceEvent({
      source: "agents",
      message:
        ragSourceCount > 0
          ? `에이전트 요청 전송: ${request.modelLabel} (RAG ${ragSourceCount}개)`
          : `에이전트 요청 전송: ${request.modelLabel}`,
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
  const { onRunGraph, runDashboardTopicDirect } = useAgenticOrchestrationBridge({
    cwd,
    selectedGraphFileName,
    graphFileName,
    queue: agenticQueue,
    invokeFn: invoke,
    appendWorkspaceEvent,
    triggerBatchByUserEvent: batchScheduler.triggerByUserEvent,
    runGraphCore: onRunGraphCore,
    graphRunOverrideIdRef,
    publishAction,
    subscribeAction,
    loginCompleted,
    setError,
    setWorkspaceTab,
    workspaceTab,
    runDashboardTopic,
    refreshDashboardSnapshots,
    onSelectWorkspaceTab,
    setNodeSelection,
    setStatus,
    applyPreset,
    onRoleRunCompleted: (payload) => {
      const roleId = toStudioRoleId(payload.roleId);
      if (roleId) {
        setWorkflowRoleRuntimeStateByRole((prev) => ({
          ...prev,
          [roleId]: {
            status: payload.runStatus === "done" ? "DONE" : "VERIFY",
            taskId: payload.taskId,
            runId: payload.runId,
            message: payload.runStatus === "done" ? "RUN_DONE" : "RUN_ERROR",
          },
        }));
      }
      const targetRole = toStudioRoleId(payload.handoffToRole ?? "");
      const requestText =
        String(payload.handoffRequest ?? payload.prompt ?? "").trim() ||
        (roleId ? STUDIO_ROLE_PROMPTS[roleId] : "");
      if (payload.runStatus === "done" && payload.sourceTab === "workflow" && roleId && targetRole && requestText) {
        workflowHandoffPanel.createAutoHandoff({
          runId: payload.runId,
          fromRole: roleId,
          toRole: targetRole,
          taskId: payload.taskId,
          request: requestText,
          artifactPaths: payload.artifactPaths,
        });
      }
    },
  });
  const { onRunDashboardTopicFromAgents, onRunDashboardTopicFromData } = useDashboardAgentBridge({
    setAgentLaunchRequest,
    agentLaunchRequestSeqRef,
    setWorkspaceTab: (next) => setWorkspaceTab(next),
    appendWorkspaceEvent,
    setStatus,
    t,
    loginCompleted,
    setError,
    runDashboardTopic: runDashboardTopicDirect,
    refreshDashboardSnapshots,
    dispatchAction: publishAction,
  });
  const workspaceTopbarTabs = WORKSPACE_TOPBAR_TABS;

  const {
    quickPanelOpen,
    quickPanelQuery,
    setQuickPanelQuery,
    quickPanelWorkspaceLabel,
    quickPanelRecentPosts,
    onToggleQuickPanel,
    onCloseQuickPanel,
    onOpenQuickPanelFeed,
    onOpenQuickPanelAgents,
    onSubmitQuickPanelQuery,
  } = useWorkspaceQuickPanel({
    workspaceTab,
    setWorkspaceTab,
    feedPosts,
    formatRelativeFeedTime,
    setFeedCategory,
    setFeedStatusFilter,
    setFeedKeyword,
    setWorkflowQuestion,
    setStatus,
    canvasFullscreen,
  });
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
  useWorkspaceEventPersistence({
    status,
    error,
    appendWorkspaceEvent,
    workspaceEvents,
    cwd,
    hasTauriRuntime,
    invokeFn: invoke,
  });
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
                setFeedTopicFilter("all");
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

            {!canvasFullscreen && (
              <div className="workflow-right-stack">
                {showRoleDockFirst ? workflowRoleDockElement : workflowInspectorPaneElement}
                {showRoleDockFirst ? workflowInspectorPaneElement : workflowRoleDockElement}
              </div>
            )}
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
        {workspaceTab === "knowledge" && (
          <KnowledgeBasePage
            cwd={cwd}
            posts={feedPosts}
            onInjectContextSources={(entries) => {
              const sourceIds = entries.map((entry) => entry.id);
              publishAction({
                type: "inject_context_sources",
                payload: { sourceIds },
              });
              if (entries.length > 0) {
                const summary = String(entries[0].summary ?? "").trim();
                const sourceLine = entries[0].sourceUrl
                  ? `\n- 출처: ${entries[0].sourceUrl}`
                  : "";
                const detail = summary || entries[0].title || entries[0].taskId;
                agentLaunchRequestSeqRef.current += 1;
                setAgentLaunchRequest({
                  id: agentLaunchRequestSeqRef.current,
                  setId: `role-${entries[0].roleId}`,
                  draft: `[데이터베이스 컨텍스트 ${entries[0].taskId}] ${detail}${sourceLine}`,
                });
              }
              setStatus(`데이터베이스 컨텍스트 주입 요청: ${sourceIds.length}건`);
              onSelectWorkspaceTab("agents");
            }}
          />
        )}
        {workspaceTab === "agents" && (
          <AgentsPage
            codexMultiAgentMode={codexMultiAgentMode}
            launchRequest={agentLaunchRequest}
            onQuickAction={onAgentQuickAction}
            onRunRole={({ roleId, taskId, prompt }) => {
              publishAction({
                type: "run_role",
                payload: {
                  roleId,
                  taskId,
                  prompt,
                  sourceTab: "agents",
                },
              });
            }}
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
              briefingDocuments={feedPosts
                .filter((post) => post.status === "done" || post.status === "low_quality")
                .map((post) => ({
                  id: post.id,
                  runId: post.runId,
                  summary: post.summary,
                  sourceFile: post.sourceFile,
                  agentName: post.agentName,
                  createdAt: post.createdAt,
                  isFinalDocument: post.isFinalDocument,
                  status: post.status,
                }))}
              config={dashboardIntelligenceConfig}
              disabled={running || isGraphRunning}
              onOpenBriefingDocument={onOpenBriefingDocumentFromData}
              onRunTopic={onRunDashboardTopicFromData}
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
