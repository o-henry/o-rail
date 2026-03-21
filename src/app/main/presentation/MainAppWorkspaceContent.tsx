import { useCallback, useEffect, useMemo, useState } from "react";
import AgentsPage from "../../../pages/agents/AgentsPage";
import AdaptationPage from "./AdaptationPage";
import BridgePage from "../../../pages/bridge/BridgePage";
import FeedPage from "../../../pages/feed/FeedPage";
import KnowledgeBasePage from "../../../pages/knowledge/KnowledgeBasePage";
import ShellPage from "../../../pages/shell/ShellPage";
import DashboardIntelligenceSettings from "../../../pages/settings/DashboardIntelligenceSettings";
import SettingsPage from "../../../pages/settings/SettingsPage";
import TasksPage from "../../../pages/tasks/TasksPage";
import VisualizePage from "../../../pages/visualize/VisualizePage";
import { writeStoredSelectedRunId } from "../../../pages/visualize/visualizeSelection";

export function MainAppWorkspaceContent(props: any) {
  const [mountedTabs, setMountedTabs] = useState<Record<string, boolean>>(() => ({
    [String(props.workspaceTab ?? "tasks")]: true,
  }));

  useEffect(() => {
    const nextTab = String(props.workspaceTab ?? "").trim();
    if (!nextTab) {
      return;
    }
    setMountedTabs((current) => (current[nextTab] ? current : { ...current, [nextTab]: true }));
  }, [props.workspaceTab]);

  const handleInjectContextSources = useCallback((entries: any[]) => {
    const sourceIds = entries.map((entry) => entry.id);
    props.publishAction({
      type: "inject_context_sources",
      payload: { sourceIds },
    });
    props.onInjectKnowledgeToWorkflow?.(entries);
    props.setStatus(`데이터베이스 컨텍스트 주입 요청: ${sourceIds.length}건`);
    props.onSelectWorkspaceTab("workflow");
  }, [props.onInjectKnowledgeToWorkflow, props.onSelectWorkspaceTab, props.publishAction, props.setStatus]);

  const handleOpenKnowledgeEntry = useCallback((entryId: string) => {
    props.onSelectWorkspaceTab("knowledge");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("rail:open-knowledge-entry", { detail: { entryId } }));
    }, 0);
  }, [props.onSelectWorkspaceTab]);

  const handleOpenVisualizeEntry = useCallback((entry: { runId?: string }) => {
    const runId = String(entry?.runId ?? "").trim();
    if (!runId) {
      return;
    }
    writeStoredSelectedRunId(props.cwd, runId);
    props.onSelectWorkspaceTab("visualize");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("rail:knowledge-selection-changed", { detail: { runId } }));
    }, 0);
  }, [props.cwd, props.onSelectWorkspaceTab]);

  const handleOpenSettings = useCallback(() => {
    props.onSelectWorkspaceTab("settings");
  }, [props.onSelectWorkspaceTab]);

  const handleOpenIntelligence = useCallback(() => {
    props.onSelectWorkspaceTab("intelligence");
  }, [props.onSelectWorkspaceTab]);

  const handleRunRoleFromAgents = useCallback(({ roleId, taskId, prompt, runId }: {
    roleId: string;
    taskId: string;
    prompt?: string;
    runId?: string;
  }) => {
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
  }, [props.publishAction]);

  const feedTabContent = useMemo(() => <FeedPage vm={props.feedPageVm} />, [props.feedPageVm]);
  const knowledgeTabContent = useMemo(() => (
    <KnowledgeBasePage
      cwd={props.cwd}
      isActive={props.workspaceTab === "knowledge"}
      posts={props.feedPosts}
      onInjectContextSources={handleInjectContextSources}
      onOpenInVisualize={handleOpenVisualizeEntry}
    />
  ), [handleInjectContextSources, handleOpenVisualizeEntry, props.cwd, props.feedPosts, props.workspaceTab]);
  const visualizeTabContent = useMemo(() => (
    <VisualizePage
      cwd={props.cwd}
      hasTauriRuntime={props.hasTauriRuntime}
      isActive={props.workspaceTab === "visualize"}
      onOpenKnowledgeEntry={handleOpenKnowledgeEntry}
    />
  ), [handleOpenKnowledgeEntry, props.cwd, props.hasTauriRuntime, props.workspaceTab]);
  const adaptationTabContent = useMemo(() => (
    <AdaptationPage
      data={props.adaptiveWorkspaceData}
      loading={props.adaptiveWorkspaceLoading}
      taskLearningLoading={props.taskRoleLearningLoading}
      taskRoleSummaries={props.taskRoleLearningSummaries}
      taskRoleImprovementSummaries={props.taskRoleLearningImprovementSummaries}
      onFreeze={props.onFreezeAdaptiveWorkspace}
      onResume={props.onResumeAdaptiveWorkspace}
      onReset={props.onResetAdaptiveWorkspace}
    />
  ), [
    props.adaptiveWorkspaceData,
    props.adaptiveWorkspaceLoading,
    props.onFreezeAdaptiveWorkspace,
    props.onResetAdaptiveWorkspace,
    props.onResumeAdaptiveWorkspace,
    props.taskRoleImprovementSummaries,
    props.taskRoleLearningLoading,
    props.taskRoleLearningSummaries,
  ]);
  const tasksTabContent = useMemo(() => (
    <TasksPage
      appendWorkspaceEvent={props.appendWorkspaceEvent}
      cwd={props.cwd}
      hasTauriRuntime={props.hasTauriRuntime}
      invokeFn={props.invokeFn}
      onOpenSettings={handleOpenSettings}
      publishAction={props.publishAction}
      setStatus={props.setStatus}
    />
  ), [handleOpenSettings, props.appendWorkspaceEvent, props.cwd, props.hasTauriRuntime, props.invokeFn, props.publishAction, props.setStatus]);
  const shellTabContent = useMemo(() => (
    <ShellPage
      appendWorkspaceEvent={props.appendWorkspaceEvent}
      cwd={props.cwd}
      hasTauriRuntime={props.hasTauriRuntime}
      invokeFn={props.invokeFn}
      publishAction={props.publishAction}
      setStatus={props.setStatus}
    />
  ), [props.appendWorkspaceEvent, props.cwd, props.hasTauriRuntime, props.invokeFn, props.publishAction, props.setStatus]);
  const agentsTabContent = useMemo(() => (
    <AgentsPage
      codexMultiAgentMode={props.codexMultiAgentMode}
      launchRequest={props.agentLaunchRequest}
      missionControl={props.missionControl}
      onQuickAction={props.onAgentQuickAction}
      onRunRole={handleRunRoleFromAgents}
      onOpenDataTab={handleOpenIntelligence}
      onRunDataTopic={props.onRunDashboardTopicFromAgents}
      runStateByTopic={props.dashboardIntelligenceRunStateByTopic}
      topicSnapshots={props.dashboardSnapshotsByTopic}
    />
  ), [
    handleOpenIntelligence,
    handleRunRoleFromAgents,
    props.agentLaunchRequest,
    props.codexMultiAgentMode,
    props.dashboardIntelligenceRunStateByTopic,
    props.dashboardSnapshotsByTopic,
    props.missionControl,
    props.onAgentQuickAction,
    props.onRunDashboardTopicFromAgents,
  ]);
  const settingsTabContent = useMemo(() => (
    <section className="panel-card settings-view workspace-tab-panel">
      <SettingsPage
        authModeText={props.authModeText}
        codexAuthBusy={props.codexAuthBusy}
        compact={false}
        cwd={props.cwd}
        engineStarted={props.engineStarted}
        isGraphRunning={props.isGraphRunning}
        loginCompleted={props.loginCompleted}
        codexMultiAgentMode={props.codexMultiAgentMode}
        codexMultiAgentModeOptions={[...props.codexMultiAgentModeOptions]}
        userBackgroundImage={props.userBackgroundImage}
        userBackgroundOpacity={props.userBackgroundOpacity}
        onCloseUsageResult={() => props.setUsageResultClosed(true)}
        onOpenRunsFolder={() => void props.onOpenRunsFolder()}
        onSelectCwdDirectory={() => void props.onSelectCwdDirectory()}
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
  ), [
    props.authModeText,
    props.codexAuthBusy,
    props.codexMultiAgentMode,
    props.codexMultiAgentModeOptions,
    props.cwd,
    props.engineStarted,
    props.isGraphRunning,
    props.loginCompleted,
    props.normalizeCodexMultiAgentMode,
    props.onCopyWebBridgeConnectCode,
    props.onLoginCodex,
    props.onOpenRunsFolder,
    props.onRestartWebBridge,
    props.onSelectCwdDirectory,
    props.refreshWebBridgeStatus,
    props.running,
    props.setCodexMultiAgentMode,
    props.setUsageResultClosed,
    props.setUserBackgroundImage,
    props.setUserBackgroundOpacity,
    props.status,
    props.usageInfoText,
    props.usageResultClosed,
    props.userBackgroundImage,
    props.userBackgroundOpacity,
    props.webBridgeConnectCode,
    props.webBridgeStatus,
    props.webWorkerBusy,
  ]);
  const intelligenceTabContent = useMemo(() => (
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
  ), [
    props.briefingDocuments,
    props.dashboardIntelligenceConfig,
    props.dashboardIntelligenceRunStateByTopic,
    props.dashboardSnapshotsByTopic,
    props.isGraphRunning,
    props.onOpenBriefingDocumentFromData,
    props.onRunDashboardTopicFromData,
    props.running,
  ]);

  return (
    <>
      {mountedTabs.feed ? (
        <div hidden={props.workspaceTab !== "feed"}>
          {feedTabContent}
        </div>
      ) : null}
      {mountedTabs.knowledge ? (
        <div hidden={props.workspaceTab !== "knowledge"}>
          {knowledgeTabContent}
        </div>
      ) : null}
      {mountedTabs.visualize ? (
        <div hidden={props.workspaceTab !== "visualize"}>
          {visualizeTabContent}
        </div>
      ) : null}
      {mountedTabs.adaptation ? (
        <div hidden={props.workspaceTab !== "adaptation"}>
          {adaptationTabContent}
        </div>
      ) : null}
      {mountedTabs.tasks ? (
        <div hidden={props.workspaceTab !== "tasks"}>
          {tasksTabContent}
        </div>
      ) : null}
      {mountedTabs.shell ? (
        <div hidden={props.workspaceTab !== "shell"}>
          {shellTabContent}
        </div>
      ) : null}
      {mountedTabs.agents ? (
        <div hidden={props.workspaceTab !== "agents"}>
          {agentsTabContent}
        </div>
      ) : null}
      {mountedTabs.settings ? (
        <div hidden={props.workspaceTab !== "settings"}>
          {settingsTabContent}
        </div>
      ) : null}
      {mountedTabs.intelligence ? (
        <div hidden={props.workspaceTab !== "intelligence"}>
          {intelligenceTabContent}
        </div>
      ) : null}
    </>
  );
}
