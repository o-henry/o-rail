import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TURN_REASONING_LEVEL_OPTIONS } from "../../features/workflow/reasoningLevels";
import { RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";
import { useTasksThreadState } from "./useTasksThreadState";
import { THREAD_DETAIL_TABS, THREAD_ROLE_LABELS, type ThreadRoleId } from "./threadTypes";

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

function normalizeThreadPreview(input: string | null | undefined) {
  const value = String(input ?? "").trim();
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (
    normalized === "new thread" ||
    normalized === "새 thread" ||
    normalized === "새 스레드" ||
    normalized === "draft thread"
  ) {
    return "";
  }
  return value;
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
  const title = useMemo(() => normalizeThreadTitle(state.activeThread?.thread.title), [state.activeThread]);
  const selectedModelOption = useMemo(
    () => RUNTIME_MODEL_OPTIONS.find((option) => option.value === state.model) ?? RUNTIME_MODEL_OPTIONS[0],
    [state.model],
  );

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

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void state.submitComposer();
  };

  return (
    <section className="tasks-thread-layout workspace-tab-panel">
      <aside className="tasks-thread-nav">
        <button className="tasks-thread-new-button" onClick={handleNewThread} type="button">
          NEW THREAD
        </button>
        <div className="tasks-thread-nav-copy">
          <strong>THREADS</strong>
          <span>{state.loading ? "SYNCING" : `${state.threads.length} ITEMS`}</span>
        </div>
        <div className="tasks-thread-list">
          {state.threads.length === 0 ? (
            <p className="tasks-thread-empty-copy">NO THREADS YET</p>
          ) : (
            state.threads.map((item) => {
              const preview = normalizeThreadPreview(item.thread.userPrompt);
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
                      <strong>{normalizeThreadTitle(item.thread.title)}</strong>
                      <span>{item.thread.updatedAt.slice(11, 16)}</span>
                    </div>
                    {preview ? <p>{preview}</p> : null}
                    <div className="tasks-thread-list-meta">
                      <span>{String(item.thread.status || "idle").toUpperCase()}</span>
                      <span>{`${item.agentCount} AGENTS`}</span>
                      <span>{`${item.pendingApprovalCount} APPROVALS`}</span>
                    </div>
                  </button>
                  <button
                    aria-label={`Delete ${normalizeThreadTitle(item.thread.title)}`}
                    className="tasks-thread-list-delete"
                    onClick={() => void state.deleteThread(item.thread.threadId)}
                    type="button"
                  >
                    ×
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
            <strong>{normalizeThreadTitle(title)}</strong>
            <p>
              {state.activeThread
                ? `PROJECT · ${state.activeThread.task.worktreePath || state.activeThread.task.workspacePath}`
                : "Create a thread for the current project, then use @explorer @worker @reviewer @qa."}
            </p>
          </div>
        </header>

        <div className="tasks-thread-conversation-scroll">
          {!state.activeThread ? (
            <section className="tasks-thread-empty-state">
              <strong>START WITH A REQUEST</strong>
              <p>Use @explorer, @worker, @reviewer, or @qa to target agents, or describe the goal in plain English.</p>
            </section>
          ) : (
            <>
              <section className="tasks-thread-timeline">
                {state.activeThread.messages.length === 0 ? (
                  <article className="tasks-thread-message is-system">
                    <div className="tasks-thread-message-meta">
                      <span>SYSTEM</span>
                      <span>{state.activeThread.thread.createdAt.slice(11, 16)}</span>
                    </div>
                    <div className="tasks-thread-message-body">Thread created. Ask for a follow-up and tag any agents you want to involve.</div>
                  </article>
                ) : (
                  state.activeThread.messages.map((message) => (
                    <article className={`tasks-thread-message is-${message.role}`} key={message.id}>
                      <div className="tasks-thread-message-meta">
                        <span>{message.role.toUpperCase()}</span>
                        <span>{message.createdAt.slice(11, 16)}</span>
                      </div>
                      <div className="tasks-thread-message-body">{message.content}</div>
                    </article>
                  ))
                )}
              </section>

              <section className="tasks-thread-agents-card">
                <div className="tasks-thread-section-head">
                  <strong>BACKGROUND AGENTS</strong>
                  <span>{state.activeThread.agents.length}</span>
                </div>
                <div className="tasks-thread-agent-list">
                  {state.activeThread.agents.length === 0 ? (
                    <p className="tasks-thread-empty-copy">NO AGENTS YET</p>
                  ) : (
                    state.activeThread.agents.map((agent) => (
                      <article className="tasks-thread-agent-row" key={agent.id}>
                        <div className="tasks-thread-agent-name-slot">
                          {editingAgentId === agent.id ? (
                            <input
                              autoFocus
                              className={`tasks-thread-agent-inline-input role-${agent.roleId}`}
                              onBlur={() => commitAgentLabel(agent.id, agent.label)}
                              onChange={(event) => handleAgentLabelChange(agent.id, event.target.value)}
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
                              onClick={() => {
                                setAgentDraftLabels((current) => ({ ...current, [agent.id]: current[agent.id] ?? agent.label }));
                                setEditingAgentId(agent.id);
                              }}
                              type="button"
                            >
                              {agent.label}
                            </button>
                          )}
                        </div>
                        <span className={`tasks-thread-agent-status is-${agent.status}`}>{agent.status.replace(/_/g, " ")}</span>
                        <div className="tasks-thread-agent-actions">
                          <button onClick={() => void state.openAgent(agent)} type="button">
                            OPEN
                          </button>
                          <button onClick={() => void state.removeAgent(agent.id)} type="button">
                            REMOVE
                          </button>
                        </div>
                        <p className="tasks-thread-agent-row-summary">{agent.summary || `${agent.label} is ${agent.status.replace(/_/g, " ")}`}</p>
                      </article>
                    ))
                  )}
                </div>
                <div className="tasks-thread-agent-add-row">
                  {(["explorer", "reviewer", "worker", "qa"] as ThreadRoleId[])
                    .filter((roleId) => !(state.activeThread?.agents ?? []).some((agent) => agent.roleId === roleId))
                    .map((roleId) => (
                      <button key={roleId} onClick={() => void state.addAgent(roleId, THREAD_ROLE_LABELS[roleId])} type="button">
                        {`+ ${THREAD_ROLE_LABELS[roleId]}`}
                      </button>
                    ))}
                </div>
              </section>

              {state.pendingApprovals.length > 0 ? (
                <section className="tasks-thread-approvals-stack">
                  {state.pendingApprovals.map((approval) => (
                    <article className="tasks-thread-approval-card" key={approval.id}>
                      <div className="tasks-thread-section-head">
                        <strong>APPROVAL REQUIRED</strong>
                        <span>{approval.kind.toUpperCase()}</span>
                      </div>
                      <p>{approval.summary}</p>
                      <div className="tasks-thread-approval-actions">
                        <button onClick={() => void state.resolveApproval(approval, "rejected")} type="button">
                          REJECT
                        </button>
                        <button className="tasks-thread-primary" onClick={() => void state.resolveApproval(approval, "approved")} type="button">
                          APPROVE
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}
            </>
          )}
        </div>

        <div className="tasks-thread-composer-shell question-input agents-composer workflow-question-input">
          <textarea
            ref={composerRef}
            aria-label="Tasks composer"
            className="tasks-thread-composer-input"
            onKeyDown={onComposerKeyDown}
            placeholder="Ask for follow-up changes or use @explorer @worker @reviewer @qa to target agents"
            rows={1}
            value={state.composerDraft}
            onChange={(event) => state.setComposerDraft(event.target.value)}
          />
          <div className="question-input-footer tasks-thread-composer-toolbar">
            <div className="agents-composer-left tasks-thread-composer-controls">
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

      <aside className="tasks-thread-detail-panel">
        <div className="tasks-thread-detail-tabs">
          {THREAD_DETAIL_TABS.map((tab) => (
            <button
              aria-label={tab.toUpperCase()}
              className={state.detailTab === tab ? "is-active" : ""}
              key={tab}
              onClick={() => state.setDetailTab(tab)}
              title={tab.toUpperCase()}
              type="button"
            >
              <img alt="" aria-hidden="true" className="tasks-thread-detail-tab-icon" src={`/${tab}.svg`} />
            </button>
          ))}
        </div>

        <div className="tasks-thread-detail-body">
          {state.detailTab === "files" ? (
            <section className="tasks-thread-files-panel">
              <div className="tasks-thread-section-head">
                <strong>FILES</strong>
                <span>{state.activeThread?.files.length ?? 0}</span>
              </div>
              {state.activeThread?.changedFiles.length ? (
                <div className="tasks-thread-changed-files-strip">
                  <div className="tasks-thread-section-head">
                    <strong>CHANGED</strong>
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
              {state.selectedFilePath ? (
                <div className="tasks-thread-file-preview">
                  <div className="tasks-thread-section-head">
                    <strong>{state.selectedFilePath}</strong>
                    <span>PREVIEW</span>
                  </div>
                  <pre>{state.selectedFileContent || ""}</pre>
                </div>
              ) : null}
            </section>
          ) : null}

          {state.detailTab === "diff" ? (
            <section className="tasks-thread-detail-text-panel">
              <div className="tasks-thread-section-head">
                <strong>DIFF</strong>
                <span>{state.selectedFilePath || "NO FILE"}</span>
              </div>
              <pre>{state.selectedFileDiff || "No diff available for the selected file."}</pre>
            </section>
          ) : null}

          {state.detailTab === "workflow" ? (
            <section className="tasks-thread-workflow-panel">
              <div className="tasks-thread-section-head">
                <strong>WORKFLOW</strong>
                <span>{state.pendingApprovals.length} pending</span>
              </div>
              <div className="tasks-thread-workflow-meta">
                <div>
                  <span>STATUS</span>
                  <strong>{state.activeThread?.thread.status || "idle"}</strong>
                </div>
                <div>
                  <span>VALIDATION</span>
                  <strong>{state.activeThread?.validationState || "pending"}</strong>
                </div>
                <div>
                  <span>RISK</span>
                  <strong>{state.activeThread?.riskLevel || "medium"}</strong>
                </div>
                <div>
                  <span>WORKTREE</span>
                  <strong>{state.activeThread?.task.worktreePath || state.activeThread?.task.workspacePath || "LOCAL"}</strong>
                </div>
              </div>
              <div className="tasks-thread-workflow-list">
                {(state.activeThread?.approvals ?? []).length === 0 ? (
                  <p className="tasks-thread-empty-copy">NO APPROVALS</p>
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
            </section>
          ) : null}

          {state.detailTab === "agent" ? (
            <section className="tasks-thread-agent-detail-panel">
              {state.selectedAgentDetail ? (
                <>
                  <div className="tasks-thread-section-head">
                    <strong>{state.selectedAgentDetail.agent.label}</strong>
                    <span>{state.selectedAgentDetail.agent.status.replace(/_/g, " ")}</span>
                  </div>
                  <div className="tasks-thread-workflow-meta tasks-thread-agent-detail-grid">
                    <div>
                      <span>ROLE</span>
                      <strong>{THREAD_ROLE_LABELS[state.selectedAgentDetail.agent.roleId]}</strong>
                    </div>
                    <div>
                      <span>STUDIO ROLE</span>
                      <strong>{state.selectedAgentDetail.studioRoleId || "-"}</strong>
                    </div>
                    <div>
                      <span>RUN</span>
                      <strong>{state.selectedAgentDetail.lastRunId || "-"}</strong>
                    </div>
                    <div>
                      <span>WORKTREE</span>
                      <strong>{state.selectedAgentDetail.worktreePath || state.activeThread?.task.workspacePath || "-"}</strong>
                    </div>
                  </div>
                  <p className="tasks-thread-agent-summary">{state.selectedAgentDetail.agent.summary || "No summary yet."}</p>
                  <section className="tasks-thread-detail-text-panel is-inline">
                    <div className="tasks-thread-section-head">
                      <strong>LAST PROMPT</strong>
                      <span>{state.selectedAgentDetail.lastPromptAt || "-"}</span>
                    </div>
                    <pre>{state.selectedAgentDetail.lastPrompt || "No prompt yet."}</pre>
                  </section>
                  <section className="tasks-thread-artifact-list">
                    <div className="tasks-thread-section-head">
                      <strong>ARTIFACTS</strong>
                      <span>{state.selectedAgentDetail.artifactPaths.length}</span>
                    </div>
                    {state.selectedAgentDetail.artifactPaths.length === 0 ? (
                      <p className="tasks-thread-empty-copy">NO ARTIFACTS</p>
                    ) : (
                      <ul>
                        {state.selectedAgentDetail.artifactPaths.map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              ) : (
                <p className="tasks-thread-empty-copy">Select a background agent to inspect its details.</p>
              )}
            </section>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
