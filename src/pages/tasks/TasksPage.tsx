import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";
import { t as translate, useI18n } from "../../i18n";
import {
  getThreadStageLabel,
  type ThreadStageId,
} from "./taskAgentPresets";
import {
  getTaskAgentMentionMatch,
  stripTaskAgentMentionMatch,
  type TaskAgentMentionOption,
} from "./taskAgentMentions";
import { buildThreadFileTree } from "./threadFileTree";
import { buildLiveAgentCards } from "./liveAgentState";
import { useTasksThreadState } from "./useTasksThreadState";
import { TasksThreadNavPane } from "./TasksThreadNavPane";
import { TasksThreadHeaderBar } from "./TasksThreadHeaderBar";
import { TasksThreadConversation } from "./TasksThreadConversation";
import { TasksThreadReviewPane } from "./TasksThreadReviewPane";
import { TasksThreadComposer } from "./TasksThreadComposer";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TasksPageProps = {
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
  publishAction: (action: any) => void;
  appendWorkspaceEvent: (params: {
    source: string;
    message: string;
    actor?: "user" | "ai" | "system";
    level?: "info" | "error";
    runId?: string;
    topic?: string;
  }) => void;
  setStatus: (message: string) => void;
  onOpenSettings?: () => void;
};

const REASONING_LABELS: Record<string, string> = {
  낮음: "LOW",
  중간: "MEDIUM",
  높음: "HIGH",
  "매우 높음": "VERY HIGH",
};

function displayReasoningLabel(input: string | null | undefined) {
  const value = String(input ?? "").trim();
  return REASONING_LABELS[value] || value || "MEDIUM";
}

function normalizeThreadTitle(input: string | null | undefined) {
  const value = String(input ?? "").trim();
  if (!value) return translate("tasks.thread.new");
  const normalized = value.toLowerCase();
  if (
    normalized === "new thread"
    || normalized === "새 thread"
    || normalized === "새 스레드"
    || normalized === translate("tasks.thread.new").toLowerCase()
  ) {
    return translate("tasks.thread.new");
  }
  return value;
}

function displayThreadPath(input: string | null | undefined) {
  return String(input ?? "").trim().toUpperCase();
}

function displayThreadTitle(input: string | null | undefined) {
  return normalizeThreadTitle(input);
}

