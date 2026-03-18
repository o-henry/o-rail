import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TURN_REASONING_LEVEL_OPTIONS } from "../../features/workflow/reasoningLevels";
import { RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";
import {
  UNITY_TASK_AGENT_ORDER,
  getTaskAgentLabel,
  getThreadStageLabel,
  type ThreadStageId,
} from "./taskAgentPresets";
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
  if (!value) return "NEW THREAD";
  const normalized = value.toLowerCase();
  if (normalized === "new thread" || normalized === "새 thread" || normalized === "새 스레드") {
    return "NEW THREAD";
  }
  return value;
}

function displayThreadTitle(input: string | null | undefined) {
  return normalizeThreadTitle(input) === "NEW THREAD" ? "새 스레드" : normalizeThreadTitle(input);
}

function displayThreadPath(input: string | null | undefined) {
  return String(input ?? "").trim().toUpperCase();
}

function displayStageStatus(input: string | null | undefined) {
  const normalized = String(input ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    idle: "대기",
    active: "진행 중",
    blocked: "차단됨",
    ready: "준비 완료",
    done: "완료",
    failed: "실패",
    thinking: "생각 중",
    awaiting_approval: "승인 대기",
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
  };
}

export default function TasksPage(props: TasksPageProps) {
  const state = useTasksThreadState(props);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const reasonMenuRef = useRef<HTMLDivElement | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isReasonMenuOpen, setIsReasonMenuOpen] = useState(false);
  const [agentDraftLabels, setAgentDraftLabels] = useState<Record<string, string>>({});
  const [editingAgentId, setEditingAgentId] = useState("");
  const [isEditingThreadTitle, setIsEditingThreadTitle] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const [selectedStageId, setSelectedStageId] = useState<ThreadStageId>("brief");
  const [isAgentsCollapsed, setIsAgentsCollapsed] = useState(false);
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState("");
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

  useEffect(() => {
    setThreadTitleDraft(headerTitle);
    setIsEditingThreadTitle(false);
  }, [headerTitle, state.activeThreadId]);

  useEffect(() => {
    setSelectedStageId(state.activeThread?.workflow.currentStageId ?? "brief");
  }, [state.activeThread?.thread.threadId, state.activeThread?.workflow.currentStageId]);

  useEffect(() => {
    setIsAgentsCollapsed(false);
    setPendingDeleteThreadId("");
  }, [state.activeThreadId]);

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

  const handleAgentLabelChange = (agentId: string, value: string) => {
    setAgentDraftLabels((current) => ({ ...current, [agentId]: value }));
  };

  const commitAgentLabel = (agentId: string, fallbackLabel: string) => {
    const nextLabel = String(agentDraftLabels[agentId] ?? fallbackLabel).trim() || fallbackLabel;
    setAgentDraftLabels((current) => ({ ...current, [agentId]: nextLabel }));
    setEditingAgentId((current) => (current === agentId ? "" : current));
    void state.updateAgent(agentId, nextLabel);
  };

  const commitThreadTitle = () => {
    const nextTitle = normalizeThreadTitle(threadTitleDraft);
    setThreadTitleDraft(nextTitle);
    setIsEditingThreadTitle(false);
    void state.renameThread(nextTitle);
  };

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void state.submitComposer();
  };

  const visibleAgentLabels = useMemo(
    () => (state.activeThread?.agents ?? []).map((agent) => agent.label),
    [state.activeThread?.agents],
  );
  const liveAgents = useMemo(
    () => (state.activeThread?.agents ?? []).filter((agent) => agent.status !== "idle" && agent.status !== "done"),
    [state.activeThread?.agents],
  );

  return (
    <section className="tasks-thread-layout workspace-tab-panel">
      <aside className="tasks-thread-nav">
        <div className="tasks-thread-nav-actions">
          <button className="tasks-thread-new-button" onClick={handleNewThread} type="button">
            새 스레드
          </button>
          <button className="tasks-thread-new-button" onClick={() => void state.openProjectDirectory()} type="button">
            프로젝트 열기
          </button>
        </div>
        <div className="tasks-thread-nav-copy">
          <strong>스레드</strong>
          <span>{state.loading ? "동기화 중" : `${state.threads.length}개`}</span>
        </div>
        <div className="tasks-thread-list">
          {state.threads.length === 0 ? (
            <p className="tasks-thread-empty-copy">아직 스레드가 없습니다</p>
          ) : (
            state.threads.map((item) => {
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
                      <span>{item.thread.updatedAt.slice(11, 16)}</span>
                    </div>
                    {item.workflowSummary ? (
                      <div className="tasks-thread-list-meta-row">
                        <span className={`tasks-thread-list-stage is-${item.workflowSummary.status}`}>
                          {getThreadStageLabel(item.workflowSummary.currentStageId)}
                        </span>
                        {item.workflowSummary.blocked ? <small>차단됨</small> : null}
                      </div>
                    ) : null}
                  </button>
                </article>
              );
            })
          )}
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
                  aria-label="Rename thread"
                  className="tasks-thread-title-button"
                  onClick={() => setIsEditingThreadTitle(true)}
                  type="button"
                >
                  {headerTitle}
                </button>
              )
            ) : null}
            <p>
              {displayThreadPath(state.activeThread?.task.worktreePath || state.activeThread?.task.workspacePath || state.projectPath || props.cwd)}
            </p>
          </div>
          {state.activeThread ? (
            <div className="tasks-thread-header-actions">
              <button
                aria-label={`Delete ${headerTitle}`}
                className="tasks-thread-header-delete-button"
                onClick={() => setPendingDeleteThreadId(state.activeThread?.thread.threadId ?? "")}
                type="button"
              >
                <img alt="" aria-hidden="true" src="/xmark-small-svgrepo-com.svg" />
              </button>
            </div>
          ) : null}
        </header>

        <div className="tasks-thread-conversation-scroll">
          {!state.activeThread ? (
            <section className="tasks-thread-empty-state">
              <strong>요청부터 시작하세요</strong>
              <p>@designer, @architect, @implementer, @playtest, @techart, @tools, @release, @docs로 유니티 에이전트를 지정할 수 있습니다.</p>
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
                        {parsed.artifactPath ? <small className="tasks-thread-message-artifact">{parsed.artifactPath}</small> : null}
                      </article>
                    );
                  })
                )}
              </section>

              {state.pendingApprovals.length > 0 ? (
                <section className="tasks-thread-approvals-stack">
                  {state.pendingApprovals.map((approval) => (
                    <article className="tasks-thread-approval-card" key={approval.id}>
                      <div className="tasks-thread-section-head">
                        <strong>승인 필요</strong>
                        <span>{approval.kind.toUpperCase()}</span>
                      </div>
                      <p>{approval.summary}</p>
                      <div className="tasks-thread-approval-actions">
                        <button onClick={() => void state.resolveApproval(approval, "rejected")} type="button">
                          거절
                        </button>
                        <button className="tasks-thread-primary" onClick={() => void state.resolveApproval(approval, "approved")} type="button">
                          승인
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}
            </>
          )}
        </div>

        {liveAgents.length > 0 ? (
          <section className="tasks-thread-running-strip">
            <div className="tasks-thread-section-head">
              <strong>실행 중인 에이전트</strong>
              <span>{liveAgents.length}</span>
            </div>
            <div className="tasks-thread-running-list">
              {liveAgents.map((agent) => (
                <article
                  className="tasks-thread-running-row"
                  key={agent.id}
                  onClick={() => void state.openAgent(agent)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void state.openAgent(agent);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="tasks-thread-running-copy">
                    <strong className={`role-${agent.roleId}`}>{agent.label}</strong>
                    <span>{displayStageStatus(agent.status)}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <div className="tasks-thread-composer-shell question-input agents-composer workflow-question-input">
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
          <textarea
            ref={composerRef}
            aria-label="Tasks composer"
            className="tasks-thread-composer-input"
            onKeyDown={onComposerKeyDown}
            placeholder="Describe the Unity change or use @designer @architect @implementer @playtest @techart @tools @release @docs"
            rows={1}
            value={state.composerDraft}
            onChange={(event) => state.setComposerDraft(event.target.value)}
          />
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
                  <ul aria-label="Tasks model" className="agents-model-menu" role="listbox">
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
                  <ul aria-label="Tasks reasoning level" className="agents-reason-menu" role="listbox">
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
                aria-label="SEND"
                className="primary-action question-create-button agents-send-button"
                disabled={!state.composerDraft.trim()}
                onClick={() => void state.submitComposer()}
                type="button"
              >
                <img alt="" aria-hidden="true" className="question-create-icon" src="/up.svg" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {pendingDeleteThreadId ? (
        <div className="modal-backdrop">
          <section className="approval-modal tasks-thread-confirm-modal">
            <h2>THREAD DELETE</h2>
            <p>정말 삭제하겠습니까?</p>
            <div className="tasks-thread-approval-actions">
              <button onClick={() => setPendingDeleteThreadId("")} type="button">
                CANCEL
              </button>
              <button
                className="tasks-thread-primary"
                onClick={() => {
                  void state.deleteThread(pendingDeleteThreadId);
                  setPendingDeleteThreadId("");
                }}
                type="button"
              >
                DELETE
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <aside className="tasks-thread-detail-panel">
        <div className="tasks-thread-detail-body">
          {state.activeThread ? (
            <section className="tasks-thread-stage-shell tasks-thread-stage-shell-dock">
              <header className="tasks-thread-stage-shell-head">
                <div className="tasks-thread-stage-shell-head-text">
                  <strong>워크플로우</strong>
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
                      <span>{stage.label}</span>
                      <small>{displayStageStatus(stage.status)}</small>
                    </button>
                  ))}
                </div>
              </header>
                <div className="tasks-thread-readiness-card">
                  <div className="tasks-thread-section-head">
                  <strong>다음 단계 준비 상태</strong>
                  <span>{state.activeThread.workflow.readinessSummary}</span>
                </div>
                <p>{selectedStage?.summary || state.activeThread.workflow.nextAction}</p>
                <small>{state.activeThread.workflow.nextAction}</small>
              </div>
              <section className="tasks-thread-agents-card">
                <div className="tasks-thread-section-head">
                  <strong>백그라운드 에이전트</strong>
                  <span>{state.activeThread.agents.length}</span>
                  <button
                    aria-label={isAgentsCollapsed ? "Expand background agents" : "Collapse background agents"}
                    className="tasks-thread-section-toggle"
                    onClick={() => setIsAgentsCollapsed((current) => !current)}
                    type="button"
                  >
                    <img alt="" aria-hidden="true" src={isAgentsCollapsed ? "/down-arrow.svg" : "/up-arrow.svg"} />
                  </button>
                </div>
                {!isAgentsCollapsed ? (
                  <>
                    <div className="tasks-thread-agent-list">
                      {state.activeThread.agents.length === 0 ? (
                        <p className="tasks-thread-empty-copy">아직 에이전트가 없습니다</p>
                      ) : (
                        state.activeThread.agents.map((agent) => (
                          <article
                            className={`tasks-thread-agent-row${state.selectedAgentId === agent.id ? " is-selected" : ""}`}
                            key={agent.id}
                            onClick={() => void state.openAgent(agent)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                void state.openAgent(agent);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="tasks-thread-agent-main">
                              <div className="tasks-thread-agent-name-slot">
                                {editingAgentId === agent.id ? (
                                  <input
                                    autoFocus
                                    className={`tasks-thread-agent-inline-input role-${agent.roleId}`}
                                    onBlur={() => commitAgentLabel(agent.id, agent.label)}
                                    onChange={(event) => handleAgentLabelChange(agent.id, event.target.value)}
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        commitAgentLabel(agent.id, agent.label);
                                      }
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        setAgentDraftLabels((current) => ({ ...current, [agent.id]: agent.label }));
                                        setEditingAgentId("");
                                      }
                                    }}
                                    value={agentDraftLabels[agent.id] ?? agent.label}
                                  />
                                ) : (
                                  <button
                                    className={`tasks-thread-agent-label-button role-${agent.roleId}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setAgentDraftLabels((current) => ({ ...current, [agent.id]: current[agent.id] ?? agent.label }));
                                      setEditingAgentId(agent.id);
                                    }}
                                    type="button"
                                  >
                                    {agent.label}
                                  </button>
                                )}
                              </div>
                              <span className="tasks-thread-agent-meta">
                                {agent.worktreePath || state.activeThread?.task.workspacePath || "로컬"}
                              </span>
                            </div>
                            <div className="tasks-thread-agent-side">
                              <span className={`tasks-thread-agent-status is-${agent.status}`}>{displayStageStatus(agent.status)}</span>
                              <div className="tasks-thread-agent-actions">
                                <button
                                  aria-label={`Remove ${agent.label}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void state.removeAgent(agent.id);
                                  }}
                                  type="button"
                                >
                                  <img alt="" aria-hidden="true" className="tasks-thread-agent-action-icon" src="/xmark.svg" />
                                </button>
                              </div>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                    <div className="tasks-thread-agent-add-row">
                      {(UNITY_TASK_AGENT_ORDER as ThreadRoleId[])
                        .filter((roleId) => !(state.activeThread?.agents ?? []).some((agent) => agent.roleId === roleId))
                        .map((roleId) => (
                          <button key={roleId} onClick={() => void state.addAgent(roleId, getTaskAgentLabel(roleId))} type="button">
                            {`+ ${getTaskAgentLabel(roleId)}`}
                          </button>
                        ))}
                    </div>
                  </>
                ) : null}
              </section>
              <section className={`tasks-thread-files-panel${(state.activeThread?.files.length ?? 0) === 0 ? " is-empty" : ""}`}>
                <div className="tasks-thread-section-head">
                  <strong>파일</strong>
                  <span>{state.activeThread?.files.length ?? 0}</span>
                </div>
                {state.activeThread?.changedFiles.length ? (
                  <div className="tasks-thread-changed-files-strip">
                    <div className="tasks-thread-section-head">
                      <strong>변경됨</strong>
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
                  <div className="tasks-thread-file-list">
                    {(state.activeThread?.files ?? []).map((file) => (
                      <button
                        className={state.selectedFilePath === file.path ? "is-active" : ""}
                        key={file.path}
                        onClick={() => state.setSelectedFilePath(file.path)}
                        type="button"
                      >
                        <span>{file.path}</span>
                        <small>{file.changed ? "changed" : "tracked"}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="tasks-thread-files-empty">연결된 파일이 아직 없습니다.</div>
                )}
                {state.selectedFilePath ? (
                  <div className="tasks-thread-file-preview">
                    <div className="tasks-thread-section-head">
                      <strong>{state.selectedFilePath}</strong>
                      <span>미리보기</span>
                    </div>
                    <pre>{state.selectedFileContent || ""}</pre>
                  </div>
                ) : null}
              </section>
            </section>
          ) : null}

          {state.activeThread ? (
            <section className="tasks-thread-workflow-panel">
              <div className="tasks-thread-section-head">
                <strong>{selectedStage?.label || "워크플로우"}</strong>
                <span>{displayStageStatus(selectedStage?.status || "idle")}</span>
              </div>
              <div className="tasks-thread-workflow-meta">
                <div>
                  <span>상태</span>
                  <strong>{displayStageStatus(selectedStage?.status || state.activeThread?.thread.status || "idle")}</strong>
                </div>
                <div>
                  <span>담당</span>
                  <strong>{selectedStage?.ownerPresetIds.map((roleId) => getTaskAgentLabel(roleId)).join(", ") || "-"}</strong>
                </div>
                <div>
                  <span>막힘 요소</span>
                  <strong>{selectedStage?.blockerCount ?? 0}</strong>
                </div>
                <div>
                  <span>작업 경로</span>
                  <strong>{state.activeThread?.task.worktreePath || state.activeThread?.task.workspacePath || "로컬"}</strong>
                </div>
              </div>
              <section className="tasks-thread-detail-text-panel is-inline">
                <div className="tasks-thread-section-head">
                  <strong>요약</strong>
                  <span>{selectedStage?.label || "워크플로우"}</span>
                </div>
                <pre>{selectedStage?.summary || state.activeThread?.workflow.nextAction || "아직 워크플로우 요약이 없습니다."}</pre>
              </section>
              {selectedStage?.id === "integrate" ? (
                <div className="tasks-thread-workflow-list">
                  {(state.activeThread?.approvals ?? []).length === 0 ? (
                    <p className="tasks-thread-empty-copy">대기 중인 승인이 없습니다</p>
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
                    <strong>검증</strong>
                    <span>{state.activeThread?.validationState || "pending"}</span>
                  </div>
                  <pre>{state.activeThread?.artifacts.validation || "Validation pending."}</pre>
                </section>
              ) : null}
              {selectedStage?.id === "lock" ? (
                <section className="tasks-thread-detail-text-panel is-inline">
                  <div className="tasks-thread-section-head">
                    <strong>마감 체크리스트</strong>
                    <span>{state.activeThread?.workflow.readinessSummary || "준비 중"}</span>
                  </div>
                  <pre>{`Approvals pending: ${state.pendingApprovals.length}\nValidation: ${state.activeThread?.validationState || "pending"}\nHandoff: ${state.activeThread?.artifacts.handoff || "pending"}`}</pre>
                </section>
              ) : null}
            </section>
          ) : null}

          {state.activeThread ? (
            <section className="tasks-thread-detail-text-panel">
              <div className="tasks-thread-section-head">
                <strong>변경 내용</strong>
                <span>{state.selectedFilePath || "선택된 파일 없음"}</span>
              </div>
              <pre>{state.selectedFileDiff || "선택한 파일의 변경 내용을 아직 표시할 수 없습니다."}</pre>
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
                      <span>역할</span>
                      <strong>{getTaskAgentLabel(state.selectedAgentDetail.agent.roleId)}</strong>
                    </div>
                    <div>
                      <span>스튜디오 역할</span>
                      <strong>{state.selectedAgentDetail.studioRoleId || "-"}</strong>
                    </div>
                    <div>
                      <span>실행</span>
                      <strong>{state.selectedAgentDetail.lastRunId || "-"}</strong>
                    </div>
                    <div>
                      <span>작업 경로</span>
                      <strong>{state.selectedAgentDetail.worktreePath || state.activeThread?.task.workspacePath || "-"}</strong>
                    </div>
                  </div>
                  <p className="tasks-thread-agent-summary">{state.selectedAgentDetail.agent.summary || "아직 요약이 없습니다."}</p>
                  <section className={`tasks-thread-detail-text-panel is-inline${state.selectedAgentDetail.lastPrompt ? "" : " is-empty"}`}>
                    <div className="tasks-thread-section-head">
                      <strong>마지막 요청</strong>
                      <span>{state.selectedAgentDetail.lastPromptAt || "-"}</span>
                    </div>
                    <pre>{state.selectedAgentDetail.lastPrompt || "아직 요청이 없습니다."}</pre>
                  </section>
                  <section className="tasks-thread-artifact-list">
                    <div className="tasks-thread-section-head">
                      <strong>산출물</strong>
                      <span>{state.selectedAgentDetail.artifactPaths.length}</span>
                    </div>
                    {state.selectedAgentDetail.artifactPaths.length === 0 ? (
                      <p className="tasks-thread-empty-copy">산출물이 없습니다</p>
                    ) : (
                      <ul>
                        {state.selectedAgentDetail.artifactPaths.map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                  {state.selectedAgentDetail.latestArtifactPath ? (
                    <section className="tasks-thread-detail-text-panel is-inline">
                      <div className="tasks-thread-section-head">
                        <strong>최신 문서</strong>
                        <span>{state.selectedAgentDetail.latestArtifactPath}</span>
                      </div>
                      <pre>{state.selectedAgentDetail.latestArtifactPreview || "최신 산출물의 텍스트 미리보기를 표시할 수 없습니다."}</pre>
                    </section>
                  ) : null}
                </>
              ) : (
                <p className="tasks-thread-empty-copy">백그라운드 에이전트를 선택하면 상세 정보를 볼 수 있습니다.</p>
              )}
            </section>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
