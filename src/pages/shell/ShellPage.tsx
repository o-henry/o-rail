import { useMemo } from "react";
import { TaskTerminalViewport } from "../tasks/TaskTerminalViewport";
import { useTasksThreadState } from "../tasks/useTasksThreadState";
import { useShellTerminalGrid } from "./useShellTerminalGrid";

type ShellPageProps = {
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
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

function displayTerminalStatus(input: string | null | undefined, exitCode?: number | null) {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (normalized === "running") return "RUNNING";
  if (normalized === "starting") return "STARTING";
  if (normalized === "stopped") return "STOPPED";
  if (normalized === "error") return "ERROR";
  if (normalized === "exited") return `EXITED${typeof exitCode === "number" ? ` (${exitCode})` : ""}`;
  return "IDLE";
}

export default function ShellPage(props: ShellPageProps) {
  const state = useTasksThreadState(props);
  const shellGrid = useShellTerminalGrid({
    thread: state.activeThread,
    hasTauriRuntime: props.hasTauriRuntime,
    invokeFn: props.invokeFn,
  });

  const shellGridClassName = useMemo(() => {
    if (shellGrid.panes.length <= 1) {
      return "shell-terminal-grid is-single";
    }
    return "shell-terminal-grid is-multi";
  }, [shellGrid.panes.length]);

  return (
    <section className="shell-layout workspace-tab-panel">
      <section className="shell-main-surface">
        <div className="shell-board">
          {state.activeThread && !shellGrid.isUnsupported ? (
            <button
              className="shell-add-button"
              onClick={() => void shellGrid.addPane()}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/plus-large-svgrepo-com.svg" />
            </button>
          ) : null}

          {!state.activeThread ? (
            <section className="shell-empty-state panel-card">
              <strong>스레드를 먼저 선택하세요</strong>
              <p>터미널은 현재 활성 thread의 worktree에 귀속됩니다.</p>
              <div className="shell-empty-actions">
                <button className="tasks-thread-new-button" onClick={() => void state.openNewThread()} type="button">
                  NEW THREAD
                </button>
                <button className="tasks-thread-new-button" onClick={() => void state.openProjectDirectory()} type="button">
                  프로젝트 열기
                </button>
              </div>
            </section>
          ) : shellGrid.isUnsupported ? (
            <section className="shell-empty-state panel-card">
              <strong>터미널은 Tauri 앱에서만 열 수 있습니다</strong>
              <p>브라우저 미리보기에서는 terminal session이 비활성입니다.</p>
            </section>
          ) : shellGrid.panes.length === 0 ? (
            <section className="shell-empty-state panel-card">
              <strong>{state.activeThread.thread.title || "NEW THREAD"}</strong>
              <p>{shellGrid.cwd || state.projectPath || props.cwd}</p>
            </section>
          ) : (
            <div className={shellGridClassName}>
              {shellGrid.panes.map((pane) => (
                <article
                  className={`shell-terminal-card panel-card${shellGrid.selectedPaneId === pane.id ? " is-selected" : ""}`}
                  draggable
                  key={pane.id}
                  onClick={() => shellGrid.setSelectedPaneId(pane.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDragStart={() => shellGrid.setDraggedPaneId(pane.id)}
                  onDrop={(event) => {
                    event.preventDefault();
                    shellGrid.reorderPanes(pane.id);
                  }}
                >
                  <header className="shell-terminal-card-head">
                    <div className="shell-terminal-card-copy">
                      <strong>{pane.title}</strong>
                    </div>
                    <div className="shell-terminal-card-actions">
                      <span>{displayTerminalStatus(pane.status, pane.exitCode)}</span>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void shellGrid.interruptPane(pane.id);
                        }}
                        type="button"
                      >
                        STOP
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          shellGrid.clearPane(pane.id);
                        }}
                        type="button"
                      >
                        CLEAR
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void shellGrid.closePane(pane.id);
                        }}
                        type="button"
                      >
                        CLOSE
                      </button>
                    </div>
                  </header>
                  <TaskTerminalViewport
                    onTerminalData={(chars) => shellGrid.sendChars(pane.id, chars)}
                    pane={pane}
                    selected={shellGrid.selectedPaneId === pane.id}
                  />
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
