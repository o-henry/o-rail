import { useI18n } from "../../i18n";
import { AgentSetIndexView } from "./AgentSetIndexView";
import { AgentsWorkspaceView } from "./AgentsWorkspaceView";
import type { AgentsPageProps } from "./agentTypes";
import { useAgentsPageState } from "./useAgentsPageState";

export default function AgentsPage(props: AgentsPageProps) {
  const { t } = useI18n();
  const state = useAgentsPageState({
    codexMultiAgentMode: props.codexMultiAgentMode,
    launchRequest: props.launchRequest,
    missionControl: props.missionControl,
    onQuickAction: props.onQuickAction,
    onRunDataTopic: props.onRunDataTopic,
    onRunRole: props.onRunRole,
    runStateByTopic: props.runStateByTopic,
    topicSnapshots: props.topicSnapshots,
    translate: (key) => t(key),
  });

  if (!state.activeSetId) {
    return (
      <AgentSetIndexView
        groupedSetOptions={state.groupedSetOptions}
        onSelectSet={state.onSelectSet}
        setStateMap={state.setStateMap}
      />
    );
  }

  return (
    <AgentsWorkspaceView
      activeSetOption={state.activeSetOption}
      activeThread={state.activeThread}
      activeThreadId={state.activeThreadId}
      attachedFiles={state.attachedFiles}
      codexMultiAgentMode={props.codexMultiAgentMode}
      dashboardInsights={state.dashboardInsights}
      recentDataSources={state.recentDataSources}
      requestHistory={state.requestHistory}
      enabledAttachedFileNames={state.enabledAttachedFileNames}
      enabledDataSourceIds={state.enabledDataSourceIds}
      draft={state.draft}
      fileInputRef={state.fileInputRef}
      isModelMenuOpen={state.isModelMenuOpen}
      isReasonLevelSelectable={state.isReasonLevelSelectable}
      isReasonMenuOpen={state.isReasonMenuOpen}
      modelMenuRef={state.modelMenuRef}
      modelOptions={state.modelOptions}
      onAddThread={state.onAddThread}
      onAttachFiles={state.onAttachFiles}
      onBackToSetList={state.onBackToSetList}
      onCloseThread={state.onCloseThread}
      onOpenDataTab={props.onOpenDataTab}
      onClearMission={props.missionControl.clearMission}
      onExecuteTaskCommand={props.missionControl.executeTaskCommand}
      pendingApprovals={state.pendingApprovals}
      onOpenFilePicker={state.onOpenFilePicker}
      onRecordCompanionEvent={props.missionControl.recordCompanionEvent}
      onRecordUnityVerification={props.missionControl.recordUnityVerification}
      onQueuePrompt={state.onQueuePrompt}
      onResolveApproval={state.onResolveApproval}
      onRestoreTemplateSet={state.onRestoreTemplateSet}
      onSelectModel={state.onSelectModel}
      onSelectReasonLevel={state.onSelectReasonLevel}
      onSend={state.onSend}
      onSetActiveThreadId={state.onSetActiveThreadId}
      onSetDraft={state.onSetDraft}
      onToggleAttachedFile={state.onToggleAttachedFile}
      onToggleDataSource={state.onToggleDataSource}
      reasonLevelOptions={state.reasonLevelOptions}
      reasonMenuRef={state.reasonMenuRef}
      selectedModel={state.selectedModel}
      selectedModelOptionLabel={state.selectedModelOptionLabel}
      selectedReasonLevel={state.selectedReasonLevel}
      sendDisabled={state.sendDisabled}
      setIsModelMenuOpen={state.setIsModelMenuOpen}
      setIsReasonMenuOpen={state.setIsReasonMenuOpen}
      setMission={state.setMission}
      mission={props.missionControl.activeMission}
      dataTopicId={state.activeDataTopicId}
      dataTopicRunState={state.activeDataRunState ?? null}
      dataTopicRunId={state.activeDataRunState?.runId ?? state.activeDataSnapshotRunId}
      t={(key) => t(key)}
      threads={state.threads}
    />
  );
}
