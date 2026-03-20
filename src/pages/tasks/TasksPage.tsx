import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TURN_REASONING_LEVEL_OPTIONS } from "../../features/workflow/reasoningLevels";
import { RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";
import { t as translate, useI18n } from "../../i18n";
import {
  getTaskAgentLabel,
  getThreadStageLabel,
  type ThreadStageId,
} from "./taskAgentPresets";
import {
  getTaskAgentMentionMatch,
  stripTaskAgentMentionMatch,
} from "./taskAgentMentions";
import { buildThreadFileTree, type ThreadFileTreeNode } from "./threadFileTree";
import { buildLiveAgentCards } from "./liveAgentState";
import { useTasksThreadState } from "./useTasksThreadState";
import { type ThreadMessage, type ThreadRoleId } from "./threadTypes";

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

function displayThreadTitle(input: string | null | undefined) {
  return normalizeThreadTitle(input);
}

function displayThreadPath(input: string | null | undefined) {
  return String(input ?? "").trim().toUpperCase();
}

function displayStageStatus(input: string | null | undefined) {
  const normalized = String(input ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    idle: translate("tasks.stage.idle"),
    active: translate("tasks.stage.active"),
    running: translate("tasks.stage.running"),
    queued: translate("tasks.stage.queued"),
    blocked: translate("tasks.stage.blocked"),
    ready: translate("tasks.stage.ready"),
    done: translate("tasks.stage.done"),
    completed: translate("tasks.stage.done"),
    failed: translate("tasks.stage.failed"),
    error: translate("tasks.stage.failed"),
    thinking: translate("tasks.stage.thinking"),
    awaiting_approval: translate("tasks.stage.awaitingApproval"),
  };
  return labels[normalized] ?? String(input ?? "").trim().replace(/_/g, " ");
}

function parseTimelineMessage(content: string, agentLabels: string[]) {
  const text = String(content ?? "").trim();
  for (const label of agentLabels) {
    if (text.startsWith(`${label}:`)) {
      return {
        label,
        body: text.slice(label.length + 1).trim(),
      };
    }
    if (text.startsWith(`Created ${label} `) || text.includes(` ${label} is `)) {
      return {
        label,
        body: text,
      };
    }
  }
  return {
    label: "",
    body: text,
  };
}

function resolveTimelineMessage(message: ThreadMessage, agentLabels: string[]) {
  const parsed = parseTimelineMessage(message.content, agentLabels);
  return {
    label: String(message.agentLabel ?? "").trim() || parsed.label,
    body: parsed.body,
    artifactPath: String(message.artifactPath ?? "").trim(),
    createdAt: String(message.createdAt ?? "").trim(),
  };
}

function formatArtifactStamp(input: string) {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return normalized;
  }
  return new Date(parsed).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayProcessStage(stage: string) {
  const normalized = String(stage ?? "").trim().toLowerCase();
  if (normalized === "crawler") return translate("tasks.processStage.crawler");
  if (normalized === "rag") return translate("tasks.processStage.rag");
  if (normalized === "codex") return translate("tasks.processStage.codex");
  if (normalized === "critic") return translate("tasks.processStage.critic");
  if (normalized === "save") return translate("tasks.processStage.save");
  if (normalized === "approval") return translate("tasks.processStage.approval");
  return stage || translate("tasks.processStage.progress");
}

function displayProcessEventLabel(type: string) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (normalized === "run_queued") return translate("tasks.processEvent.queued");
  if (normalized === "run_started") return translate("tasks.processEvent.started");
  if (normalized === "stage_started") return translate("tasks.processEvent.running");
  if (normalized === "stage_done") return translate("tasks.processEvent.done");
  if (normalized === "stage_error") return translate("tasks.processEvent.error");
  if (normalized === "run_done") return translate("tasks.processEvent.finished");
  if (normalized === "run_error") return translate("tasks.processEvent.failed");
  if (normalized === "artifact_added") return translate("tasks.processEvent.artifact");
  return translate("tasks.processEvent.progress");
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
  const [isDetailPanelCollapsed, setIsDetailPanelCollapsed] = useState(false);
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
        selectMention(currentMentionMatch.options[mentionIndex]!.presetId, currentMentionMatch);
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

  const toggleDirectory = (path: string) => {
    setCollapsedDirectories((current) => ({ ...current, [path]: !current[path] }));
  };

  const toggleProject = (projectPath: string) => {
    const normalized = String(projectPath ?? "").trim();
    if (!normalized) {
      return;
    }
    setCollapsedProjects((current) => ({ ...current, [normalized]: !current[normalized] }));
  };

  const selectMention = (presetId: ThreadRoleId, matchOverride?: typeof mentionMatch) => {
    const activeMatch = matchOverride ?? mentionMatch;
    if (!activeMatch) {
      return;
    }
    const nextValue = stripTaskAgentMentionMatch(state.composerDraft, activeMatch);
    const nextCursor = activeMatch.rangeStart;
    state.addComposerRole(presetId);
    state.setComposerDraft(nextValue);
    setComposerCursor(nextCursor);
    setMentionIndex(0);
    setIsMentionMenuHidden(true);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const renderFileTree = (nodes: ThreadFileTreeNode[], depth = 0): ReactNode =>
    nodes.map((node) => {
      if (node.kind === "directory") {
        const isCollapsed = Boolean(collapsedDirectories[node.path]);
        return (
          <div className="tasks-thread-file-tree-branch" key={node.id}>
            <button
              className={`tasks-thread-file-tree-node is-directory${node.changed ? " is-changed" : ""}`}
              onClick={() => toggleDirectory(node.path)}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              type="button"
            >
              <span className="tasks-thread-file-tree-caret">{isCollapsed ? "▸" : "▾"}</span>
              <span className="tasks-thread-file-tree-name">{node.name}</span>
            </button>
            {!isCollapsed && node.children ? renderFileTree(node.children, depth + 1) : null}
          </div>
        );
      }
      return (
        <button
          className={`tasks-thread-file-tree-node is-file${state.selectedFilePath === node.path ? " is-active" : ""}${node.changed ? " is-changed" : ""}`}
          key={node.id}
          onClick={() => state.setSelectedFilePath(node.path)}
          style={{ paddingLeft: `${28 + depth * 14}px` }}
          type="button"
        >
          <span className="tasks-thread-file-tree-name">{node.name}</span>
          <small>{node.changed ? t("tasks.files.changed") : t("tasks.files.tracked")}</small>
        </button>
      );
    });

  useEffect(() => {
    const node = conversationRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [state.activeThread?.messages.length, liveAgents.length, state.pendingApprovals.length, state.selectedFileDiff]);

  return (
    <section
      className={`tasks-thread-layout workspace-tab-panel${isMainSurfaceFullscreen ? " is-main-surface-fullscreen" : ""}${!state.activeThread || isDetailPanelCollapsed ? " is-detail-panel-collapsed" : ""}`}
    >
      <aside className="tasks-thread-nav">
        <div className="tasks-thread-nav-actions">
          <button className="tasks-thread-new-button" onClick={handleNewThread} type="button">
            {t("tasks.thread.new")}
          </button>
          <button className="tasks-thread-new-button" onClick={() => void state.openProjectDirectory()} type="button">
            {t("tasks.project.open")}
          </button>
          <div className="tasks-thread-project-card">
            <strong>{t("tasks.project.label")}</strong>
            <span title={state.projectPath || props.cwd}>
              {state.projectPath || props.cwd}
            </span>
          </div>
        </div>
        <div className="tasks-thread-nav-copy">
          <strong>{t("tasks.projectTree.label")}</strong>
          <span>{state.loading ? t("tasks.syncing") : t("tasks.count", { count: state.projectGroups.length })}</span>
        </div>
        <div className="tasks-thread-project-tree">
          {state.projectGroups.map((group) => (
            <section className={`tasks-thread-project-node${group.isSelected ? " is-selected" : ""}`} key={group.projectPath}>
              <div className="tasks-thread-project-node-head">
                <button className="tasks-thread-project-node-select" onClick={() => state.selectProject(group.projectPath)} type="button">
                  <strong>{group.label}</strong>
                  <span>{state.loading && group.isSelected ? t("tasks.syncing") : t("tasks.count", { count: group.threads.length })}</span>
                </button>
                <button
                  aria-label={t(collapsedProjects[group.projectPath] ? "tasks.aria.projectExpand" : "tasks.aria.projectCollapse", {
                    label: group.label,
                  })}
                  className="tasks-thread-project-node-toggle"
                  onClick={() => toggleProject(group.projectPath)}
                  type="button"
                >
                  <img
                    alt=""
                    aria-hidden="true"
                    className={collapsedProjects[group.projectPath] ? "" : "is-expanded"}
                    src="/down-arrow.svg"
                  />
                </button>
                <button
                  aria-label={t("tasks.aria.projectRemove", { label: group.label })}
                  className="tasks-thread-project-node-remove"
                  onClick={() => setPendingDeleteProjectPath(group.projectPath)}
                  type="button"
                >
                  <img alt="" aria-hidden="true" src="/xmark-small-svgrepo-com.svg" />
                </button>
              </div>
              <small className="tasks-thread-project-node-path" title={group.projectPath}>
                {group.projectPath}
              </small>
              {!collapsedProjects[group.projectPath] ? (
                <div className="tasks-thread-list">
                  {group.threads.length === 0 ? (
                    <p className="tasks-thread-empty-copy">{t("tasks.empty.projectThreads")}</p>
                  ) : (
                    group.threads.map((item) => {
                      return (
                        <article
                          className={`tasks-thread-list-row${state.activeThreadId === item.thread.threadId ? " is-active" : ""}`}
                          key={item.thread.threadId}
                        >
                          <button
                            className={`tasks-thread-list-item${state.activeThreadId === item.thread.threadId ? " is-active" : ""}`}
                            onClick={() => void state.selectThread(item.thread.threadId)}
                            type="button"
                          >
                            <div className="tasks-thread-list-title-row">
                              <strong>{displayThreadTitle(item.thread.title)}</strong>
                            </div>
                            {item.workflowSummary ? (
                              <div className="tasks-thread-list-meta-row">
                                <span className={`tasks-thread-list-stage is-${item.workflowSummary.status}`}>
                                  {getThreadStageLabel(item.workflowSummary.currentStageId)}
                                </span>
                                {item.workflowSummary.blocked ? <small>{t("tasks.stage.blocked")}</small> : null}
                              </div>
                            ) : null}
                          </button>
                          <button
                            aria-label={t("tasks.aria.deleteThread", { title: displayThreadTitle(item.thread.title) })}
                            className="tasks-thread-list-delete"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setPendingDeleteThreadId(item.thread.threadId);
                            }}
                            type="button"
                          >
                            <img
                              alt=""
                              aria-hidden="true"
                              className="tasks-thread-list-delete-icon"
                              src="/xmark-small-svgrepo-com.svg"
                            />
                          </button>
                        </article>
                      );
                    })
                  )}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </aside>

      <section className="tasks-thread-main-surface">
        <header className="tasks-thread-header">
          <div className="tasks-thread-header-copy">
            {headerTitle ? (
              isEditingThreadTitle ? (
                <input
                  autoFocus
                  className="tasks-thread-title-input"
                  onBlur={commitThreadTitle}
                  onChange={(event) => setThreadTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitThreadTitle();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setThreadTitleDraft(headerTitle);
                      setIsEditingThreadTitle(false);
                    }
                  }}
                  value={threadTitleDraft}
                />
              ) : (
                <button
                  aria-label={t("tasks.aria.renameThread")}
                  className="tasks-thread-title-button"
                  onClick={() => setIsEditingThreadTitle(true)}
                  type="button"
                >
                  {headerTitle}
                </button>
              )
            ) : null}
            <p>
              {displayThreadPath(state.projectPath || state.activeThread?.task.worktreePath || state.activeThread?.task.workspacePath || props.cwd)}
            </p>
          </div>
          <div className="tasks-thread-header-actions">
            {state.activeThread ? (
              <button
                aria-label={isDetailPanelCollapsed ? t("tasks.detailPanel.show") : t("tasks.detailPanel.hide")}
                className="tasks-thread-header-terminal-button"
                onClick={() => setIsDetailPanelCollapsed((current) => !current)}
                type="button"
              >
                <img alt="" aria-hidden="true" src={isDetailPanelCollapsed ? "/open-panel.svg" : "/close.svg"} />
              </button>
            ) : null}
            <button
              aria-label={isMainSurfaceFullscreen ? t("tasks.fullscreen.exit") : t("tasks.fullscreen.enter")}
              className="tasks-thread-header-terminal-button"
              disabled={!state.activeThread}
              onClick={() => {
                if (!state.activeThread) {
                  return;
                }
                setIsMainSurfaceFullscreen((current) => !current);
              }}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/canvas-fullscreen.svg" />
            </button>
          </div>
        </header>

        <div className="tasks-thread-conversation-scroll" ref={conversationRef}>
          {!state.activeThread ? (
            <section className="tasks-thread-empty-state">
              <strong>{t("tasks.empty.title")}</strong>
              <p>{t("tasks.empty.body")}</p>
            </section>
          ) : (
            <>
              <section className="tasks-thread-timeline">
                {state.activeThread.messages.length === 0 ? null : (
                  state.activeThread.messages.map((message) => {
                    const parsed = resolveTimelineMessage(message, visibleAgentLabels);
                    return (
                      <article className={`tasks-thread-message-row is-${message.role}`} key={message.id}>
                        {parsed.label ? <span className="tasks-thread-message-label">{parsed.label}</span> : null}
                        <div className="tasks-thread-log-line">{parsed.body}</div>
                        {parsed.artifactPath ? (
                          <div className="tasks-thread-message-meta">
                            <small className="tasks-thread-message-artifact">{parsed.artifactPath}</small>
                            {parsed.createdAt ? <small className="tasks-thread-message-time">{formatArtifactStamp(parsed.createdAt)}</small> : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}
                {state.liveProcessEvents.map((event) => (
                  <article className="tasks-thread-message-row is-system is-process" key={event.id}>
                    <span className="tasks-thread-message-label">
                      {event.agentLabel} · {displayProcessEventLabel(event.type)}
                    </span>
                    <div className="tasks-thread-log-line">
                      {event.stage ? `[${displayProcessStage(event.stage)}] ` : ""}
                      {event.message}
                    </div>
                  </article>
                ))}
                {liveAgents.map((agent) => (
                  <article className="tasks-thread-message-row is-assistant is-live-placeholder" key={`live:${agent.agentId}`}>
                    <span className="tasks-thread-message-label">{agent.label}</span>
                    <div className="tasks-thread-log-line">{t("tasks.live.working")}</div>
                    {agent.latestArtifactPath ? (
                      <div className="tasks-thread-message-meta">
                        <small className="tasks-thread-message-artifact">{agent.latestArtifactPath}</small>
                        {agent.updatedAt ? <small className="tasks-thread-message-time">{formatArtifactStamp(agent.updatedAt)}</small> : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </section>

              {state.pendingApprovals.length > 0 ? (
                <section className="tasks-thread-approvals-stack">
                  {state.pendingApprovals.map((approval) => (
                    <article className="tasks-thread-approval-card" key={approval.id}>
                      <div className="tasks-thread-section-head">
                        <strong>{t("tasks.approval.required")}</strong>
                        <span>{approval.kind.toUpperCase()}</span>
                      </div>
                      <p>{approval.summary}</p>
                      <div className="tasks-thread-approval-actions">
                        <button onClick={() => void state.resolveApproval(approval, "rejected")} type="button">
                          {t("tasks.approval.reject")}
                        </button>
                        <button className="tasks-thread-primary" onClick={() => void state.resolveApproval(approval, "approved")} type="button">
                          {t("tasks.approval.approve")}
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}

              {state.activeThread && state.selectedFilePath && state.selectedFileDiff.trim() ? (
                <section className="tasks-thread-main-diff-panel">
                  <div className="tasks-thread-section-head">
                    <strong>{t("tasks.diff.title")}</strong>
                    <span>{state.selectedFilePath}</span>
                  </div>
                  <pre>{state.selectedFileDiff}</pre>
                </section>
              ) : null}
            </>
          )}
        </div>

        <div className="tasks-thread-composer-shell question-input agents-composer workflow-question-input">
          {mentionMatch ? (
            <div aria-label={t("tasks.aria.agentMentions")} className="tasks-thread-mention-menu" role="listbox">
              {mentionMatch.options.map((option, index) => (
                <button
                  aria-selected={index === mentionIndex}
                  className={`tasks-thread-mention-option${index === mentionIndex ? " is-active" : ""}`}
                  key={option.presetId}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectMention(option.presetId);
                  }}
                  type="button"
                >
                  <strong>{option.mention}</strong>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          {state.attachedFiles.length > 0 ? (
            <div className="agents-file-list" aria-label="Attached files">
              {state.attachedFiles.map((file) => (
                <span key={file.id} className="agents-file-chip">
                  <span className={`agents-file-chip-name${file.enabled === false ? " is-disabled" : ""}`} title={file.path}>
                    {file.name}
                  </span>
                  <button
                    aria-label={`Remove ${file.name}`}
                    className="agents-file-chip-remove"
                    onClick={() => state.removeAttachedFile(file.id)}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {state.selectedComposerRoleIds.length > 0 ? (
            <div className="tasks-thread-selected-mentions" aria-label="Selected agents">
              {state.selectedComposerRoleIds.map((roleId) => (
                <span className="tasks-thread-selected-mention-chip" key={roleId}>
                  <span>{getTaskAgentLabel(roleId)}</span>
                  <button
                    aria-label={`Remove ${getTaskAgentLabel(roleId)}`}
                    onClick={() => state.removeComposerRole(roleId)}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="tasks-thread-composer-input-wrap">
            <textarea
              ref={composerRef}
              aria-label="Tasks composer"
              className="tasks-thread-composer-input"
              onKeyDown={onComposerKeyDown}
              onClick={(event) => setComposerCursor(event.currentTarget.selectionStart ?? 0)}
              onKeyUp={(event) => setComposerCursor(event.currentTarget.selectionStart ?? 0)}
              placeholder={t("tasks.composer.placeholder")}
              rows={1}
              value={state.composerDraft}
              onChange={(event) => {
                setComposerCursor(event.target.selectionStart ?? event.target.value.length);
                setIsMentionMenuHidden(false);
                state.setComposerDraft(event.target.value);
              }}
            />
          </div>
          <div className="question-input-footer tasks-thread-composer-toolbar">
            <div className="agents-composer-left tasks-thread-composer-controls">
              <button
                aria-label="Attach code files"
                className="agents-icon-button"
                onClick={() => void state.openAttachmentPicker()}
                type="button"
              >
                <img alt="" aria-hidden="true" src="/plus-large-svgrepo-com.svg" />
              </button>
              <div className={`agents-model-dropdown${isModelMenuOpen ? " is-open" : ""}`} ref={modelMenuRef}>
                <button
                  aria-label={t("tasks.aria.modelMenu")}
                  aria-expanded={isModelMenuOpen}
                  aria-haspopup="listbox"
                  className="agents-model-button"
                  onClick={() => setIsModelMenuOpen((prev) => !prev)}
                  type="button"
                >
                  <span>{selectedModelOption.label}</span>
                  <img alt="" aria-hidden="true" src="/down-arrow.svg" />
                </button>
                {isModelMenuOpen && (
                  <ul aria-label={t("tasks.aria.modelMenu")} className="agents-model-menu" role="listbox">
                    {RUNTIME_MODEL_OPTIONS.map((option) => (
                      <li key={option.value}>
                        <button
                          aria-selected={option.value === state.model}
                          className={option.value === state.model ? "is-selected" : ""}
                          onClick={() => {
                            state.setModel(option.value);
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
                  aria-label={t("tasks.aria.reasoningMenu")}
                  aria-expanded={isReasonMenuOpen}
                  aria-haspopup="listbox"
                  className="agents-reason-button"
                  onClick={() => setIsReasonMenuOpen((prev) => !prev)}
                  type="button"
                >
                  <span>{displayReasoningLabel(state.reasoning)}</span>
                  <img alt="" aria-hidden="true" src="/down-arrow.svg" />
                </button>
                {isReasonMenuOpen && (
                  <ul aria-label={t("tasks.aria.reasoningMenu")} className="agents-reason-menu" role="listbox">
                    {TURN_REASONING_LEVEL_OPTIONS.map((level) => (
                      <li key={level}>
                        <button
                          aria-selected={level === state.reasoning}
                          className={level === state.reasoning ? "is-selected" : ""}
                          onClick={() => {
                            state.setReasoning(level);
                            setIsReasonMenuOpen(false);
                          }}
                          role="option"
                          type="button"
                        >
                          {displayReasoningLabel(level)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="tasks-thread-composer-actions">
              <button
                aria-label={state.canInterruptCurrentThread ? t("tasks.aria.stop") : t("tasks.aria.send")}
                className="primary-action question-create-button agents-send-button"
                disabled={state.canInterruptCurrentThread ? state.stoppingComposerRun : !state.composerDraft.trim()}
                onClick={() => {
                  if (state.canInterruptCurrentThread) {
                    void state.stopComposerRun();
                    return;
                  }
                  void state.submitComposer();
                }}
                type="button"
              >
                <img
                  alt=""
                  aria-hidden="true"
                  className="question-create-icon"
                  src={state.canInterruptCurrentThread ? "/canvas-stop.svg" : "/up.svg"}
                />
              </button>
            </div>
          </div>
        </div>
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

      {!state.activeThread || isDetailPanelCollapsed ? null : (
      <aside className="tasks-thread-detail-panel">
        <div className="tasks-thread-detail-body">
          {state.activeThread ? (
            <section className="tasks-thread-stage-shell tasks-thread-stage-shell-dock">
              <header className="tasks-thread-stage-shell-head">
                <div className="tasks-thread-stage-shell-head-text">
                  <strong>{t("tasks.workflow.title")}</strong>
                  <span>{getThreadStageLabel(state.activeThread.workflow.currentStageId)}</span>
                </div>
                <div className="tasks-thread-stage-rail is-dock">
                  {state.activeThread.workflow.stages.map((stage) => (
                    <button
                      className={`tasks-thread-stage-chip is-${stage.status}${selectedStage?.id === stage.id ? " is-selected" : ""}`}
                      key={stage.id}
                      onClick={() => {
                        setSelectedStageId(stage.id);
                      }}
                      type="button"
                    >
                      <span>{getThreadStageLabel(stage.id)}</span>
                      <small>{displayStageStatus(stage.status)}</small>
                    </button>
                  ))}
                </div>
              </header>
                <div className="tasks-thread-readiness-card">
                  <div className="tasks-thread-section-head">
                  <strong>{t("tasks.workflow.readiness")}</strong>
                  <span>{state.activeThread.workflow.readinessSummary}</span>
                </div>
                <p>{selectedStage?.summary || state.activeThread.workflow.nextAction}</p>
                <small>{state.activeThread.workflow.nextAction}</small>
              </div>
              <section className={`tasks-thread-files-panel${(state.activeThread?.files.length ?? 0) === 0 ? " is-empty" : ""}${isFilesExpanded ? " is-expanded" : ""}`}>
                <div className="tasks-thread-section-head tasks-thread-section-head-with-tools">
                  <strong>{t("tasks.files.title")}</strong>
                  <div className="tasks-thread-section-tools">
                    <span className="tasks-thread-section-count">{state.activeThread?.files.length ?? 0}</span>
                    <button
                      aria-label={isFilesExpanded ? t("tasks.files.collapse") : t("tasks.files.expand")}
                      className="tasks-thread-section-toggle"
                      onClick={() => setIsFilesExpanded((current) => !current)}
                      type="button"
                    >
                      <img alt="" aria-hidden="true" src={isFilesExpanded ? "/up-arrow.svg" : "/down-arrow.svg"} />
                    </button>
                  </div>
                </div>
                {state.activeThread?.changedFiles.length ? (
                  <div className="tasks-thread-changed-files-strip">
                    <div className="tasks-thread-section-head">
                      <strong>{t("tasks.files.changed")}</strong>
                      <span>{state.activeThread.changedFiles.length}</span>
                    </div>
                    <div className="tasks-thread-changed-file-tags">
                      {state.activeThread.changedFiles.map((path) => (
                        <button key={path} onClick={() => state.setSelectedFilePath(path)} type="button">
                          {path}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {(state.activeThread?.files.length ?? 0) > 0 ? (
                  <div className="tasks-thread-file-tree">
                    {renderFileTree(fileTree)}
                  </div>
                ) : (
                  <div className="tasks-thread-files-empty">{t("tasks.files.empty")}</div>
                )}
              </section>
            </section>
          ) : null}

          {state.activeThread ? (
            <section className="tasks-thread-workflow-panel">
              <div className="tasks-thread-section-head">
                <strong>{currentStageLabel}</strong>
                <span>{displayStageStatus(selectedStage?.status || "idle")}</span>
              </div>
              <div className="tasks-thread-workflow-meta">
                <div>
                  <span>{t("tasks.workflow.status")}</span>
                  <strong>{displayStageStatus(selectedStage?.status || state.activeThread?.thread.status || "idle")}</strong>
                </div>
                <div>
                  <span>{t("tasks.workflow.owner")}</span>
                  <strong>{selectedStage?.ownerPresetIds.map((roleId) => getTaskAgentLabel(roleId)).join(", ") || "-"}</strong>
                </div>
                <div>
                  <span>{t("tasks.workflow.blockers")}</span>
                  <strong>{selectedStage?.blockerCount ?? 0}</strong>
                </div>
                <div>
                  <span>{t("tasks.workflow.worktree")}</span>
                  <strong>{state.activeThread?.task.worktreePath || state.activeThread?.task.workspacePath || t("tasks.workflow.local")}</strong>
                </div>
              </div>
              <section className="tasks-thread-detail-text-panel is-inline">
                <div className="tasks-thread-section-head">
                  <strong>{t("tasks.workflow.summary")}</strong>
                  <span>{currentStageLabel}</span>
                </div>
                <pre>{selectedStage?.summary || state.activeThread?.workflow.nextAction || t("tasks.workflow.noSummary")}</pre>
              </section>
              {selectedStage?.id === "integrate" ? (
                <div className="tasks-thread-workflow-list">
                  {(state.activeThread?.approvals ?? []).length === 0 ? (
                    <p className="tasks-thread-empty-copy">{t("tasks.approval.none")}</p>
                  ) : (
                    (state.activeThread?.approvals ?? []).map((approval) => (
                      <article key={approval.id}>
                        <strong>{approval.kind.toUpperCase()}</strong>
                        <p>{approval.summary}</p>
                        <span>{approval.status.toUpperCase()}</span>
                      </article>
                    ))
                  )}
                </div>
              ) : null}
              {selectedStage?.id === "playtest" ? (
                <section className="tasks-thread-detail-text-panel is-inline">
                  <div className="tasks-thread-section-head">
                    <strong>{t("tasks.workflow.validation")}</strong>
                    <span>{state.activeThread?.validationState || t("tasks.workflow.pending")}</span>
                  </div>
                  <pre>{state.activeThread?.artifacts.validation || t("tasks.workflow.validationPending")}</pre>
                </section>
              ) : null}
              {selectedStage?.id === "lock" ? (
                <section className="tasks-thread-detail-text-panel is-inline">
                  <div className="tasks-thread-section-head">
                    <strong>{t("tasks.workflow.releaseChecklist")}</strong>
                    <span>{state.activeThread?.workflow.readinessSummary || t("tasks.workflow.preparing")}</span>
                  </div>
                  <pre>{`${t("tasks.workflow.approvalsPending")}: ${state.pendingApprovals.length}\n${t("tasks.workflow.validation")}: ${state.activeThread?.validationState || t("tasks.workflow.pending")}\n${t("tasks.workflow.handoff")}: ${state.activeThread?.artifacts.handoff || t("tasks.workflow.pending")}`}</pre>
                </section>
              ) : null}
            </section>
          ) : null}

          {state.activeThread ? (
            <section className="tasks-thread-agent-detail-panel">
              {state.selectedAgentDetail ? (
                <>
                  <div className="tasks-thread-section-head">
                    <strong>{state.selectedAgentDetail.agent.label}</strong>
                    <span>{displayStageStatus(state.selectedAgentDetail.agent.status)}</span>
                  </div>
                  <div className="tasks-thread-workflow-meta tasks-thread-agent-detail-grid">
                    <div>
                      <span>{t("tasks.agent.role")}</span>
                      <strong>{getTaskAgentLabel(state.selectedAgentDetail.agent.roleId)}</strong>
                    </div>
                    <div>
                      <span>{t("tasks.agent.studioRole")}</span>
                      <strong>{state.selectedAgentDetail.studioRoleId || "-"}</strong>
                    </div>
                    <div>
                      <span>{t("tasks.agent.execution")}</span>
                      <strong>{state.selectedAgentDetail.lastRunId || "-"}</strong>
                    </div>
                    <div>
                      <span>{t("tasks.workflow.worktree")}</span>
                      <strong>{state.selectedAgentDetail.worktreePath || state.activeThread?.task.workspacePath || "-"}</strong>
                    </div>
                  </div>
                  <section className="tasks-thread-detail-text-panel is-inline">
                    <div className="tasks-thread-section-head">
                      <strong>{t("tasks.agent.codexSession")}</strong>
                      <div className="tasks-thread-section-actions">
                        <span>{displayStageStatus(state.selectedAgentDetail.codexThreadStatus || "idle")}</span>
                        <button
                          className="tasks-thread-section-action-button"
                          disabled={!state.selectedAgentDetail.codexThreadId}
                          onClick={() => void state.compactSelectedAgentCodexThread()}
                          type="button"
                        >
                          {t("tasks.action.compact")}
                        </button>
                      </div>
                    </div>
                    <div className="tasks-thread-workflow-meta tasks-thread-agent-detail-grid">
                      <div>
                        <span>{t("tasks.agent.thread")}</span>
                        <strong>{state.selectedAgentDetail.codexThreadId || "-"}</strong>
                      </div>
                      <div>
                        <span>{t("tasks.agent.turn")}</span>
                        <strong>{state.selectedAgentDetail.codexTurnId || "-"}</strong>
                      </div>
                    </div>
                  </section>
                  <p className="tasks-thread-agent-summary">{state.selectedAgentDetail.agent.summary || t("tasks.agent.noSummary")}</p>
                  <section className={`tasks-thread-detail-text-panel is-inline${state.selectedAgentDetail.lastPrompt ? "" : " is-empty"}`}>
                    <div className="tasks-thread-section-head">
                      <strong>{t("tasks.agent.lastRequest")}</strong>
                      <span>{state.selectedAgentDetail.lastPromptAt || "-"}</span>
                    </div>
                    <pre>{state.selectedAgentDetail.lastPrompt || t("tasks.agent.noRequest")}</pre>
                  </section>
                </>
              ) : (
                <p className="tasks-thread-empty-copy">{t("tasks.agent.detailEmpty")}</p>
              )}
            </section>
          ) : null}
        </div>
      </aside>
      )}
    </section>
  );
}