export default function TasksPage(props: TasksPageProps) {
  const { t } = useI18n();
  const state = useTasksThreadState(props);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const reasonMenuRef = useRef<HTMLDivElement | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isReasonMenuOpen, setIsReasonMenuOpen] = useState(false);
  const [isEditingThreadTitle, setIsEditingThreadTitle] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [selectedStageId, setSelectedStageId] = useState<ThreadStageId>("brief");
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState("");
  const [pendingDeleteProjectPath, setPendingDeleteProjectPath] = useState("");
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [collapsedDirectories, setCollapsedDirectories] = useState<Record<string, boolean>>({});
  const [isFilesExpanded, setIsFilesExpanded] = useState(false);
  const [composerCursor, setComposerCursor] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isMentionMenuHidden, setIsMentionMenuHidden] = useState(false);
  const [isMainSurfaceFullscreen, setIsMainSurfaceFullscreen] = useState(false);
  const [isThreadNavHidden, setIsThreadNavHidden] = useState(false);
  const [isReviewPaneOpen, setIsReviewPaneOpen] = useState(false);
  const title = useMemo(() => displayThreadTitle(state.activeThread?.thread.title), [state.activeThread]);
  const headerTitle = state.activeThread ? title : "";
  const selectedModelOption = useMemo(
    () => RUNTIME_MODEL_OPTIONS.find((option) => option.value === state.model) ?? RUNTIME_MODEL_OPTIONS[0],
    [state.model],
  );
  const selectedStage = useMemo(() => {
    const workflow = state.activeThread?.workflow;
    if (!workflow) {
      return null;
    }
    return workflow.stages.find((stage) => stage.id === selectedStageId)
      ?? workflow.stages.find((stage) => stage.id === workflow.currentStageId)
      ?? null;
  }, [selectedStageId, state.activeThread]);
  const currentStageLabel = selectedStage ? getThreadStageLabel(selectedStage.id) : t("tasks.workflow.title");

  useEffect(() => {
    setThreadTitleDraft(headerTitle);
    setIsEditingThreadTitle(false);
  }, [headerTitle, state.activeThreadId]);

  useEffect(() => {
    setSelectedStageId(state.activeThread?.workflow.currentStageId ?? "brief");
  }, [state.activeThread?.thread.threadId, state.activeThread?.workflow.currentStageId]);

  useEffect(() => {
    setPendingDeleteThreadId("");
    setPendingDeleteProjectPath("");
    setCollapsedDirectories({});
    setIsFilesExpanded(false);
  }, [state.activeThreadId]);

  useEffect(() => {
    if ((state.activeThread?.changedFiles.length ?? 0) > 0 || state.selectedFileDiff.trim()) {
      setIsReviewPaneOpen(true);
    }
  }, [state.activeThread?.thread.threadId, state.activeThread?.changedFiles.length, state.selectedFileDiff]);

  useEffect(() => {
    if (!state.activeThread) {
      setIsReviewPaneOpen(false);
    }
  }, [state.activeThread]);

  useEffect(() => {
    setComposerCursor(state.composerDraft.length);
  }, [state.composerDraft]);

  useEffect(() => {
    if (!state.composerDraft) {
      setIsMentionMenuHidden(false);
    }
  }, [state.composerDraft]);

  useEffect(() => {
    if (!isModelMenuOpen && !isReasonMenuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
      if (!reasonMenuRef.current?.contains(event.target as Node)) {
        setIsReasonMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isModelMenuOpen, isReasonMenuOpen]);

  const handleNewThread = () => {
    void state.openNewThread();
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const commitThreadTitle = () => {
    const nextTitle = normalizeThreadTitle(threadTitleDraft);
    setThreadTitleDraft(nextTitle);
    setIsEditingThreadTitle(false);
    void state.renameThread(nextTitle);
  };

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const currentMentionMatch = mentionMatch ?? getTaskAgentMentionMatch(
      event.currentTarget.value,
      event.currentTarget.selectionStart ?? event.currentTarget.value.length,
    );
    if (currentMentionMatch) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((current) => (current + 1) % currentMentionMatch.options.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((current) => (current - 1 + currentMentionMatch.options.length) % currentMentionMatch.options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectMention(currentMentionMatch.options[mentionIndex]!, currentMentionMatch);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionIndex(0);
        setIsMentionMenuHidden(true);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (state.canInterruptCurrentThread) {
      void state.stopComposerRun();
      return;
    }
    void state.submitComposer();
  };

  const visibleAgentLabels = useMemo(
    () => (state.activeThread?.agents ?? []).map((agent) => agent.label),
    [state.activeThread?.agents],
  );
  const liveAgents = useMemo(() => buildLiveAgentCards(state.activeThread, state.liveRoleNotes), [state.activeThread, state.liveRoleNotes]);
  const fileTree = useMemo(() => buildThreadFileTree(state.activeThread?.files ?? []), [state.activeThread?.files]);
  const mentionMatch = useMemo(
    () => (isMentionMenuHidden ? null : getTaskAgentMentionMatch(state.composerDraft, composerCursor)),
    [composerCursor, isMentionMenuHidden, state.composerDraft],
  );

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionMatch?.query]);

  const selectMention = (option: TaskAgentMentionOption, matchOverride?: typeof mentionMatch) => {
    const activeMatch = matchOverride ?? mentionMatch;
    if (!activeMatch) {
      return;
    }
    if (option.kind === "mode") {
      const nextValue = stripTaskAgentMentionMatch(state.composerDraft, activeMatch);
      const nextCursor = activeMatch.rangeStart;
      state.setComposerCoordinationModeOverride(option.mode ?? null);
      state.setComposerDraft(nextValue);
      setComposerCursor(nextCursor);
      setMentionIndex(0);
      setIsMentionMenuHidden(true);
      requestAnimationFrame(() => {
        composerRef.current?.focus();
        composerRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
      return;
    }
    const nextValue = stripTaskAgentMentionMatch(state.composerDraft, activeMatch);
    const nextCursor = activeMatch.rangeStart;
    if (!option.presetId) {
      return;
    }
    state.addComposerRole(option.presetId);
    state.setComposerDraft(nextValue);
    setComposerCursor(nextCursor);
    setMentionIndex(0);
    setIsMentionMenuHidden(true);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  useEffect(() => {
    const node = conversationRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [state.activeThread?.messages.length, liveAgents.length, state.pendingApprovals.length, state.selectedFileDiff]);

  const recentRuntimeSessions = useMemo(() => state.searchRuntimeSessions(""), [state]);

  return (
    <section
      className={`tasks-thread-layout workspace-tab-panel${isMainSurfaceFullscreen ? " is-main-surface-fullscreen" : ""}${isThreadNavHidden ? " is-thread-nav-hidden" : ""}${isReviewPaneOpen && state.activeThread ? " is-review-pane-open" : ""}`}
    >
      <TasksThreadNavPane
        activeThread={state.activeThread}
        activeThreadId={state.activeThreadId}
        collapsedDirectories={collapsedDirectories}
        collapsedProjects={collapsedProjects}
        currentStageLabel={currentStageLabel}
        cwd={props.cwd}
        fileTree={fileTree}
        hasActiveThread={Boolean(state.activeThread)}
        isFilesExpanded={isFilesExpanded}
        isReviewPaneOpen={isReviewPaneOpen}
        isThreadNavHidden={isThreadNavHidden}
        loading={state.loading}
        pendingApprovalsCount={state.pendingApprovals.length}
        projectGroups={state.projectGroups}
        projectPath={state.projectPath}
        selectedAgentDetail={state.selectedAgentDetail}
        selectedFilePath={state.selectedFilePath}
        selectedStage={selectedStage}
        onCompactSelectedAgentCodexThread={() => void state.compactSelectedAgentCodexThread()}
        onNewThread={handleNewThread}
        onOpenProjectDirectory={() => void state.openProjectDirectory()}
        onRequestDeleteProject={setPendingDeleteProjectPath}
        onRequestDeleteThread={setPendingDeleteThreadId}
        onSelectFilePath={state.setSelectedFilePath}
        onSelectProject={state.selectProject}
        onSelectThread={(threadId) => void state.selectThread(threadId)}
        onSetSelectedStageId={setSelectedStageId}
        onToggleReviewPane={() => {
          if (!state.activeThread) {
            return;
          }
          setIsReviewPaneOpen((current) => !current);
        }}
        onToggleThreadNav={() => setIsThreadNavHidden((current) => !current)}
        onToggleDirectory={(path) => setCollapsedDirectories((current) => ({ ...current, [path]: !current[path] }))}
        onToggleFilesExpanded={() => setIsFilesExpanded((current) => !current)}
        onToggleProject={(projectPath) => {
          const normalized = String(projectPath ?? "").trim();
          if (!normalized) {
            return;
          }
          setCollapsedProjects((current) => ({ ...current, [normalized]: !current[normalized] }));
        }}
      />

      <section className="tasks-thread-main-surface">
        <TasksThreadHeaderBar
          displayPath={displayThreadPath(state.projectPath || state.activeThread?.task.worktreePath || state.activeThread?.task.workspacePath || props.cwd)}
          hasActiveThread={Boolean(state.activeThread)}
          headerTitle={headerTitle}
          isEditingThreadTitle={isEditingThreadTitle}
          isMainSurfaceFullscreen={isMainSurfaceFullscreen}
          isReviewPaneOpen={isReviewPaneOpen}
          isThreadNavHidden={isThreadNavHidden}
          threadTitleDraft={threadTitleDraft}
          onCancelTitleEdit={() => {
            setThreadTitleDraft(headerTitle);
            setIsEditingThreadTitle(false);
          }}
          onChangeTitleDraft={setThreadTitleDraft}
          onCommitTitle={commitThreadTitle}
          onStartEditingTitle={() => setIsEditingThreadTitle(true)}
          onToggleMainSurfaceFullscreen={() => {
            if (!state.activeThread) {
              return;
            }
            setIsMainSurfaceFullscreen((current) => !current);
          }}
          onToggleReviewPane={() => {
            if (!state.activeThread) {
              return;
            }
            setIsReviewPaneOpen((current) => !current);
          }}
          onToggleThreadNav={() => setIsThreadNavHidden((current) => !current)}
        />

        {!state.activeThread ? (
          <div className="tasks-thread-conversation-scroll" ref={conversationRef}>
            <section className="tasks-thread-empty-state">
              <strong>{t("tasks.empty.title")}</strong>
              <p>{t("tasks.empty.body")}</p>
            </section>
          </div>
        ) : (
          <TasksThreadConversation
            approvals={state.pendingApprovals}
            conversationRef={conversationRef}
            liveAgents={liveAgents}
            liveProcessEvents={state.liveProcessEvents}
            messages={state.activeThread.messages}
            orchestration={state.activeThreadCoordination}
            recentRuntimeSessions={recentRuntimeSessions}
            visibleAgentLabels={visibleAgentLabels}
            onApprovePlan={() => void state.approveActiveCoordinationPlan()}
            onCancelOrchestration={() => state.cancelActiveCoordination()}
            onOpenRuntimeSession={(threadId) => void state.selectThread(threadId)}
            onRequestFollowup={() => state.requestCoordinationFollowup()}
            onResolveApproval={(approval, decision) => void state.resolveApproval(approval, decision)}
            onResumeOrchestration={() => void state.resumeActiveCoordination()}
            onVerifyReview={() => state.verifyActiveCoordinationReview()}
          />
        )}

        <TasksThreadComposer
          attachedFiles={state.attachedFiles}
          canInterruptCurrentThread={state.canInterruptCurrentThread}
          composerCoordinationModeOverride={state.composerCoordinationModeOverride}
          composerDraft={state.composerDraft}
          composerRef={composerRef}
          isModelMenuOpen={isModelMenuOpen}
          isReasonMenuOpen={isReasonMenuOpen}
          mentionIndex={mentionIndex}
          mentionMatch={mentionMatch}
          modelMenuRef={modelMenuRef}
          reasonMenuRef={reasonMenuRef}
          reasoning={state.reasoning}
          reasoningLabel={displayReasoningLabel(state.reasoning)}
          selectedComposerRoleIds={state.selectedComposerRoleIds}
          selectedModelOption={selectedModelOption}
          stoppingComposerRun={state.stoppingComposerRun}
          onComposerCursorChange={setComposerCursor}
          onComposerDraftChange={(value, cursor) => {
            setComposerCursor(cursor);
            setIsMentionMenuHidden(false);
            state.setComposerDraft(value);
          }}
          onComposerKeyDown={onComposerKeyDown}
          onClearCoordinationModeOverride={() => state.setComposerCoordinationModeOverride(null)}
          onOpenAttachmentPicker={() => void state.openAttachmentPicker()}
          onRemoveAttachedFile={state.removeAttachedFile}
          onRemoveComposerRole={state.removeComposerRole}
          onSelectMention={selectMention}
          onSetModel={(value) => {
            state.setModel(value);
            setIsModelMenuOpen(false);
          }}
          onSetReasoning={(value) => {
            state.setReasoning(value);
            setIsReasonMenuOpen(false);
          }}
          onStop={() => void state.stopComposerRun()}
          onSubmit={() => void state.submitComposer()}
          onToggleModelMenu={() => setIsModelMenuOpen((prev) => !prev)}
          onToggleReasonMenu={() => setIsReasonMenuOpen((prev) => !prev)}
        />
      </section>

      {pendingDeleteThreadId ? (
        <div className="modal-backdrop">
          <section className="approval-modal tasks-thread-confirm-modal">
            <h2>{t("tasks.modal.threadDelete.title")}</h2>
            <p>{t("tasks.modal.threadDelete.body")}</p>
            <div className="tasks-thread-approval-actions">
              <button onClick={() => setPendingDeleteThreadId("")} type="button">{t("tasks.modal.cancel")}</button>
              <button
                className="tasks-thread-primary"
                onClick={() => {
                  void state.deleteThread(pendingDeleteThreadId);
                  setPendingDeleteThreadId("");
                }}
                type="button"
              >
                {t("tasks.modal.confirmDelete")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingDeleteProjectPath ? (
        <div className="modal-backdrop">
          <section className="approval-modal tasks-thread-confirm-modal">
            <h2>{t("tasks.modal.projectHide.title")}</h2>
            <p>{t("tasks.modal.projectHide.body")}</p>
            <div className="tasks-thread-approval-actions">
              <button onClick={() => setPendingDeleteProjectPath("")} type="button">{t("tasks.modal.cancel")}</button>
              <button
                className="tasks-thread-primary"
                onClick={() => {
                  state.removeProject(pendingDeleteProjectPath);
                  setPendingDeleteProjectPath("");
                }}
                type="button"
              >
                {t("tasks.modal.confirmHide")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {state.activeThread && isReviewPaneOpen ? (
        <TasksThreadReviewPane
          activeThread={state.activeThread}
          selectedFileDiff={state.selectedFileDiff}
          selectedFilePath={state.selectedFilePath}
          onSelectFilePath={state.setSelectedFilePath}
        />
      ) : null}
    </section>
  );
}
