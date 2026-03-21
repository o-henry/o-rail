import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

export function WorkspaceTabSkeleton(props: { tab: string }) {
  const titleByTab: Record<string, string> = {
    feed: "피드 불러오는 중",
    knowledge: "데이터베이스 불러오는 중",
    visualize: "차트 불러오는 중",
    adaptation: "개선 탭 불러오는 중",
    tasks: "태스크 불러오는 중",
    shell: "터미널 불러오는 중",
    agents: "에이전트 불러오는 중",
    settings: "설정 불러오는 중",
    intelligence: "데이터 인사이트 불러오는 중",
  };
  const title = titleByTab[String(props.tab ?? "").trim()] ?? "작업공간 불러오는 중";

  return (
    <section aria-label={title} className="workspace-tab-skeleton workspace-tab-panel">
      <div className="workspace-tab-skeleton-strip workspace-tab-skeleton-strip-title" />
      <div className="workspace-tab-skeleton-strip workspace-tab-skeleton-strip-subtitle" />
      <div className="workspace-tab-skeleton-card" />
      <div className="workspace-tab-skeleton-card workspace-tab-skeleton-card-large" />
    </section>
  );
}

export function MainAppWorkspaceContent(props: any) {
  const initialTab = String(props.workspaceTab ?? "tasks");
  const [mountedTabs, setMountedTabs] = useState<Record<string, boolean>>(() => ({
    [initialTab]: true,
  }));
  const actualTab = String(props.workspaceTab ?? "").trim();
  const displayTab = String(props.displayWorkspaceTab ?? actualTab).trim() || actualTab;

  useEffect(() => {
    if (!actualTab || mountedTabs[actualTab]) {
      return;
    }
    setMountedTabs((current) => (current[actualTab] ? current : { ...current, [actualTab]: true }));
  }, [actualTab, mountedTabs]);

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
      codexAuthCheckPending={props.codexAuthCheckPending}
      cwd={props.cwd}
      hasTauriRuntime={props.hasTauriRuntime}
      invokeFn={props.invokeFn}
      loginCompleted={props.loginCompleted}
      onOpenSettings={handleOpenSettings}
      publishAction={props.publishAction}
      setStatus={props.setStatus}
    />
  ), [
    handleOpenSettings,
    props.appendWorkspaceEvent,
    props.codexAuthCheckPending,
    props.cwd,
    props.hasTauriRuntime,
    props.invokeFn,
    props.loginCompleted,
    props.publishAction,
    props.setStatus,
  ]);
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

  const renderTab = (tab: string, content: ReactNode) => {
    const isActive = displayTab === tab;
    const isMounted = mountedTabs[tab] || actualTab === tab;
    const isPending = isActive && actualTab !== tab;
    if (isPending) {
      return <WorkspaceTabSkeleton tab={tab} />;
    }
    if (!isMounted) {
      return null;
    }
    return <div hidden={!isActive}>{content}</div>;
  };

  return (
    <>
      {renderTab("feed", feedTabContent)}
      {renderTab("knowledge", knowledgeTabContent)}
      {renderTab("visualize", visualizeTabContent)}
      {renderTab("adaptation", adaptationTabContent)}
      {renderTab("tasks", tasksTabContent)}
      {renderTab("shell", shellTabContent)}
      {renderTab("agents", agentsTabContent)}
      {renderTab("settings", settingsTabContent)}
      {renderTab("intelligence", intelligenceTabContent)}
    </>
  );
}
