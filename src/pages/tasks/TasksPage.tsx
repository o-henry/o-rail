import { useMemo } from "react";
import { TaskTerminalViewport } from "./TaskTerminalViewport";
import { taskTerminalStatusLabel, useTaskTerminalGrid } from "./useTaskTerminalGrid";
import { useTasksPageState } from "./useTasksPageState";
import {
  TASK_ARTIFACT_KEYS,
  TASK_ISOLATION_OPTIONS,
  TASK_MODE_OPTIONS,
  TASK_ROLE_LABELS,
  TASK_TEAM_OPTIONS,
  TASK_STATUS_GROUPS,
  type TaskArtifactKey,
  type TaskComposerTarget,
} from "./taskTypes";

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
};

function statusHeading(status: string) {
  if (status === "active") return "ACTIVE";
  if (status === "queued") return "QUEUED";
  return "COMPLETED";
}

function pathTail(pathValue: string): string {
  const trimmed = String(pathValue ?? "").trim();
  if (!trimmed) return "workspace";
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length <= 2) return trimmed;
  return parts.slice(-2).join("/");
}

export default function TasksPage(props: TasksPageProps) {
  const state = useTasksPageState(props);
  const terminal = useTaskTerminalGrid(state.activeTask);

  const activeRoles = useMemo(
    () => state.activeTask?.record.roles.filter((role) => role.enabled) ?? [],
    [state.activeTask],
  );
  const availableTargets = useMemo(
    () => state.enabledRoleTargets.filter((target) => target === "all" || activeRoles.some((role) => role.id === target)),
    [activeRoles, state.enabledRoleTargets],
  );
  const recentPrompts = useMemo(
    () => [...(state.activeTask?.record.prompts ?? [])].slice(-8).reverse(),
    [state.activeTask],
  );

  return (
    <section className="tasks-layout workspace-tab-panel">
      {state.isCreateModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="NEW TASK" className="approval-modal task-create-modal">
            <header className="task-create-head">
              <div>
                <strong>NEW TASK</strong>
                <p>Goal 하나만 입력하면 역할 squad와 task artifacts를 바로 시작합니다.</p>
              </div>
              <button className="agents-off-button" onClick={() => state.setIsCreateModalOpen(false)} type="button">
                CLOSE
              </button>
            </header>
            <label className="task-create-field">
              <span>GOAL</span>
              <textarea
                placeholder="예: 점프 버그 원인 찾고 수정안까지 정리"
                value={state.createInput.goal}
                onChange={(event) => state.setCreateInput((current) => ({ ...current, goal: event.target.value }))}
              />
            </label>
            <div className="task-create-grid">
              <label className="task-create-field">
                <span>MODE</span>
                <select
                  value={state.createInput.mode}
                  onChange={(event) => state.setCreateInput((current) => ({ ...current, mode: event.target.value as any }))}
                >
                  {TASK_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-create-field">
                <span>TEAM</span>
                <select
                  value={state.createInput.team}
                  onChange={(event) => state.setCreateInput((current) => ({ ...current, team: event.target.value as any }))}
                >
                  {TASK_TEAM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-create-field">
                <span>ISOLATION</span>
                <select
                  value={state.createInput.isolation}
                  onChange={(event) => state.setCreateInput((current) => ({ ...current, isolation: event.target.value as any }))}
                >
                  {TASK_ISOLATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="task-create-actions">
              <button onClick={() => state.setIsCreateModalOpen(false)} type="button">
                CANCEL
              </button>
              <button className="task-primary-button" onClick={() => void state.createTask()} type="button">
                START TASK
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <div className="tasks-shell">
        <aside className="panel-card tasks-sidebar">
          <div className="tasks-sidebar-head">
            <div>
              <strong>TASKS</strong>
              <small>{state.loading ? "SYNCING" : `${state.groupedTasks.active.length} ACTIVE`}</small>
            </div>
            <button className="task-primary-button" onClick={() => state.setIsCreateModalOpen(true)} type="button">
              NEW TASK
            </button>
          </div>
          {TASK_STATUS_GROUPS.map((group) => {
            const items = state.groupedTasks[group];
            return (
              <section className="tasks-sidebar-group" key={group}>
                <header>{statusHeading(group)}</header>
                <div className="tasks-sidebar-list">
                  {items.length === 0 ? (
                    <p className="tasks-empty-copy">NO TASKS</p>
                  ) : (
                    items.map((item) => (
                      <button
                        className={`tasks-sidebar-item${state.activeTaskId === item.record.taskId ? " is-active" : ""}`}
                        key={item.record.taskId}
                        onClick={() => void state.selectTask(item.record.taskId)}
                        type="button"
                      >
                        <strong>{item.record.taskId}</strong>
                        <span>{item.record.goal}</span>
                        <small>{`${item.riskLevel.toUpperCase()} · ${item.validationState.toUpperCase()} · FILES ${item.changedFileCount}`}</small>
                      </button>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </aside>

        <section className="tasks-main">
          {state.activeTask ? (
            <>
              <div className="tasks-topbar">
                <div className="tasks-topbar-copy">
                  <strong>{state.activeTask.record.taskId}</strong>
                  <p>{state.activeTask.record.goal}</p>
                </div>
                <div className="tasks-topbar-actions">
                  <button className="task-primary-button" onClick={() => void terminal.startEnabledPanes()} type="button">
                    START SQUAD
                  </button>
                  <button onClick={() => void terminal.stopAllPanes()} type="button">
                    STOP SQUAD
                  </button>
                  <button onClick={() => void state.markTaskStatus("queued")} type="button">
                    QUEUE
                  </button>
                  <button onClick={() => void state.markTaskStatus("completed")} type="button">
                    COMPLETE
                  </button>
                  <button onClick={() => void state.markTaskStatus("archived")} type="button">
                    ARCHIVE
                  </button>
                </div>
              </div>

              <div className="tasks-runtime-shell">
                <section className="panel-card tasks-stage">
                  <div className="tasks-stage-head">
                    <div className="tasks-stage-copy">
                      <strong>TERMINALS</strong>
                      <p>{pathTail(terminal.terminalCwd || state.activeTask.record.workspacePath)}</p>
                    </div>
                    <div className="tasks-badges">
                      <span>{`MODE · ${String(state.activeTask.record.mode).toUpperCase()}`}</span>
                      <span>{`TEAM · ${String(state.activeTask.record.team).toUpperCase()}`}</span>
                      <span>{`RISK · ${state.activeTask.riskLevel.toUpperCase()}`}</span>
                      <span>{`VALIDATION · ${state.activeTask.validationState.toUpperCase()}`}</span>
                    </div>
                  </div>

                  <div className="tasks-terminal-grid">
                    {terminal.panes.map((pane) => {
                      const isSelected = pane.id === terminal.selectedPaneId;
                      return (
                        <article
                          className={`tasks-terminal-pane${isSelected ? " is-selected" : ""}`}
                          key={pane.id}
                          onClick={() => terminal.setSelectedPaneId(pane.id)}
                        >
                          <div className="tasks-terminal-pane-topbar">
                            <strong>{pane.title}</strong>
                            <span className={`tasks-terminal-pane-status is-${pane.status}`}>
                              {taskTerminalStatusLabel(pane.status, pane.exitCode)}
                            </span>
                          </div>
                          <div className="tasks-terminal-pane-meta">
                            <span>{pane.subtitle}</span>
                            <span>{pathTail(terminal.terminalCwd)}</span>
                          </div>
                          <div className="tasks-terminal-pane-body"><TaskTerminalViewport pane={pane} selected={isSelected} onTerminalData={(chars) => terminal.sendPaneChars(pane.id, chars)} /></div>
                          <div className="tasks-terminal-pane-actions">
                            <button
                              className="mini-action-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void terminal.startPane(pane.id);
                              }}
                              type="button"
                            >
                              <span className="mini-action-button-label">START</span>
                            </button>
                            <button
                              className="mini-action-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void terminal.stopPane(pane.id);
                              }}
                              type="button"
                            >
                              <span className="mini-action-button-label">STOP</span>
                            </button>
                            <button
                              className="mini-action-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                terminal.clearPane(pane.id);
                              }}
                              type="button"
                            >
                              <span className="mini-action-button-label">CLEAR</span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <aside className="panel-card tasks-detail-panel">
                  <section className="tasks-meta-grid tasks-detail-meta-grid">
                    <div>
                      <span>STATUS</span>
                      <strong>{String(state.activeTask.record.status).toUpperCase()}</strong>
                    </div>
                    <div>
                      <span>ISOLATION</span>
                      <strong>{String(state.activeTask.record.isolationResolved).toUpperCase()}</strong>
                    </div>
                    <div>
                      <span>WORKSPACE</span>
                      <strong>{state.activeTask.record.workspacePath}</strong>
                    </div>
                    <div>
                      <span>WORKTREE</span>
                      <strong>{state.activeTask.record.worktreePath || "CURRENT REPO"}</strong>
                    </div>
                  </section>

                  {state.activeTask.record.fallbackReason ? (
                    <p className="tasks-warning-copy">{state.activeTask.record.fallbackReason}</p>
                  ) : null}

                  <section className="tasks-artifacts-panel-shell">
                    <div className="tasks-artifact-tabs">
                      {TASK_ARTIFACT_KEYS.map((key) => (
                        <button
                          className={state.artifactKey === key ? "is-active" : ""}
                          key={key}
                          onClick={() => state.setArtifactKey(key as TaskArtifactKey)}
                          type="button"
                        >
                          {key.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="tasks-artifact-editor"
                      value={state.artifactDraft}
                      onChange={(event) => state.setArtifactDraft(event.target.value)}
                    />
                    <div className="tasks-artifact-actions">
                      <button onClick={() => void state.saveArtifact()} type="button">
                        SAVE {state.artifactKey.toUpperCase()}
                      </button>
                    </div>
                  </section>

                  <section className="tasks-changed-files">
                    <header>
                      <strong>CHANGED FILES</strong>
                      <span>{state.activeTask.changedFiles.length}</span>
                    </header>
                    {state.activeTask.changedFiles.length === 0 ? (
                      <p className="tasks-empty-copy">NO FILE CHANGES YET</p>
                    ) : (
                      <ul>
                        {state.activeTask.changedFiles.slice(0, 10).map((filePath) => (
                          <li key={filePath}>{filePath}</li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="tasks-prompt-log">
                    <header>
                      <strong>LOG</strong>
                      <span>{recentPrompts.length}</span>
                    </header>
                    {recentPrompts.length === 0 ? (
                      <p className="tasks-empty-copy">NO PROMPTS YET</p>
                    ) : (
                      <div className="tasks-prompt-list">
                        {recentPrompts.map((prompt) => (
                          <article className="tasks-prompt-item" key={prompt.id}>
                            <div className="tasks-prompt-item-meta">
                              <span>{String(prompt.target).toUpperCase()}</span>
                              <span>{prompt.createdAt}</span>
                            </div>
                            <p>{prompt.prompt}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </>
          ) : (
            <section className="panel-card tasks-empty-state">
              <strong>NEW TASK</strong>
              <p>Task를 만들면 역할별 terminal pane과 `.rail/tasks/&lt;task-id&gt;/...` artifacts가 함께 시작됩니다.</p>
              <button className="task-primary-button" onClick={() => state.setIsCreateModalOpen(true)} type="button">
                OPEN TASK MODAL
              </button>
            </section>
          )}
        </section>
      </div>

      <div className="agents-composer tasks-composer">
        <div className="tasks-composer-targets" role="tablist" aria-label="Task prompt targets">
          {availableTargets.map((target) => (
            <button
              className={state.composerTarget === target ? "is-active" : ""}
              key={target}
              onClick={() => state.setComposerTarget(target as TaskComposerTarget)}
              type="button"
            >
              {target === "all" ? "ALL" : TASK_ROLE_LABELS[target]}
            </button>
          ))}
        </div>
        <textarea
          aria-label="Task composer"
          placeholder="Prompt를 입력하면 선택한 역할 squad에 orchestration run을 보냅니다."
          value={state.composerDraft}
          onChange={(event) => state.setComposerDraft(event.target.value)}
        />
        <div className="agents-composer-row">
          <div className="agents-composer-left">
            <span className="tasks-composer-hint">
              {state.activeTask ? `${state.activeTask.record.taskId} · ${terminal.selectedPane?.title ?? "ALL"}` : "NO TASK"}
            </span>
          </div>
          <div className="agents-composer-right">
            <button className="task-primary-button" onClick={() => void state.sendComposer()} type="button">
              SEND
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
