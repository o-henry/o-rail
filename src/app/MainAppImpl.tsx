import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../App.css";
import { invoke, listen, openUrl } from "../shared/tauri";
import { type DashboardDetailTopic } from "../pages/dashboard/DashboardDetailPage";
import type { AgentWorkspaceLaunchRequest } from "../pages/agents/agentTypes";
import { buildRoleDockStatusByRole, type RoleDockRuntimeState } from "../pages/workflow/roleDockState";
import { evaluateAdaptiveRecipe } from "./adaptation/engine";
import { resolveAdaptivePresetGraph as applyAdaptivePresetGraphDefaults } from "./adaptation/defaults";
import { useFloatingPanel } from "../features/ui/useFloatingPanel";
import { useExecutionState } from "./hooks/useExecutionState";
import { useFeedRunActions } from "./hooks/useFeedRunActions";
import { useFeedInspectorEffects } from "./hooks/useFeedInspectorEffects";
import { useFeedState } from "./hooks/useFeedState";
import { useGraphFileActions } from "./hooks/useGraphFileActions";
import { useGraphState } from "./hooks/useGraphState";
import { useWebConnectState } from "./hooks/useWebConnectState";
import { useWorkflowGraphActions } from "./hooks/useWorkflowGraphActions";
import {
  collectWorkflowRoleQueuedRequests,
  removeWorkflowRoleQueuedRequest,
  resolveWorkflowRoleRequestTargetNodeIds,
} from "./hooks/workflowRoleRequestTargets";
import { useWorkflowRoleCollaboration } from "./hooks/useWorkflowRoleCollaboration";
import { useWorkflowShortcuts } from "./hooks/useWorkflowShortcuts";
import { useAdaptiveWorkspaceState } from "./hooks/useAdaptiveWorkspaceState";
import { useTaskRoleLearningState } from "./hooks/useTaskRoleLearningState";
import { useDashboardIntelligenceConfig } from "./hooks/useDashboardIntelligenceConfig";
import { useDashboardIntelligenceRunner } from "./hooks/useDashboardIntelligenceRunner";
import { DASHBOARD_TOPIC_IDS } from "../features/dashboard/intelligence";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { useWorkspaceQuickPanel } from "./hooks/useWorkspaceQuickPanel";
import { useDashboardAgentBridge } from "./hooks/useDashboardAgentBridge";
import { useAgenticOrchestrationBridge } from "./hooks/useAgenticOrchestrationBridge";
import { useGraphResearchKnowledgeSync } from "./hooks/useGraphResearchKnowledgeSync";
import { useMissionControl } from "./hooks/useMissionControl";
import { useWorkspaceEventPersistence } from "./hooks/useWorkspaceEventPersistence";
import { useAgenticActionBus } from "./hooks/useAgenticActionBus";
import { useWorkflowHandoffPanel } from "./hooks/useWorkflowHandoffPanel";
import { computeCanvasStageSize } from "./main/canvas/canvasStageSize";
import { STUDIO_ROLE_TEMPLATES } from "../features/studio/roleTemplates";
import type { StudioRoleId } from "../features/studio/handoffTypes";
import { getStudioRoleModeOptions, normalizePmPlanningMode, normalizeStudioRoleSelection, resolveStudioRoleDisplayLabel } from "../features/studio/pmPlanningMode";
import { toStudioRoleId } from "../features/studio/roleUtils";
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
import { TURN_REASONING_LEVEL_OPTIONS } from "../features/workflow/reasoningLevels";
import { buildGraphForViewMode, isViaFlowTurnNode, type WorkflowGraphViewMode } from "../features/workflow/viaGraph";
import { RAG_TEMPLATE_OPTIONS } from "../features/workflow/ragTemplates";
import { isViaNodeType, VIA_NODE_OPTIONS, viaNodeLabel } from "../features/workflow/viaCatalog";
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
  getAutoConnectionSides,
  getGraphEdgeKey,
  getNodeAnchorPoint,
  graphEquals,
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
  isEditableTarget,
  toErrorText,
  toOpenRunsFolderErrorMessage,
  toUsageCheckErrorMessage,
} from "./mainAppUtils";
import { saveToLocalStorageSafely, toCssBackgroundImageValue } from "./mainAppUiUtils";
import {
  GRAPH_SCHEMA_VERSION,
  KNOWLEDGE_DEFAULT_MAX_CHARS,
  KNOWLEDGE_DEFAULT_TOP_K,
  type WorkspaceTab,
  isTurnTerminalEvent,
  normalizeKnowledgeConfig,
  toWebBridgeStatus,
  validateSimpleSchema,
} from "./mainAppGraphHelpers";
import { useI18n } from "../i18n";
import { useThemeMode } from "./theme/ThemeProvider";
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
import { buildConsumedHandoffHandler, buildKnowledgeInjectionHandler } from "./main/runtime/workflowMissionBridge";
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
import { MainAppShell } from "./main/presentation/MainAppShell";
import { useMainAppWorkflowPresentation } from "./main/presentation/useMainAppWorkflowPresentation";
import { useWorkflowRagActions } from "./main/canvas/useWorkflowRagActions";
import { useTurnModelSelectionActions } from "./main/canvas/useTurnModelSelectionActions";
import { useBriefingDocumentActions } from "./main/runtime/useBriefingDocumentActions";
import { isTasksLeftNavToggleShortcut } from "../pages/tasks/tasksWorkspaceShortcuts";
import {
  buildAdaptiveEvaluationInput,
  buildAdaptiveRecipeSnapshotForRun,
} from "./main/runtime/adaptiveRunHelpers";
import { useRoleRunCompletionBridge } from "./main/runtime/useRoleRunCompletionBridge";
import { buildRoleNodeScaffold } from "./main/runtime/roleNodeScaffold";
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
  resolveGraphDagMaxThreads,
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
const HIDDEN_WORKSPACE_TABS = new Set<WorkspaceTab>(["workbench", "dashboard", "intelligence", "feed", "handoff", "agents"]);
const DEFAULT_WORKSPACE_TAB: WorkspaceTab = "tasks";
function App() {
  const USER_BG_IMAGE_STORAGE_KEY = "rail.settings.user_bg_image";
  const USER_BG_OPACITY_STORAGE_KEY = "rail.settings.user_bg_opacity";
  const { locale, t, tp } = useI18n();
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const defaultCwd = useMemo(() => loadPersistedCwd(""), []);
  const defaultLoginCompleted = useMemo(() => loadPersistedLoginCompleted(), []);
  const defaultAuthMode = useMemo(() => loadPersistedAuthMode(), []);
  const defaultCodexMultiAgentMode = useMemo(() => loadPersistedCodexMultiAgentMode(), []);
  const themeModeOptions = useMemo(() => [{ value: "light", label: t("settings.theme.light") }, { value: "dark", label: t("settings.theme.dark") }], [t]);
  const workspaceTopbarTabs = useMemo<Array<{ tab: WorkspaceTab; label: string }>>(
    () => [
      { tab: "tasks", label: "TASKS" },
      { tab: "shell", label: "SHELL" },
      { tab: "workflow", label: t("nav.workflow.title") },
      { tab: "knowledge", label: t("nav.knowledge") },
      { tab: "visualize", label: t("nav.visualize") },
      { tab: "adaptation", label: t("nav.adaptation") },
      { tab: "settings", label: t("nav.settings") },
    ],
    [t],
  );
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(DEFAULT_WORKSPACE_TAB);
  const [tasksLeftNavHidden, setTasksLeftNavHidden] = useState(false);
  const [workflowRoleId, setWorkflowRoleId] = useState<StudioRoleId>("pm_planner");
  const [, setWorkflowRoleTaskId] = useState("TASK-001");
  const [workflowRolePrompt, setWorkflowRolePrompt] = useState("");
  const [expandedRoleNodeIds, setExpandedRoleNodeIds] = useState<string[]>([]);
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
  const [workflowQuestion, setWorkflowQuestion] = useState("");
  const [codexAuthCheckPending, setCodexAuthCheckPending] = useState(false);
  const [workflowGraphViewMode, setWorkflowGraphViewMode] = useState<WorkflowGraphViewMode>("graph");
  const [workflowSidePanelsVisible, setWorkflowSidePanelsVisible] = useState(true);
  const [openWorkflowAgentTerminalNodeId, setOpenWorkflowAgentTerminalNodeId] = useState("");

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
    activeTurnThreadByNodeIdRef,
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
  const graphForCanvas = useMemo(
    () => buildGraphForViewMode(graph, workflowGraphViewMode),
    [graph, workflowGraphViewMode],
  );
  useEffect(() => {
    if (!openWorkflowAgentTerminalNodeId) {
      return;
    }
    const stillExists = graph.nodes.some((node) => node.id === openWorkflowAgentTerminalNodeId);
    if (!stillExists) {
      setOpenWorkflowAgentTerminalNodeId("");
    }
  }, [graph.nodes, openWorkflowAgentTerminalNodeId]);
  const ragModeNodes = useMemo(
    () =>
      graph.nodes
        .filter((node) => isViaFlowTurnNode(node))
        .map((node) => {
          const config = node.config as TurnConfig;
          const viaTypeRaw = String((node.config as Record<string, unknown>).viaNodeType ?? "").trim();
          const viaType = isViaNodeType(viaTypeRaw) ? viaTypeRaw : "source.news";
          return {
            id: node.id,
            flowId: String(config.viaFlowId ?? "").trim(),
            viaNodeType: viaType,
            viaNodeLabel: viaNodeLabel(viaType),
            viaCustomKeywords: String(config.viaCustomKeywords ?? "").trim(),
            viaCustomCountries: String(config.viaCustomCountries ?? "").trim(),
            viaCustomSites: String(config.viaCustomSites ?? "").trim(),
            viaCustomMaxItems: Math.max(1, Number(config.viaCustomMaxItems) || 24),
          };
        }),
    [graph.nodes],
  );
  const ragNodeProgress = useMemo(
    () =>
      ragModeNodes.map((node) => {
        const state = nodeStates[node.id];
        const status = state?.status ?? "idle";
        const logs = state?.logs ?? [];
        const recentLogs = logs.length <= 2 ? logs : [logs[0], logs[logs.length - 1]];
        return {
          id: node.id,
          viaNodeLabel: node.viaNodeLabel,
          status,
          statusLabel: nodeStatusLabel(status),
          recentLogs,
        };
      }),
    [nodeStates, nodeStatusLabel, ragModeNodes],
  );
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
  useEffect(() => {
    if (!hasTauriRuntime || !cwd) {
      return;
    }
    void invoke("storage_cleanup_workspace", { cwd }).catch(() => {});
  }, [cwd, hasTauriRuntime]);
  const adaptiveWorkspaceState = useAdaptiveWorkspaceState({
    cwd,
    hasTauriRuntime,
    invokeFn: invoke,
  });
  const taskRoleLearningState = useTaskRoleLearningState({
    cwd,
    hasTauriRuntime,
    invokeFn: invoke,
  });
  const agenticQueue = useMemo(() => createAgenticQueue(), []);

  useEffect(() => {
    if (HIDDEN_WORKSPACE_TABS.has(workspaceTab)) {
      setWorkspaceTab(DEFAULT_WORKSPACE_TAB);
    }
  }, [workspaceTab]);
  useEffect(() => {
    if (workspaceTab !== "workflow") {
      return;
    }
    setWorkflowGraphViewMode("graph");
    setWorkflowSidePanelsVisible(true);
  }, [workspaceTab]);
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (workspaceTab !== "tasks") {
        return;
      }
      if (!isTasksLeftNavToggleShortcut(event) || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setTasksLeftNavHidden((prev) => {
        const next = !prev;
        setStatusState(next ? "TASKS 왼쪽 탐색 숨김" : "TASKS 왼쪽 탐색 표시");
        return next;
      });
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [setStatusState, workspaceTab]);
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
    graph: graphForCanvas,
    expandedRoleNodeIds: new Set(expandedRoleNodeIds),
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
  const missionControl = useMissionControl({
    cwd,
    hasTauriRuntime,
    invokeFn: invoke,
    appendWorkspaceEvent,
  });

  const setStatus = useCallback((message: string) => {
    setStatusCore(message);
  }, [setStatusCore]);

  const setError = useCallback((message: string) => {
    setErrorCore(message);
  }, [setErrorCore]);

  const handleInjectKnowledgeToWorkflow = useMemo(() => buildKnowledgeInjectionHandler({
    setStatus, setWorkflowQuestion, setWorkflowRoleId, setWorkflowRolePrompt, setWorkflowRoleTaskId, setWorkspaceTab, toStudioRoleId,
  }), [setStatus]);

  const handleConsumeHandoff = useMemo(() => buildConsumedHandoffHandler({
    publishAction, setWorkflowQuestion, setWorkflowRoleId, setWorkflowRolePrompt, setWorkflowRoleTaskId, setWorkspaceTab, toStudioRoleId,
  }), [publishAction]);

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
  const scraplingAutoPrepareCwdRef = useRef("");

  useEffect(() => {
    if (!hasTauriRuntime) {
      setCodexAuthCheckPending(false);
      return;
    }
    const resolvedCwd = String(cwd ?? "").trim();
    if (!resolvedCwd || resolvedCwd === ".") {
      setCodexAuthCheckPending(false);
      return;
    }
    setCodexAuthCheckPending(true);
  }, [cwd, hasTauriRuntime]);

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
      })
      .finally(() => {
        setCodexAuthCheckPending(false);
      });
  }, [cwd, engineStarted, ensureEngineStarted, hasTauriRuntime, refreshAuthStateFromEngine, setError, setStatus]);

  useEffect(() => {
    if (!hasTauriRuntime) {
      return;
    }
    const resolvedCwd = String(cwd ?? "").trim();
    if (!resolvedCwd || resolvedCwd === ".") {
      return;
    }
    if (scraplingAutoPrepareCwdRef.current === resolvedCwd) {
      return;
    }
    scraplingAutoPrepareCwdRef.current = resolvedCwd;
    void (async () => {
      try {
        const health = await invoke<{ running?: boolean; scrapling_ready?: boolean; scraplingReady?: boolean }>(
          "dashboard_scrapling_bridge_start",
          { cwd: resolvedCwd },
        );
        const ready = Boolean(health?.running) && Boolean(health?.scrapling_ready ?? health?.scraplingReady);
        if (!ready) {
          await invoke("dashboard_scrapling_bridge_install", { cwd: resolvedCwd });
          await invoke("dashboard_scrapling_bridge_start", { cwd: resolvedCwd });
        }
      } catch {
        // ignore: manual run path will retry and surface detailed errors per source
      }
    })();
  }, [cwd, hasTauriRuntime]);

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

  const resolveAdaptivePresetGraph = useCallback(
    (kind: PresetKind, builtGraph: Parameters<typeof applyAdaptivePresetGraphDefaults>[1]) =>
      applyAdaptivePresetGraphDefaults(
        kind,
        builtGraph,
        adaptiveWorkspaceState.championByFamily.get(`preset:${kind}`) ?? null,
      ),
    [adaptiveWorkspaceState.championByFamily],
  );

  const buildAdaptiveRunRecipe = useCallback(
    (params: { graph: typeof graphForCanvas; workflowPresetKind?: PresetKind; presetHint?: PresetKind }) =>
      buildAdaptiveRecipeSnapshotForRun({
        cwd,
        graph: params.graph,
        workflowPresetKind: params.workflowPresetKind,
        presetHint: params.presetHint,
      }),
    [cwd],
  );

  const finalizeAdaptiveRun = useCallback(
    async (runRecord: RunRecord) => {
      if (!hasTauriRuntime || !cwd.trim()) {
        return;
      }
      const recipe =
        runRecord.adaptiveRecipeSnapshot ??
        buildAdaptiveRecipeSnapshotForRun({
          cwd,
          graph: runRecord.graphSnapshot,
          workflowPresetKind: runRecord.workflowPresetKind,
          presetHint: lastAppliedPresetRef.current?.kind,
        });
      const next = await evaluateAdaptiveRecipe({
        cwd,
        invokeFn: invoke,
        recipe,
        evaluation: buildAdaptiveEvaluationInput(runRecord),
      });
      adaptiveWorkspaceState.updateFromRuntime(next);
    },
    [adaptiveWorkspaceState, cwd, hasTauriRuntime, lastAppliedPresetRef, invoke],
  );

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
    resolveAdaptivePresetGraph,
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
    setCanvasZoom,
    clampCanvasZoom: (nextZoom: number) =>
      Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, nextZoom)),
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
    activeTurnThreadByNodeIdRef,
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
    hasTauriRuntime,
    loginCompleted,
    setError,
    setStatus,
    collectRequiredWebProviders,
    graph: graphForCanvas,
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
    activeTurnThreadByNodeIdRef,
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
    graph: graphForCanvas,
    runLogCollectorRef,
    setNodeStates,
    createRunRecord: (params: Parameters<typeof createRunRecord>[0]) =>
      createRunRecord({
        ...params,
        runId: graphRunOverrideIdRef.current ?? undefined,
      }),
    buildAdaptiveRecipeSnapshot: ({
      graph,
      workflowPresetKind,
      presetHint,
    }: {
      graph: typeof graphForCanvas;
      workflowPresetKind?: PresetKind;
      presetHint?: PresetKind;
    }) => buildAdaptiveRunRecipe({ graph, workflowPresetKind, presetHint }),
    lastAppliedPresetRef,
    workflowQuestion,
    locale,
    setActiveFeedRunMeta,
    activeRunPresetKindRef,
    internalMemoryCorpusRef,
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
    resolveGraphDagMaxThreads,
    findDirectInputNodeIds,
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
    finalizeAdaptiveRun,
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
  const selectedNodeRoleLockId = useMemo<StudioRoleId | null>(() => {
    if (!selectedNode || selectedNode.type !== "turn") {
      return null;
    }
    const config = selectedNode.config as Record<string, unknown>;
    const sourceKind = String(config.sourceKind ?? "").trim().toLowerCase();
    if (sourceKind !== "handoff") {
      return null;
    }
    return normalizeStudioRoleSelection(toStudioRoleId(String(config.handoffRoleId ?? "")));
  }, [selectedNode]);
  const selectedTerminalNode =
    selectedNode && selectedNode.id === openWorkflowAgentTerminalNodeId ? selectedNode : null;
  const selectedTerminalRoleLockId = useMemo<StudioRoleId | null>(() => {
    if (!selectedTerminalNode || selectedTerminalNode.type !== "turn") {
      return null;
    }
    const config = selectedTerminalNode.config as Record<string, unknown>;
    const sourceKind = String(config.sourceKind ?? "").trim().toLowerCase();
    if (sourceKind !== "handoff") {
      return null;
    }
    return normalizeStudioRoleSelection(toStudioRoleId(String(config.handoffRoleId ?? "")));
  }, [selectedTerminalNode]);
  const selectedTurnExecutor: TurnExecutor =
    selectedTurnConfig ? getTurnExecutor(selectedTurnConfig) : "codex";
  const selectedQualityProfile: QualityProfileId =
    selectedNode?.type === "turn" && selectedTurnConfig
      ? inferQualityProfile(selectedNode, selectedTurnConfig)
      : "generic";
  const selectedQualityThresholdOption = String(normalizeQualityThreshold(selectedTurnConfig?.qualityThreshold ?? QUALITY_DEFAULT_THRESHOLD));
  const selectedArtifactType: ArtifactType = toArtifactType(selectedTurnConfig?.artifactType);
  const qualityProfileOptions = useMemo(() => getQualityProfileOptions(locale), [locale]);
  const qualityThresholdOptions = useMemo(() => getQualityThresholdOptions(locale), [locale]);
  const artifactTypeOptions = useMemo(() => getArtifactTypeOptions(locale), [locale]);
  const costPresetOptions = useMemo(() => getCostPresetOptions(locale), [locale]);
  const codexMultiAgentModeOptions = useMemo(() => getCodexMultiAgentModeOptions(locale), [locale]);
  const presetTemplateOptions = useMemo(() => getPresetTemplateOptions(locale), [locale]);
  const knowledgeTopKOptions = useMemo(() => KNOWLEDGE_TOP_K_OPTIONS.map((option) => ({ ...option, label: tp(option.label) })), [locale]);
  const knowledgeMaxCharsOptions = useMemo(() => KNOWLEDGE_MAX_CHARS_OPTIONS.map((option) => ({ ...option, label: tp(option.label) })), [locale]);
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
  const onSetPmPlanningMode = useCallback((nodeId: string, nextMode: "creative" | "logical") => {
    if (isGraphRunning) {
      setStatus("워크플로우 실행 중에는 PM 모드를 변경할 수 없습니다.");
      return;
    }
    const normalizedNodeId = String(nodeId ?? "").trim();
    if (!normalizedNodeId) {
      return;
    }
    const targetNode = graph.nodes.find((node) => node.id === normalizedNodeId && node.type === "turn");
    if (!targetNode) {
      return;
    }
    const targetConfig = targetNode.config as Record<string, unknown>;
    const rawRoleId = toStudioRoleId(String(targetConfig.handoffRoleId ?? ""));
    const baseRoleId = normalizeStudioRoleSelection(rawRoleId);
    if (!baseRoleId) {
      return;
    }
    const availableModes = getStudioRoleModeOptions(baseRoleId);
    if (availableModes.length === 0) {
      return;
    }
    const normalizedMode = normalizePmPlanningMode(nextMode);
    if (!availableModes.includes(normalizedMode)) {
      return;
    }
    const currentMode = normalizePmPlanningMode(targetConfig.pmPlanningMode);
    if (currentMode === normalizedMode && rawRoleId === baseRoleId) {
      return;
    }

    const roleMode = String(targetConfig.roleMode ?? "primary").trim();
    const roleInstanceLabel = roleMode === "primary"
      ? (resolveStudioRoleDisplayLabel(baseRoleId, normalizedMode) || "기획(PM)")
      : (
          String(targetConfig.roleInstanceLabel ?? "").trim()
          || resolveStudioRoleDisplayLabel(baseRoleId, normalizedMode)
          || "기획(PM)"
        );
    const scaffold = buildRoleNodeScaffold({
      roleId: baseRoleId,
      anchorX: Number(targetNode.position?.x ?? 0),
      anchorY: Number(targetNode.position?.y ?? 0),
      includeResearch: targetConfig.roleResearchEnabled !== false,
      pmPlanningMode: normalizedMode,
      roleInstanceId: String(targetConfig.roleInstanceId ?? `${baseRoleId}:primary`).trim(),
      roleInstanceLabel,
      roleMode:
        roleMode === "perspective" || roleMode === "review" ? roleMode : "primary",
    });
    const blueprintRoleNode = scaffold.nodes.find((node) => node.id === scaffold.roleNodeId);
    if (!blueprintRoleNode) {
      return;
    }
    const blueprintRoleConfig = blueprintRoleNode.config as Record<string, unknown>;
    const blueprintChildrenByKind = {
      research: scaffold.nodes
        .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "") === "research")
        .sort((a, b) => Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0)),
      synthesis: scaffold.nodes
        .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "") === "synthesis")
        .sort((a, b) => Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0)),
      verification: scaffold.nodes
        .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "") === "verification")
        .sort((a, b) => Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0)),
    };
    const existingChildrenByKind = {
      research: graph.nodes
        .filter((node) => String((node.config as Record<string, unknown>).internalParentNodeId ?? "") === normalizedNodeId)
        .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "") === "research")
        .sort((a, b) => Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0)),
      synthesis: graph.nodes
        .filter((node) => String((node.config as Record<string, unknown>).internalParentNodeId ?? "") === normalizedNodeId)
        .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "") === "synthesis")
        .sort((a, b) => Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0)),
      verification: graph.nodes
        .filter((node) => String((node.config as Record<string, unknown>).internalParentNodeId ?? "") === normalizedNodeId)
        .filter((node) => String((node.config as Record<string, unknown>).internalNodeKind ?? "") === "verification")
        .sort((a, b) => Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0)),
    };

    applyGraphChange((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => {
        if (node.id === normalizedNodeId) {
          const currentConfig = node.config as Record<string, unknown>;
          return {
            ...node,
            config: {
              ...currentConfig,
              handoffRoleId: "pm_planner",
              pmPlanningMode: normalizedMode,
              role:
                roleMode === "primary"
                  ? String(blueprintRoleConfig.role ?? currentConfig.role ?? "")
                  : String(currentConfig.role ?? blueprintRoleConfig.role ?? ""),
              promptTemplate: blueprintRoleConfig.promptTemplate,
              qualityProfile: blueprintRoleConfig.qualityProfile,
              artifactType: blueprintRoleConfig.artifactType,
              roleInstanceLabel,
            },
          };
        }

        const internalParentNodeId = String((node.config as Record<string, unknown>).internalParentNodeId ?? "").trim();
        if (internalParentNodeId !== normalizedNodeId) {
          return node;
        }
        const kind = String((node.config as Record<string, unknown>).internalNodeKind ?? "").trim() as "research" | "synthesis" | "verification";
        if (kind !== "research" && kind !== "synthesis" && kind !== "verification") {
          return node;
        }
        const currentList = existingChildrenByKind[kind];
        const index = currentList.findIndex((entry) => entry.id === node.id);
        const blueprintNode = blueprintChildrenByKind[kind][index] ?? blueprintChildrenByKind[kind][0];
        if (!blueprintNode) {
          return node;
        }
        return {
          ...node,
          config: {
            ...(blueprintNode.config as Record<string, unknown>),
            internalParentNodeId: normalizedNodeId,
            internalNodeKind: kind,
            roleInstanceId: String((node.config as Record<string, unknown>).roleInstanceId ?? targetConfig.roleInstanceId ?? "").trim(),
          },
        };
      }),
    }), { autoLayout: false });
    setStatus(`${resolveStudioRoleDisplayLabel(baseRoleId, normalizedMode) || baseRoleId} 노드를 ${normalizedMode === "logical" ? "논리" : "창의성"} 모드로 전환했습니다.`);
  }, [applyGraphChange, graph.nodes, isGraphRunning, setStatus]);
  const canResumeGraph = isGraphRunning && isGraphPaused;
  const isWorkflowBusy = (isGraphRunning && !isGraphPaused) || isRunStarting;

  useEffect(() => {
    if (!selectedNodeRoleLockId || workflowRoleId === selectedNodeRoleLockId) {
      return;
    }
    setWorkflowRoleId(selectedNodeRoleLockId);
  }, [selectedNodeRoleLockId, workflowRoleId]);
  const canClearGraph = !isWorkflowBusy && (graph.nodes.length > 0 || graph.edges.length > 0);
  const isWorkspaceCwdConfigured = String(cwd ?? "").trim().length > 0 && String(cwd ?? "").trim() !== ".";
  const codexLoginGateOpen = hasTauriRuntime && !codexAuthCheckPending && !loginCompleted;
  const canRunWithoutQuestion = workflowGraphViewMode === "rag";
  const canRunGraphNow =
    !codexAuthCheckPending &&
    !codexLoginGateOpen &&
    (canResumeGraph ||
      (isWorkspaceCwdConfigured &&
        !isWorkflowBusy &&
        graphForCanvas.nodes.length > 0 &&
        (canRunWithoutQuestion || workflowQuestion.trim().length > 0)));
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

  const onActivateWorkflowPanels = useCallback(() => {
    setWorkflowSidePanelsVisible((prev) => (prev ? prev : true));
  }, []);
  const {
    onAddCrawlerNode,
    onAddViaFlowNode,
    onApplyRagTemplate,
    onSelectRagModeNode,
    onSetGraphViewMode,
    onUpdateRagModeFlowId,
    onUpdateRagSourceOptions,
  } = useWorkflowRagActions({
    appendWorkspaceEvent,
    applyGraphChange,
    clampCanvasZoom,
    canvasZoom,
    graphNodes: graph.nodes,
    graphCanvasRef,
    setCanvasZoom,
    setNodeSelection,
    setStatus,
    setWorkflowGraphViewMode,
    updateNodeConfigById,
    workflowGraphViewMode,
  });

  const {
    onAddRoleNode,
    toggleRoleInternalExpanded,
    addRolePerspectivePass,
    addRolePerspectivePassForNode,
    addRoleReviewPass,
    addRoleReviewPassForNode,
  } = useWorkflowRoleCollaboration({
    canvasZoom,
    canvasNodeIdSet,
    graph,
    graphCanvasRef,
    selectedNode,
    expandedRoleNodeIds,
    setExpandedRoleNodeIds,
    applyGraphChange,
    setNodeSelection,
    appendWorkspaceEvent,
    setStatus,
    setCanvasZoom,
    clampCanvasZoom,
    resolveAdaptiveRoleChampion: (family) => adaptiveWorkspaceState.championByFamily.get(family) ?? null,
  });

  const onInterruptWorkflowNode = useCallback(
    async (nodeId: string) => {
      const normalizedNodeId = String(nodeId ?? "").trim();
      if (!normalizedNodeId) {
        return;
      }
      const threadId = String(nodeStates[normalizedNodeId]?.threadId ?? "").trim();
      if (!threadId) {
        setStatus("중단할 실행 스레드가 없습니다.");
        return;
      }
      try {
        await invoke("turn_interrupt", { threadId });
        addNodeLog(normalizedNodeId, "turn_interrupt 요청 전송");
        setNodeStatus(normalizedNodeId, "queued", "중단 요청 전송");
        setNodeRuntimeFields(normalizedNodeId, { status: "queued", finishedAt: undefined, durationMs: undefined });
        appendWorkspaceEvent({ source: "workflow", actor: "user", level: "info", message: `${normalizedNodeId} 중단 요청 전송` });
        setStatus(`${normalizedNodeId} 실행 중단 요청을 보냈습니다.`);
      } catch (error) {
        const message = String(error ?? "turn interrupt failed");
        setError(message);
        appendWorkspaceEvent({ source: "workflow", actor: "system", level: "error", message: `${normalizedNodeId} 중단 실패: ${message}` });
      }
    },
    [addNodeLog, appendWorkspaceEvent, invoke, nodeStates, setError, setNodeRuntimeFields, setNodeStatus, setStatus],
  );

  const viewportWidth = Math.ceil(canvasLogicalViewport.width);
  const viewportHeight = Math.ceil(canvasLogicalViewport.height);
  const { width: boundedStageWidth, height: boundedStageHeight } = computeCanvasStageSize({
    viewportWidth,
    viewportHeight,
    canvasNodes,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
    stageGrowMargin: STAGE_GROW_MARGIN,
    stageGrowLimit: STAGE_GROW_LIMIT,
    maxStageWidth: MAX_STAGE_WIDTH,
    maxStageHeight: MAX_STAGE_HEIGHT,
    expandToFitAllNodes: expandedRoleNodeIds.length > 0,
  });
  const workflowRoleRequestTargetNodeIds = useMemo(
    () =>
      resolveWorkflowRoleRequestTargetNodeIds({
        graph,
        roleId: workflowRoleId,
        selectedNodeId: selectedNode?.id,
      }),
    [graph, selectedNode?.id, workflowRoleId],
  );
  const workflowRoleQueuedRequests = useMemo(
    () =>
      collectWorkflowRoleQueuedRequests({
        targetNodeIds: workflowRoleRequestTargetNodeIds,
        pendingNodeRequests,
      }),
    [pendingNodeRequests, workflowRoleRequestTargetNodeIds],
  );
  const saveRoleRequestDisabled =
    workflowRolePrompt.trim().length === 0 || workflowRoleRequestTargetNodeIds.length === 0;
  const onSaveRoleRequest = useCallback(() => {
    const nextPrompt = workflowRolePrompt.trim();
    if (!nextPrompt) {
      setStatus("저장할 추가 요청을 입력해 주세요.");
      return;
    }
    if (workflowRoleRequestTargetNodeIds.length === 0) {
      setStatus("추가 요청을 저장할 역할 노드가 없습니다.");
      return;
    }
    workflowRoleRequestTargetNodeIds.forEach((nodeId) => {
      enqueueNodeRequest(nodeId, nextPrompt);
    });
    const roleLabel =
      resolveStudioRoleDisplayLabel(workflowRoleId)
      || STUDIO_ROLE_TEMPLATES.find((role) => role.id === workflowRoleId)?.label
      || workflowRoleId;
    appendWorkspaceEvent({
      source: "workflow",
      actor: "user",
      level: "info",
      message:
        workflowRoleRequestTargetNodeIds.length === 1
          ? `${roleLabel} 추가 요청 저장`
          : `${roleLabel} 추가 요청 ${workflowRoleRequestTargetNodeIds.length}개 노드에 저장`,
    });
    setWorkflowRolePrompt("");
    setStatus(
      workflowRoleRequestTargetNodeIds.length === 1
        ? `${roleLabel} 노드에 추가 요청을 저장했습니다.`
        : `${roleLabel} 역할 노드 ${workflowRoleRequestTargetNodeIds.length}개에 추가 요청을 저장했습니다.`,
      );
  }, [
    appendWorkspaceEvent,
    enqueueNodeRequest,
    setStatus,
    setWorkflowRolePrompt,
    workflowRoleId,
    workflowRolePrompt,
    workflowRoleRequestTargetNodeIds,
  ]);
  const onDeleteQueuedRoleRequest = useCallback((requestText: string) => {
    const trimmed = requestText.trim();
    if (!trimmed || workflowRoleRequestTargetNodeIds.length === 0) {
      return;
    }
    const nextPendingNodeRequests = removeWorkflowRoleQueuedRequest({
      targetNodeIds: workflowRoleRequestTargetNodeIds,
      pendingNodeRequests: pendingNodeRequestsRef.current,
      text: trimmed,
    });
    if (nextPendingNodeRequests === pendingNodeRequestsRef.current) {
      return;
    }
    pendingNodeRequestsRef.current = nextPendingNodeRequests;
    setPendingNodeRequests(nextPendingNodeRequests);
    const roleLabel =
      resolveStudioRoleDisplayLabel(workflowRoleId)
      || STUDIO_ROLE_TEMPLATES.find((role) => role.id === workflowRoleId)?.label
      || workflowRoleId;
    appendWorkspaceEvent({
      source: "workflow",
      actor: "user",
      level: "info",
      message: `${roleLabel} 추가 요청 삭제`,
    });
    setStatus(`${roleLabel} 저장 추가 요청을 삭제했습니다.`);
  }, [
    appendWorkspaceEvent,
    pendingNodeRequestsRef,
    setPendingNodeRequests,
    setStatus,
    workflowRoleId,
    workflowRoleRequestTargetNodeIds,
  ]);
  useGraphResearchKnowledgeSync({ cwd, feedPosts, graphNodes: graph.nodes, invokeFn: invoke });
  const {
    feedPageVm,
    showInspectorFirst,
    workflowAgentTerminalIslandElement,
    workflowInspectorPaneElement,
    workflowRoleDockElement,
    workflowUnityAutomationIslandElement,
  } = useMainAppWorkflowPresentation({
    applyPreset,
    canvasFullscreen,
    cwd,
    enqueueNodeRequest,
    feedPageVmInput: {
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
    },
    graph,
    graphFileName,
    isGraphRunning,
    isPresetKind,
    isWorkflowBusy,
    nodeProps: {
      artifactTypeOptions: [...artifactTypeOptions],
      cwd,
      model,
      nodeSettingsTitle:
        selectedNode?.type === "turn" &&
        String((selectedNode.config as Record<string, unknown> | undefined)?.sourceKind ?? "").trim().toLowerCase() === "handoff"
          ? "역할 노드 설정"
          : t("workflow.nodeSettings"),
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
      roleInternalExpanded:
        selectedNode != null && expandedRoleNodeIds.includes(selectedNode.id),
      toggleRoleInternalExpanded: () => {
        if (selectedNode) {
          toggleRoleInternalExpanded(selectedNode.id);
        }
      },
      addRolePerspectivePass,
      addRoleReviewPass,
      turnExecutorLabel,
      turnExecutorOptions: [...TURN_EXECUTOR_OPTIONS],
      turnModelOptions: [...TURN_MODEL_OPTIONS],
      turnReasoningLevelOptions: [...TURN_REASONING_LEVEL_OPTIONS],
      updateSelectedNodeConfig,
    },
    nodeStates,
    onInterruptWorkflowNode,
    onDeleteQueuedRoleRequest,
    onSaveRoleRequest,
    openWorkflowAgentTerminalNodeId,
    pendingNodeRequests,
    presetTemplateOptions,
    workflowRoleQueuedRequests,
    workflowRoleRequestTargetNodeIds,
    saveRoleRequestDisabled,
    selectedNode,
    selectedNodeRoleLockId,
    selectedTerminalNode,
    selectedTerminalRoleLockId,
    setStatus,
    setWorkflowRoleId,
    setWorkflowRolePrompt,
    setWorkspaceTab,
    toolsProps: {
      cwd,
      addNode,
      addRoleNode: onAddRoleNode,
      addCrawlerNode: onAddCrawlerNode,
      graphViewMode: workflowGraphViewMode,
      onSetGraphViewMode,
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
      handoffTaskId: workflowHandoffPanel.handoffTaskId,
      handoffRequestText: workflowHandoffPanel.handoffRequestText,
      setSelectedHandoffId: workflowHandoffPanel.setSelectedHandoffId,
      setHandoffFromRole: workflowHandoffPanel.setHandoffFromRole,
      setHandoffTaskId: workflowHandoffPanel.setHandoffTaskId,
      setHandoffRequestText: workflowHandoffPanel.setHandoffRequestText,
      createHandoff: workflowHandoffPanel.createHandoff,
      updateHandoffStatus: workflowHandoffPanel.updateHandoffStatus,
      consumeHandoff: workflowHandoffPanel.consumeHandoff,
    },
    workflowHandoffPanel,
    workflowRoleId,
    workflowRolePrompt,
    workflowRoleStatusByRole,
    workspaceEvents,
  });
  const { onSelectWorkspaceTab } = useWorkspaceNavigation({
    workspaceTab,
    setWorkspaceTab,
    dashboardDetailTopic,
    setDashboardDetailTopic,
    appendWorkspaceEvent,
  });
  const onOpenBriefingDocumentFromData = useBriefingDocumentActions({
    appendWorkspaceEvent,
    cwd,
    dashboardSnapshotsByTopic,
    feedPosts,
    feedRawAttachmentRef,
    hasTauriRuntime,
    invokeFn: invoke,
    setError,
    setFeedCategory,
    setFeedExecutorFilter,
    setFeedExpandedByPost,
    setFeedFilterOpen,
    setFeedGroupExpandedByRunId,
    setFeedInspectorPostId,
    setFeedKeyword,
    setFeedPeriodFilter,
    setFeedPosts,
    setFeedStatusFilter,
    setFeedTopicFilter,
    setStatus,
    setWorkspaceTab,
    t,
  });
  const { applyTurnExecutionFromModelSelection, onAgentQuickAction } = useTurnModelSelectionActions({
    appendWorkspaceEvent,
    graphNodes: graph.nodes,
    selectedNodeIds,
    setStatus,
    setWorkflowQuestion,
    setWorkspaceTab: (tab) => setWorkspaceTab(tab),
    updateNodeConfigById,
  });
  const onRoleRunCompleted = useRoleRunCompletionBridge({
    cwd,
    invokeFn: invoke,
    missionControl,
    setWorkflowRoleRuntimeStateByRole,
    workflowHandoffPanel,
  });
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
    onRoleRunCompleted,
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
    <MainAppShell
      activeApproval={activeApproval}
      agentLaunchRequest={agentLaunchRequest}
      agentLaunchRequestSeqRef={agentLaunchRequestSeqRef}
      appendWorkspaceEvent={appendWorkspaceEvent}
      approvalDecisionLabel={approvalDecisionLabel}
      approvalDecisions={APPROVAL_DECISIONS}
      approvalSourceLabel={approvalSourceLabel}
      approvalSubmitting={approvalSubmitting}
      adaptiveWorkspaceData={adaptiveWorkspaceState.data}
      adaptiveWorkspaceLoading={adaptiveWorkspaceState.loading}
      taskRoleLearningLoading={taskRoleLearningState.loading}
      taskRoleLearningSummaries={taskRoleLearningState.roleSummaries}
      taskRoleLearningImprovementSummaries={taskRoleLearningState.roleImprovementSummaries}
      appShellStyle={appShellStyle}
      authMode={authMode}
      authModeLabel={authModeLabel}
      batchScheduler={batchScheduler}
      boundedStageHeight={boundedStageHeight}
      boundedStageWidth={boundedStageWidth}
      canClearGraph={canClearGraph}
      canRunGraphNow={canRunGraphNow}
      canvasFullscreen={canvasFullscreen}
      canvasNodes={canvasNodes}
      canvasZoom={canvasZoom}
      codexAuthCheckPending={codexAuthCheckPending}
      codexAuthBusy={codexAuthBusy}
      codexMultiAgentMode={codexMultiAgentMode}
      codexMultiAgentModeOptions={codexMultiAgentModeOptions}
      connectPreviewLine={connectPreviewLine}
      cwd={cwd}
      dashboardDetailTopic={dashboardDetailTopic}
      dashboardIntelligenceConfig={dashboardIntelligenceConfig}
      dashboardIntelligenceRunStateByTopic={dashboardIntelligenceRunStateByTopic}
      dashboardSnapshotsByTopic={dashboardSnapshotsByTopic}
      deleteNode={deleteNode}
      draggingNodeIds={draggingNodeIds}
      edgeLines={edgeLines}
      engineStarted={engineStarted}
      error={error}
      feedPageVm={feedPageVm}
      feedPosts={feedPosts}
      formatNodeElapsedTime={formatNodeElapsedTime}
      formatUnknown={formatUnknown}
      graph={graph}
      graphCanvasRef={graphCanvasRef}
      graphFileName={graphFileName}
      graphKnowledge={graphKnowledge}
      graphViewMode={workflowGraphViewMode}
      handleInjectKnowledgeToWorkflow={handleInjectKnowledgeToWorkflow}
      isConnectingDrag={isConnectingDrag}
      invokeFn={invoke}
      isGraphRunning={isGraphRunning}
      isNodeDragAllowedTarget={isNodeDragAllowedTarget}
      hasTauriRuntime={hasTauriRuntime}
      isWorkflowBusy={isWorkflowBusy}
      loginCompleted={loginCompleted}
      codexLoginGateOpen={codexLoginGateOpen}
      marqueeSelection={marqueeSelection}
      missionControl={missionControl}
      nodeAnchorSides={NODE_ANCHOR_SIDES}
      nodeCardSummary={nodeCardSummary}
      nodeStates={nodeStates}
      nodeStatusLabel={nodeStatusLabel}
      nodeTypeLabel={nodeTypeLabel}
      normalizeCodexMultiAgentMode={normalizeCodexMultiAgentMode}
      onActivateWorkflowPanels={onActivateWorkflowPanels}
      onAgentQuickAction={onAgentQuickAction}
      onApplyModelSelection={(selection: any) =>
        applyTurnExecutionFromModelSelection({
          executor: selection.executor,
          turnModel: selection.turnModel,
          reasoningLevel: selection.reasoningLevel,
          modelLabel: selection.modelLabel,
          sourceLabel: "그래프 입력",
        })
      }
      onAddViaFlowNode={onAddViaFlowNode}
      onApplyRagTemplate={onApplyRagTemplate}
      onAssignSelectedEdgeAnchor={onAssignSelectedEdgeAnchor}
      onCancelGraphRun={onCancelGraphRun}
      onCancelPendingWebTurn={onCancelPendingWebTurn}
      onCanvasKeyDown={onCanvasKeyDown}
      onCanvasMouseDown={onCanvasMouseDown}
      onCanvasMouseMove={onCanvasMouseMove}
      onCanvasMouseUp={onCanvasMouseUp}
      onCanvasWheel={onCanvasWheel}
      onCanvasZoomIn={onCanvasZoomIn}
      onCanvasZoomOut={onCanvasZoomOut}
      onClearGraphCanvas={onClearGraphCanvas}
      onCloseQuickPanel={onCloseQuickPanel}
      onCopyPendingWebPrompt={onCopyPendingWebPrompt}
      onCopyWebBridgeConnectCode={onCopyWebBridgeConnectCode}
      onDismissPendingWebTurn={onDismissPendingWebTurn}
      onEdgeDragStart={onEdgeDragStart}
      onLoginCodex={onLoginCodex}
      onNodeAnchorDragStart={onNodeAnchorDragStart}
      onNodeAnchorDrop={onNodeAnchorDrop}
      onNodeDragStart={onNodeDragStart}
      onOpenBriefingDocumentFromData={onOpenBriefingDocumentFromData}
      onOpenFeedFromNode={(nodeId: string) => {
        setWorkspaceTab("knowledge");
        setStatus(`데이터베이스에서 ${nodeId} 노드 결과를 확인하세요.`);
      }}
      onOpenKnowledgeFilePicker={onOpenKnowledgeFilePicker}
      onOpenPendingProviderWindow={onOpenPendingProviderWindow}
      onOpenProviderSession={onOpenProviderSession}
      onOpenQuickPanelAgents={onOpenQuickPanelAgents}
      onOpenQuickPanelFeed={onOpenQuickPanelFeed}
      onOpenRunsFolder={onOpenRunsFolder}
      onOpenWebInputForNode={onOpenWebInputForNode}
      onRedoGraph={onRedoGraph}
      onReopenPendingWebTurn={onReopenPendingWebTurn}
      onRemoveKnowledgeFile={onRemoveKnowledgeFile}
      onRespondApproval={onRespondApproval}
      onRestartWebBridge={onRestartWebBridge}
      onRunDashboardTopicFromAgents={onRunDashboardTopicFromAgents}
      onRunDashboardTopicFromData={onRunDashboardTopicFromData}
      onRunGraph={onRunGraph}
      onSelectCwdDirectory={onSelectCwdDirectory}
      onAddRolePerspectivePassForNode={addRolePerspectivePassForNode}
      onAddRoleReviewPassForNode={addRoleReviewPassForNode}
      onFreezeAdaptiveWorkspace={() => {
        void adaptiveWorkspaceState.setLearningState("frozen");
      }}
      onResumeAdaptiveWorkspace={() => {
        void adaptiveWorkspaceState.setLearningState("active");
      }}
      onResetAdaptiveWorkspace={() => {
        void adaptiveWorkspaceState.resetWorkspaceLearning();
      }}
      onSetPmPlanningMode={onSetPmPlanningMode}
      onSelectRagModeNode={onSelectRagModeNode}
      onSelectWorkspaceTab={onSelectWorkspaceTab}
      onSubmitPendingWebTurn={onSubmitPendingWebTurn}
      onSubmitQuickPanelQuery={onSubmitQuickPanelQuery}
      onToggleNodeTerminal={(nodeId: string) =>
        setOpenWorkflowAgentTerminalNodeId((prev) => (prev === nodeId ? "" : nodeId))
      }
      onToggleRoleInternalExpanded={toggleRoleInternalExpanded}
      onToggleQuickPanel={onToggleQuickPanel}
      onUndoGraph={onUndoGraph}
      onUpdateRagModeFlowId={onUpdateRagModeFlowId}
      onUpdateRagSourceOptions={onUpdateRagSourceOptions}
      openTerminalNodeId={openWorkflowAgentTerminalNodeId}
      panMode={panMode}
      pendingApprovals={pendingApprovals}
      pendingWebConnectCheck={pendingWebConnectCheck}
      pendingWebLogin={pendingWebLogin}
      pendingWebTurn={pendingWebTurn}
      publishAction={publishAction}
      questionDirectInputNodeIds={questionDirectInputNodeIds}
      questionInputRef={questionInputRef}
      quickPanelOpen={quickPanelOpen}
      quickPanelQuery={quickPanelQuery}
      quickPanelRecentPosts={quickPanelRecentPosts}
      quickPanelWorkspaceLabel={quickPanelWorkspaceLabel}
      ragNodeProgress={ragNodeProgress}
      ragNodes={ragModeNodes}
      ragTemplateOptions={RAG_TEMPLATE_OPTIONS}
      expandedRoleNodeIds={expandedRoleNodeIds}
      redoStack={redoStack}
      refreshWebBridgeStatus={refreshWebBridgeStatus}
      resolvePendingWebLogin={resolvePendingWebLogin}
      runtimeNowMs={runtimeNowMs}
      running={running}
      selectedEdgeKey={selectedEdgeKey}
      selectedEdgeNodeIdSet={selectedEdgeNodeIdSet}
      selectedNodeId={selectedNodeId}
      selectedNodeIds={selectedNodeIds}
      setAgentLaunchRequest={setAgentLaunchRequest}
      setCanvasFullscreen={setCanvasFullscreen}
      setCodexMultiAgentMode={setCodexMultiAgentMode}
      setDashboardDetailTopic={setDashboardDetailTopic}
      setError={setError}
      setFeedInspectorPostId={setFeedInspectorPostId}
      setNodeSelection={setNodeSelection}
      setPanMode={setPanMode}
      setPendingWebConnectCheck={setPendingWebConnectCheck}
      setQuickPanelQuery={setQuickPanelQuery}
      setSelectedEdgeKey={setSelectedEdgeKey}
      setStatus={setStatus}
      setThemeMode={setThemeMode}
      setUsageResultClosed={setUsageResultClosed}
      setUserBackgroundImage={setUserBackgroundImage}
      setUserBackgroundOpacity={setUserBackgroundOpacity}
      setWebResponseDraft={setWebResponseDraft}
      setWorkflowQuestion={setWorkflowQuestion}
      setWorkspaceTab={setWorkspaceTab}
      showInspectorFirst={showInspectorFirst}
      stageInsetBottom={GRAPH_STAGE_INSET_BOTTOM}
      stageInsetX={GRAPH_STAGE_INSET_X}
      stageInsetY={GRAPH_STAGE_INSET_Y}
      status={status}
      suspendedWebTurn={suspendedWebTurn}
      t={t}
      tasksLeftNavHidden={tasksLeftNavHidden}
      themeMode={themeMode}
      themeModeOptions={themeModeOptions}
      turnModelLabel={turnModelLabel}
      turnRoleLabel={turnRoleLabel}
      undoStack={undoStack}
      usageInfoText={usageInfoText}
      usageResultClosed={usageResultClosed}
      userBackgroundImage={userBackgroundImage}
      userBackgroundOpacity={userBackgroundOpacity}
      viaNodeOptions={VIA_NODE_OPTIONS.map((row) => ({
        value: row.value,
        label: row.label,
      }))}
      webBridgeConnectCode={webBridgeConnectCode}
      webBridgeStatus={webBridgeStatus}
      webProviderLabel={webProviderLabel}
      webResponseDraft={webResponseDraft}
      webTurnFloatingRef={webTurnFloatingRef}
      webTurnPanel={webTurnPanel}
      webWorkerBusy={webWorkerBusy}
      workflowAgentTerminalIslandElement={workflowAgentTerminalIslandElement}
      workflowInspectorPaneElement={workflowInspectorPaneElement}
      workflowQuestion={workflowQuestion}
      workflowRoleDockElement={workflowRoleDockElement}
      workflowRoleId={workflowRoleId}
      workflowSidePanelsVisible={workflowSidePanelsVisible}
      workflowUnityAutomationIslandElement={workflowUnityAutomationIslandElement}
      workspaceEvents={workspaceEvents}
      workspaceTab={workspaceTab}
      workspaceTopbarTabs={workspaceTopbarTabs}
    />
  );
}
export default App;
