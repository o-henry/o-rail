import AppNav from "../../../components/AppNav";
import WorkflowPage from "../../../pages/workflow/WorkflowPage";
import WorkflowRagModeDock from "../../../pages/workflow/WorkflowRagModeDock";
import { NavIcon } from "../../mainAppGraphHelpers";
import WorkflowCanvasPane from "./WorkflowCanvasPane";
import { MainAppModals } from "./MainAppModals";
import { MainAppWorkspaceContent } from "./MainAppWorkspaceContent";
import { WorkspaceQuickPanel } from "./WorkspaceQuickPanel";

export function MainAppShell(props: any) {
  const {
    activeApproval,
    agentLaunchRequest,
    agentLaunchRequestSeqRef,
    approvalDecisionLabel,
    approvalDecisions,
    approvalSourceLabel,
    approvalSubmitting,
    appShellStyle,
    authMode,
    batchScheduler,
    boundedStageHeight,
    boundedStageWidth,
    canClearGraph,
    canRunGraphNow,
    canvasFullscreen,
    canvasNodes,
    canvasZoom,
    codexAuthBusy,
    codexMultiAgentMode,
    codexMultiAgentModeOptions,
    connectPreviewLine,
    dashboardDetailTopic,
    dashboardIntelligenceConfig,
    dashboardIntelligenceRunStateByTopic,
    dashboardSnapshotsByTopic,
    deleteNode,
    draggingNodeIds,
    edgeLines,
    expandedRoleNodeIds,
    error,
    feedPageVm,
    feedPosts,
    formatNodeElapsedTime,
    formatUnknown,
    graph,
    graphCanvasRef,
    graphFileName,
    graphViewMode,
    handleInjectKnowledgeToWorkflow,
    isConnectingDrag,
    isGraphRunning,
    isNodeDragAllowedTarget,
    isWorkflowBusy,
    loginCompleted,
    marqueeSelection,
    missionControl,
    nodeAnchorSides,
    nodeCardSummary,
    nodeStates,
    nodeStatusLabel,
    nodeTypeLabel,
    onActivateWorkflowPanels,
    onAgentQuickAction,
    onApplyModelSelection,
    onAssignSelectedEdgeAnchor,
    onCancelGraphRun,
    onCancelPendingWebTurn,
    onCanvasKeyDown,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    onCanvasWheel,
    onCanvasZoomIn,
    onCanvasZoomOut,
    onCloseQuickPanel,
    onCopyPendingWebPrompt,
    onCopyWebBridgeConnectCode,
    onDismissPendingWebTurn,
    onEdgeDragStart,
    onLoginCodex,
    onNodeAnchorDragStart,
    onNodeAnchorDrop,
    onNodeDragStart,
    onOpenBriefingDocumentFromData,
    onOpenFeedFromNode,
    onOpenPendingProviderWindow,
    onOpenProviderSession,
    onOpenQuickPanelAgents,
    onOpenQuickPanelFeed,
    onOpenRunsFolder,
    onAddRolePerspectivePassForNode,
    onAddRoleReviewPassForNode,
    onRedoGraph,
    onReopenPendingWebTurn,
    onRespondApproval,
    onRestartWebBridge,
    onRunDashboardTopicFromAgents,
    onRunDashboardTopicFromData,
    onRunGraph,
    onSelectCwdDirectory,
    onSetPmPlanningMode,
    onSelectWorkspaceTab,
    onSubmitPendingWebTurn,
    onSubmitQuickPanelQuery,
    onToggleQuickPanel,
    onToggleNodeTerminal,
    onToggleRoleInternalExpanded,
    onUndoGraph,
    openTerminalNodeId,
    panMode,
    pendingApprovals,
    pendingWebConnectCheck,
    pendingWebLogin,
    pendingWebTurn,
    questionDirectInputNodeIds,
    questionInputRef,
    quickPanelOpen,
    quickPanelQuery,
    quickPanelRecentPosts,
    quickPanelWorkspaceLabel,
    ragNodeProgress,
    ragNodes,
    ragTemplateOptions,
    redoStack,
    refreshWebBridgeStatus,
    resolvePendingWebLogin,
    runtimeNowMs,
    running,
    selectedEdgeKey,
    selectedEdgeNodeIdSet,
    selectedNodeId,
    selectedNodeIds,
    setAgentLaunchRequest,
    setCanvasFullscreen,
    setCodexMultiAgentMode,
    setDashboardDetailTopic,
    setNodeSelection,
    setPanMode,
    setPendingWebConnectCheck,
    setQuickPanelQuery,
    setSelectedEdgeKey,
    setStatus,
    setThemeMode,
    setUsageResultClosed,
    setUserBackgroundImage,
    setUserBackgroundOpacity,
    setWebResponseDraft,
    setWorkspaceTab,
    showInspectorFirst,
    stageInsetBottom,
    stageInsetX,
    stageInsetY,
    status,
    suspendedWebTurn,
    t,
    themeMode,
    themeModeOptions,
    turnModelLabel,
    turnRoleLabel,
    undoStack,
    usageInfoText,
    usageResultClosed,
    userBackgroundImage,
    userBackgroundOpacity,
    viaNodeOptions,
    webBridgeConnectCode,
    webBridgeStatus,
    webProviderLabel,
    webResponseDraft,
    webTurnFloatingRef,
    webTurnPanel,
    webWorkerBusy,
    workflowAgentTerminalIslandElement,
    workflowInspectorPaneElement,
    workflowQuestion,
    workflowRoleDockElement,
    workflowRoleId,
    workflowSidePanelsVisible,
    workflowUnityAutomationIslandElement,
    workspaceEvents,
    workspaceTab,
    workspaceTopbarTabs,
  } = props;

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
              {workspaceTopbarTabs.map((item: any) => {
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
              onClick={() => props.setError("")}
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
              graphNodes={graph.nodes}
              canvasZoom={canvasZoom}
              graphViewMode={graphViewMode}
              connectPreviewLine={connectPreviewLine}
              deleteNode={deleteNode}
              draggingNodeIds={draggingNodeIds}
              edgeLines={edgeLines}
              expandedRoleNodeIds={expandedRoleNodeIds}
              formatNodeElapsedTime={formatNodeElapsedTime}
              graphCanvasRef={graphCanvasRef}
              onActivateWorkspacePanels={onActivateWorkflowPanels}
              isConnectingDrag={isConnectingDrag}
              isGraphRunning={isGraphRunning}
              isNodeDragAllowedTarget={isNodeDragAllowedTarget}
              isWorkflowBusy={isWorkflowBusy}
              marqueeSelection={marqueeSelection}
              nodeAnchorSides={nodeAnchorSides}
              nodeCardSummary={nodeCardSummary}
              nodeStates={nodeStates}
              nodeStatusLabel={nodeStatusLabel}
              nodeTypeLabel={nodeTypeLabel}
              openTerminalNodeId={openTerminalNodeId}
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
              onOpenFeedFromNode={onOpenFeedFromNode}
              onAddRolePerspectivePass={onAddRolePerspectivePassForNode}
              onAddRoleReviewPass={onAddRoleReviewPassForNode}
              onSetPmPlanningMode={onSetPmPlanningMode}
              onToggleNodeTerminal={onToggleNodeTerminal}
              onToggleRoleInternalExpanded={onToggleRoleInternalExpanded}
              onClearGraph={props.onClearGraphCanvas}
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
              onApplyModelSelection={onApplyModelSelection}
              agentTerminalIsland={workflowAgentTerminalIslandElement}
              setWorkflowQuestion={props.setWorkflowQuestion}
              stageInsetX={stageInsetX}
              stageInsetY={stageInsetY}
              stageInsetBottom={stageInsetBottom}
              suspendedWebTurn={suspendedWebTurn}
              turnModelLabel={turnModelLabel}
              turnRoleLabel={turnRoleLabel}
              canClearGraph={canClearGraph}
              undoStackLength={undoStack.length}
              workflowQuestion={workflowQuestion}
            />

            {!canvasFullscreen && workflowSidePanelsVisible && (
              <div className="workflow-right-stack">
                {graphViewMode === "rag" ? (
                  <WorkflowRagModeDock
                    isGraphRunning={isGraphRunning}
                    onAddRagNode={props.onAddViaFlowNode}
                    onApplyTemplate={props.onApplyRagTemplate}
                    onSelectNode={props.onSelectRagModeNode}
                    onUpdateFlowId={props.onUpdateRagModeFlowId}
                    onUpdateSourceOptions={props.onUpdateRagSourceOptions}
                    ragNodeProgress={ragNodeProgress}
                    ragNodes={ragNodes}
                    ragTemplateOptions={ragTemplateOptions}
                    selectedNodeId={selectedNodeId}
                    viaNodeOptions={viaNodeOptions}
                  />
                ) : (
                  <>
                    {showInspectorFirst ? workflowInspectorPaneElement : workflowRoleDockElement}
                    {workflowUnityAutomationIslandElement}
                    {showInspectorFirst ? workflowRoleDockElement : workflowInspectorPaneElement}
                  </>
                )}
              </div>
            )}
          </WorkflowPage>
        )}
        <MainAppWorkspaceContent
          agentLaunchRequest={agentLaunchRequest}
          agentLaunchRequestSeqRef={agentLaunchRequestSeqRef}
          authModeText={props.authModeLabel(authMode)}
          briefingDocuments={feedPosts
            .filter((post: any) => post.status === "done" || post.status === "low_quality")
            .map((post: any) => ({
              id: post.id,
              runId: post.runId,
              summary: post.summary,
              sourceFile: post.sourceFile,
              agentName: post.agentName,
              createdAt: post.createdAt,
              isFinalDocument: post.isFinalDocument,
              status: post.status,
            }))}
          codexAuthBusy={codexAuthBusy}
          codexMultiAgentMode={codexMultiAgentMode}
          codexMultiAgentModeOptions={codexMultiAgentModeOptions}
          connectedProviderCount={webBridgeStatus.connectedProviders.length}
          cwd={props.cwd}
          dashboardDetailTopic={dashboardDetailTopic}
          dashboardIntelligenceConfig={dashboardIntelligenceConfig}
          dashboardIntelligenceRunStateByTopic={dashboardIntelligenceRunStateByTopic}
          dashboardSnapshotsByTopic={dashboardSnapshotsByTopic}
          enabledScheduleCount={batchScheduler.schedules.filter((item: any) => item.status === "enabled").length}
          engineStarted={props.engineStarted}
          feedPageVm={feedPageVm}
          feedPosts={feedPosts}
          graphFileName={graphFileName}
          graphNodes={graph.nodes}
          isGraphRunning={isGraphRunning}
          launchRequest={agentLaunchRequest}
          loginCompleted={loginCompleted}
          missionControl={missionControl}
          normalizeCodexMultiAgentMode={props.normalizeCodexMultiAgentMode}
          onInjectKnowledgeToWorkflow={handleInjectKnowledgeToWorkflow}
          onAgentQuickAction={onAgentQuickAction}
          onCopyWebBridgeConnectCode={onCopyWebBridgeConnectCode}
          onLoginCodex={onLoginCodex}
          onOpenBriefingDocumentFromData={onOpenBriefingDocumentFromData}
          onOpenRunsFolder={onOpenRunsFolder}
          onRestartWebBridge={onRestartWebBridge}
          onRunDashboardTopicFromAgents={onRunDashboardTopicFromAgents}
          onRunDashboardTopicFromData={onRunDashboardTopicFromData}
          onSelectCwdDirectory={onSelectCwdDirectory}
          onSelectWorkspaceTab={onSelectWorkspaceTab}
          pendingApprovalsCount={pendingApprovals.length}
          publishAction={props.publishAction}
          refreshWebBridgeStatus={refreshWebBridgeStatus}
          running={running}
          scheduleCount={batchScheduler.schedules.length}
          setAgentLaunchRequest={setAgentLaunchRequest}
          setCodexMultiAgentMode={setCodexMultiAgentMode}
          setDashboardDetailTopic={setDashboardDetailTopic}
          setThemeMode={setThemeMode}
          setStatus={setStatus}
          setUsageResultClosed={setUsageResultClosed}
          setUserBackgroundImage={setUserBackgroundImage}
          setUserBackgroundOpacity={setUserBackgroundOpacity}
          status={status}
          themeMode={themeMode}
          themeModeOptions={themeModeOptions}
          nodeStates={nodeStates}
          usageInfoText={usageInfoText}
          usageResultClosed={usageResultClosed}
          userBackgroundImage={userBackgroundImage}
          userBackgroundOpacity={userBackgroundOpacity}
          webBridgeConnectCode={webBridgeConnectCode}
          webBridgeRunning={webBridgeStatus.running}
          webBridgeStatus={webBridgeStatus}
          webWorkerBusy={webWorkerBusy}
          workflowRoleId={workflowRoleId}
          workspaceEvents={workspaceEvents}
          workspaceTab={workspaceTab}
        />
      </section>
      <MainAppModals
        activeApproval={activeApproval}
        approvalDecisionLabel={approvalDecisionLabel}
        approvalDecisions={approvalDecisions}
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
        setWorkspaceTab={(next: string) => setWorkspaceTab(next === "bridge" ? "settings" : next)}
        t={t}
        webProviderLabel={webProviderLabel}
        webResponseDraft={webResponseDraft}
        webTurnFloatingRef={webTurnFloatingRef}
        webTurnPanel={webTurnPanel}
      />
    </main>
  );
}
