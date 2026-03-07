import AgentsPage from "../../../pages/agents/AgentsPage";
import BridgePage from "../../../pages/bridge/BridgePage";
import FeedPage from "../../../pages/feed/FeedPage";
import KnowledgeBasePage from "../../../pages/knowledge/KnowledgeBasePage";
import DashboardIntelligenceSettings from "../../../pages/settings/DashboardIntelligenceSettings";
import SettingsPage from "../../../pages/settings/SettingsPage";
import WorkflowWorkspaceDock from "../../../pages/workflow/WorkflowWorkspaceDock";

export function MainAppWorkspaceContent(props: any) {
  const handleInjectContextSources = (entries: any[]) => {
    const sourceIds = entries.map((entry) => entry.id);
    props.publishAction({
      type: "inject_context_sources",
      payload: { sourceIds },
    });
    props.onInjectKnowledgeToWorkflow?.(entries);
    props.setStatus(`데이터베이스 컨텍스트 주입 요청: ${sourceIds.length}건`);
    props.onSelectWorkspaceTab("workflow");
  };

  return (
    <>
      {props.workspaceTab === "workbench" && (
        <section className="workflow-workspace-tab workspace-tab-panel">
          <WorkflowWorkspaceDock
            activeRoleId={props.workflowRoleId}
            cwd={props.cwd}
            graphFileName={props.graphFileName}
            graphNodes={props.graphNodes}
            nodeStates={props.nodeStates}
            workspaceEvents={props.workspaceEvents}
          />
        </section>
      )}
      {props.workspaceTab === "feed" && <FeedPage vm={props.feedPageVm} />}
      {props.workspaceTab === "knowledge" && (
        <KnowledgeBasePage
          cwd={props.cwd}
          posts={props.feedPosts}
          onInjectContextSources={handleInjectContextSources}
        />
      )}
      {props.workspaceTab === "agents" && (
        <AgentsPage
          codexMultiAgentMode={props.codexMultiAgentMode}
          launchRequest={props.agentLaunchRequest}
          missionControl={props.missionControl}
          onQuickAction={props.onAgentQuickAction}
          onRunRole={({ roleId, taskId, prompt, runId }) => {
            props.publishAction({
              type: "run_role",
              payload: {
                roleId,
                taskId,
                prompt,
                runId,
                sourceTab: "agents",
              },
            });
          }}
          onOpenDataTab={() => props.onSelectWorkspaceTab("intelligence")}
          onRunDataTopic={props.onRunDashboardTopicFromAgents}
          runStateByTopic={props.dashboardIntelligenceRunStateByTopic}
          topicSnapshots={props.dashboardSnapshotsByTopic}
        />
      )}
      {props.workspaceTab === "settings" && (
        <section className="panel-card settings-view workspace-tab-panel">
          <SettingsPage
            authModeText={props.authModeText}
            codexAuthBusy={props.codexAuthBusy}
            compact={false}
            cwd={props.cwd}
            engineStarted={props.engineStarted}
            isGraphRunning={props.isGraphRunning}
            loginCompleted={props.loginCompleted}
            themeMode={props.themeMode}
            themeModeOptions={[...props.themeModeOptions]}
            codexMultiAgentMode={props.codexMultiAgentMode}
            codexMultiAgentModeOptions={[...props.codexMultiAgentModeOptions]}
            userBackgroundImage={props.userBackgroundImage}
            userBackgroundOpacity={props.userBackgroundOpacity}
            onCloseUsageResult={() => props.setUsageResultClosed(true)}
            onOpenRunsFolder={() => void props.onOpenRunsFolder()}
            onSelectCwdDirectory={() => void props.onSelectCwdDirectory()}
            onSetThemeMode={props.setThemeMode}
            onSetCodexMultiAgentMode={(next) => props.setCodexMultiAgentMode(props.normalizeCodexMultiAgentMode(next))}
            onSetUserBackgroundImage={props.setUserBackgroundImage}
            onSetUserBackgroundOpacity={(next) =>
              props.setUserBackgroundOpacity(Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0)
            }
            onToggleCodexLogin={() => void props.onLoginCodex()}
            running={props.running}
            status={props.status}
            usageInfoText={props.usageInfoText}
            usageResultClosed={props.usageResultClosed}
          />
          <BridgePage
            busy={props.webWorkerBusy}
            connectCode={props.webBridgeConnectCode}
            embedded
            onCopyConnectCode={() => void props.onCopyWebBridgeConnectCode()}
            onRefreshStatus={() => void props.refreshWebBridgeStatus()}
            onRestartBridge={() => void props.onRestartWebBridge()}
            status={props.webBridgeStatus}
          />
        </section>
      )}
      {props.workspaceTab === "intelligence" && (
        <section className="panel-card settings-view data-intelligence-view workspace-tab-panel">
          <DashboardIntelligenceSettings
            briefingDocuments={props.briefingDocuments}
            config={props.dashboardIntelligenceConfig}
            disabled={props.running || props.isGraphRunning}
            onOpenBriefingDocument={props.onOpenBriefingDocumentFromData}
            onRunTopic={props.onRunDashboardTopicFromData}
            runStateByTopic={props.dashboardIntelligenceRunStateByTopic}
            snapshotsByTopic={props.dashboardSnapshotsByTopic}
          />
        </section>
      )}
    </>
  );
}
