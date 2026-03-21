import { useEffect, useState } from "react";
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

  const handleOpenKnowledgeEntry = (entryId: string) => {
    props.onSelectWorkspaceTab("knowledge");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("rail:open-knowledge-entry", { detail: { entryId } }));
    }, 0);
  };

  const handleOpenVisualizeEntry = (entry: { runId?: string }) => {
    const runId = String(entry?.runId ?? "").trim();
    if (!runId) {
      return;
    }
    writeStoredSelectedRunId(props.cwd, runId);
    props.onSelectWorkspaceTab("visualize");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("rail:knowledge-selection-changed", { detail: { runId } }));
    }, 0);
  };

  return (
    <>
      {props.workspaceTab === "feed" && <FeedPage vm={props.feedPageVm} />}
      {mountedTabs.knowledge ? (
        <div hidden={props.workspaceTab !== "knowledge"}>
          <KnowledgeBasePage
            cwd={props.cwd}
            posts={props.feedPosts}
            onInjectContextSources={handleInjectContextSources}
            onOpenInVisualize={handleOpenVisualizeEntry}
          />
        </div>
      ) : null}
      {mountedTabs.visualize ? (
        <div hidden={props.workspaceTab !== "visualize"}>
          <VisualizePage
            cwd={props.cwd}
            hasTauriRuntime={props.hasTauriRuntime}
            onOpenKnowledgeEntry={handleOpenKnowledgeEntry}
          />
        </div>
      ) : null}
      {props.workspaceTab === "adaptation" && (
        <AdaptationPage
          data={props.adaptiveWorkspaceData}
          loading={props.adaptiveWorkspaceLoading}
          onFreeze={props.onFreezeAdaptiveWorkspace}
          onResume={props.onResumeAdaptiveWorkspace}
          onReset={props.onResetAdaptiveWorkspace}
        />
      )}
      {mountedTabs.tasks ? (
        <div hidden={props.workspaceTab !== "tasks"}>
          <TasksPage
            appendWorkspaceEvent={props.appendWorkspaceEvent}
            cwd={props.cwd}
            hasTauriRuntime={props.hasTauriRuntime}
            invokeFn={props.invokeFn}
            onOpenSettings={() => props.onSelectWorkspaceTab("settings")}
            publishAction={props.publishAction}
            setStatus={props.setStatus}
          />
        </div>
      ) : null}
      {mountedTabs.shell ? (
        <div hidden={props.workspaceTab !== "shell"}>
          <ShellPage
            appendWorkspaceEvent={props.appendWorkspaceEvent}
            cwd={props.cwd}
            hasTauriRuntime={props.hasTauriRuntime}
            invokeFn={props.invokeFn}
            publishAction={props.publishAction}
            setStatus={props.setStatus}
          />
        </div>
      ) : null}
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
