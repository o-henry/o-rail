import { useState, type ChangeEvent, type RefObject } from "react";
import type { DashboardTopicId, DashboardTopicRunState } from "../../features/dashboard/intelligence";
import type { MissionControlState } from "../../features/orchestration/agentic/missionControl";
import type { CompanionEventType } from "../../features/orchestration/types";
import type { CodexMultiAgentMode } from "./agentPrompt";
import type {
  AgentDataSourceItem,
  AgentModelOption,
  AgentRequestHistoryItem,
  AgentSetOption,
  AgentThread,
  AttachedFile,
} from "./agentTypes";
import type { CodeChangeApproval } from "../../features/studio/approvalTypes";
import { AgentGridCard } from "./workspace/AgentGridCard";
import { AgentsMissionControlPanel } from "./workspace/AgentsMissionControlPanel";
import { AgentsWorkspaceSidebar } from "./workspace/AgentsWorkspaceSidebar";
import { AgentsWorkspaceTopbar } from "./workspace/AgentsWorkspaceTopbar";

type AgentsWorkspaceViewProps = {
  t: (key: string) => string;
  threads: AgentThread[];
  activeThread: AgentThread | null;
  activeThreadId: string;
  activeSetOption: AgentSetOption | null;
  setMission: string;
  mission: MissionControlState | null;
  dashboardInsights: string[];
  recentDataSources: AgentDataSourceItem[];
  requestHistory: AgentRequestHistoryItem[];
  enabledAttachedFileNames: string[];
  enabledDataSourceIds: string[];
  codexMultiAgentMode: CodexMultiAgentMode;
  onSetActiveThreadId: (threadId: string) => void;
  onBackToSetList: () => void;
  onClearMission: () => void;
  onRestoreTemplateSet: () => void;
  onAddThread: () => void;
  onCloseThread: (threadId: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttachFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  draft: string;
  onSetDraft: (value: string) => void;
  attachedFiles: AttachedFile[];
  onOpenFilePicker: () => void;
  isModelMenuOpen: boolean;
  setIsModelMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  selectedModelOptionLabel: string;
  selectedModel: string;
  modelOptions: AgentModelOption[];
  onSelectModel: (model: string) => void;
  isReasonMenuOpen: boolean;
  setIsReasonMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  reasonMenuRef: RefObject<HTMLDivElement | null>;
  isReasonLevelSelectable: boolean;
  selectedReasonLevel: string;
  reasonLevelOptions: string[];
  onSelectReasonLevel: (level: string) => void;
  onSend: () => void;
  sendDisabled: boolean;
  onExecuteTaskCommand: (command: string) => void;
  onRecordCompanionEvent: (type: Exclude<CompanionEventType, "unity_verification_completed">, message?: string) => void;
  onRecordUnityVerification: (success: boolean, message: string) => void;
  onQueuePrompt: (prompt: string) => void;
  onToggleAttachedFile: (fileName: string) => void;
  onToggleDataSource: (sourceId: string) => void;
  pendingApprovals: CodeChangeApproval[];
  onResolveApproval: (approvalId: string, decision: "approved" | "rejected") => void;
  dataTopicId: DashboardTopicId | null;
  dataTopicRunState: DashboardTopicRunState | null;
  dataTopicRunId: string | null;
  onOpenDataTab: () => void;
};

export function AgentsWorkspaceView({
  t,
  threads,
  activeThread,
  activeThreadId,
  activeSetOption,
  setMission,
  mission,
  dashboardInsights,
  recentDataSources,
  requestHistory,
  enabledAttachedFileNames,
  enabledDataSourceIds,
  codexMultiAgentMode,
  onSetActiveThreadId,
  onBackToSetList,
  onClearMission,
  onRestoreTemplateSet,
  onAddThread,
  onCloseThread,
  fileInputRef,
  onAttachFiles,
  draft,
  onSetDraft,
  attachedFiles,
  onOpenFilePicker,
  isModelMenuOpen,
  setIsModelMenuOpen,
  modelMenuRef,
  selectedModelOptionLabel,
  selectedModel,
  modelOptions,
  onSelectModel,
  isReasonMenuOpen,
  setIsReasonMenuOpen,
  reasonMenuRef,
  isReasonLevelSelectable,
  selectedReasonLevel,
  reasonLevelOptions,
  onSelectReasonLevel,
  onSend,
  sendDisabled,
  onExecuteTaskCommand,
  onRecordCompanionEvent,
  onRecordUnityVerification,
  onQueuePrompt,
  onToggleAttachedFile,
  onToggleDataSource,
  pendingApprovals,
  onResolveApproval,
  dataTopicId,
  dataTopicRunState,
  dataTopicRunId,
  onOpenDataTab,
}: AgentsWorkspaceViewProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <section className="agents-layout agents-workspace-mode workspace-tab-panel">
      <AgentsWorkspaceTopbar
        t={t}
        activeSetOption={activeSetOption}
        setMission={setMission}
        requestHistory={requestHistory}
        onRestoreTemplateSet={onRestoreTemplateSet}
        onBackToSetList={onBackToSetList}
        onAddThread={onAddThread}
        dataTopicId={dataTopicId}
        dataTopicRunState={dataTopicRunState}
        onOpenDataTab={onOpenDataTab}
      />

      <section className={`agents-workspace-shell${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
        <section className="agents-workspace-main">
          <AgentsMissionControlPanel
            mission={mission}
            onClearMission={onClearMission}
            onExecuteTaskCommand={onExecuteTaskCommand}
            onRecordCompanionEvent={onRecordCompanionEvent}
            onRecordUnityVerification={onRecordUnityVerification}
          />
          <section
            className={`agents-grid${threads.length === 1 ? " is-single" : threads.length === 2 ? " is-two" : ""}`}
            aria-label="Agents grid"
          >
            {threads.map((thread) => {
              const isSelected = thread.id === activeThreadId;
              return (
                <AgentGridCard
                  key={thread.id}
                  t={t}
                  thread={thread}
                  isSelected={isSelected}
                  onSelect={() => onSetActiveThreadId(thread.id)}
                  onClose={() => onCloseThread(thread.id)}
                  dataTopicId={dataTopicId}
                  dataTopicRunState={dataTopicRunState}
                  dataTopicRunId={dataTopicRunId}
                />
              );
            })}
          </section>
        </section>

        <AgentsWorkspaceSidebar
          isSidebarCollapsed={isSidebarCollapsed}
          setIsSidebarCollapsed={setIsSidebarCollapsed}
          setMission={setMission}
          activeSetOption={activeSetOption}
          codexMultiAgentMode={codexMultiAgentMode}
          activeThread={activeThread}
          dashboardInsights={dashboardInsights}
          recentDataSources={recentDataSources}
          requestHistory={requestHistory}
          attachedFiles={attachedFiles}
          enabledAttachedFileNames={enabledAttachedFileNames}
          enabledDataSourceIds={enabledDataSourceIds}
          onQueuePrompt={onQueuePrompt}
          onToggleAttachedFile={onToggleAttachedFile}
          onToggleDataSource={onToggleDataSource}
          pendingApprovals={pendingApprovals}
          onResolveApproval={onResolveApproval}
        />
      </section>

      <div className="agents-composer">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onAttachFiles}
          className="agents-file-input"
          tabIndex={-1}
          aria-hidden="true"
        />
        <textarea
          aria-label={t("agents.input.placeholder")}
          placeholder={t("agents.input.placeholder")}
          value={draft}
          onChange={(event) => onSetDraft(event.target.value)}
        />
        {attachedFiles.length > 0 && (
          <div className="agents-file-list" aria-label="Attached files">
            {attachedFiles.map((file) => (
              <span key={file.id} className="agents-file-chip">
                {file.name}
              </span>
            ))}
          </div>
        )}
        <div className="agents-composer-row">
          <div className="agents-composer-left">
            <button aria-label="파일 추가" className="agents-icon-button" onClick={onOpenFilePicker} type="button">
              <img alt="" aria-hidden="true" src="/plus-large-svgrepo-com.svg" />
            </button>
            <div className={`agents-model-dropdown${isModelMenuOpen ? " is-open" : ""}`} ref={modelMenuRef}>
              <button
                aria-expanded={isModelMenuOpen}
                aria-haspopup="listbox"
                className="agents-model-button"
                onClick={() => setIsModelMenuOpen((prev) => !prev)}
                type="button"
              >
                <span>{selectedModelOptionLabel || selectedModel}</span>
                <img alt="" aria-hidden="true" src="/down-arrow.svg" />
              </button>
              {isModelMenuOpen && (
                <ul aria-label="Agent model" className="agents-model-menu" role="listbox">
                  {modelOptions.map((option) => (
                    <li key={option.value}>
                      <button
                        aria-selected={option.value === selectedModel}
                        className={option.value === selectedModel ? "is-selected" : ""}
                        onClick={() => {
                          onSelectModel(option.value);
                          setIsModelMenuOpen(false);
                        }}
                        role="option"
                        type="button"
                      >
                        {option.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={`agents-reason-dropdown${isReasonMenuOpen ? " is-open" : ""}`} ref={reasonMenuRef}>
              <button
                aria-expanded={isReasonMenuOpen}
                aria-haspopup="listbox"
                className="agents-reason-button"
                disabled={!isReasonLevelSelectable}
                onClick={() => {
                  if (!isReasonLevelSelectable) {
                    return;
                  }
                  setIsReasonMenuOpen((prev) => !prev);
                }}
                type="button"
              >
                <span>{isReasonLevelSelectable ? `이성 수준 · ${selectedReasonLevel}` : "이성 수준 · 선택 불가"}</span>
                <img alt="" aria-hidden="true" src="/down-arrow.svg" />
              </button>
              {isReasonMenuOpen && isReasonLevelSelectable && (
                <ul aria-label="Reasoning level" className="agents-reason-menu" role="listbox">
                  {reasonLevelOptions.map((level) => (
                    <li key={level}>
                      <button
                        aria-selected={level === selectedReasonLevel}
                        className={level === selectedReasonLevel ? "is-selected" : ""}
                        onClick={() => {
                          onSelectReasonLevel(level);
                          setIsReasonMenuOpen(false);
                        }}
                        role="option"
                        type="button"
                      >
                        {level}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="agents-composer-right">
            <button
              aria-label={t("agents.send")}
              className="agents-send-button"
              disabled={sendDisabled}
              onClick={onSend}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/up.svg" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
