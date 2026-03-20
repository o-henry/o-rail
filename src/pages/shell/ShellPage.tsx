import { type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { TaskTerminalViewport } from "../tasks/TaskTerminalViewport";
import { useTasksThreadState } from "../tasks/useTasksThreadState";
import { useI18n } from "../../i18n";
import { useShellTerminalGrid } from "./useShellTerminalGrid";
import {
  defaultShellAddDirection,
  type ShellSplitDirection,
  type ShellTerminalLayoutNode,
} from "./shellTerminalLayout";

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

function resolveDropDirection(event: DragEvent<HTMLElement>): ShellSplitDirection {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
  const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
  const dx = Math.abs(x - 0.5);
  const dy = Math.abs(y - 0.5);
  if (dx >= dy) {
    return x < 0.5 ? "left" : "right";
  }
  return y < 0.5 ? "top" : "bottom";
}

export default function ShellPage(props: ShellPageProps) {
  const { t } = useI18n();
  const state = useTasksThreadState(props);
  const [displayThread, setDisplayThread] = useState(state.activeThread);
  const [initialThreadResolved, setInitialThreadResolved] = useState(Boolean(state.activeThread));
  useEffect(() => {
    if (state.activeThread) {
      setDisplayThread(state.activeThread);
      return;
    }
    if (!state.loading) {
      setDisplayThread(null);
    }
  }, [state.activeThread, state.loading]);
  useEffect(() => {
    if (!state.loading) {
      setInitialThreadResolved(true);
    }
  }, [state.loading]);
  const shellGrid = useShellTerminalGrid({
    thread: displayThread,
    hasTauriRuntime: props.hasTauriRuntime,
    invokeFn: props.invokeFn,
  });
  const [addDragSourcePaneId, setAddDragSourcePaneId] = useState("");
  const [dropTarget, setDropTarget] = useState<{ paneId: string; direction: ShellSplitDirection } | null>(null);
  const [fullscreenPaneId, setFullscreenPaneId] = useState("");

  const paneById = useMemo(
    () => Object.fromEntries(shellGrid.panes.map((pane) => [pane.id, pane])),
    [shellGrid.panes],
  );
  const fullscreenPane = fullscreenPaneId ? paneById[fullscreenPaneId] : undefined;

  useEffect(() => {
    if (fullscreenPaneId && !fullscreenPane) {
      setFullscreenPaneId("");
    }
  }, [fullscreenPane, fullscreenPaneId]);

  const renderPaneCard = (paneId: string, fullscreen = false) => {
    const pane = paneById[paneId];
    if (!pane) {
      return null;
    }
    const isDropTarget = !fullscreen && dropTarget?.paneId === pane.id ? `is-drop-${dropTarget.direction}` : "";
    return (
      <article
        className={`shell-terminal-card panel-card${shellGrid.selectedPaneId === pane.id ? " is-selected" : ""}${fullscreen ? " is-fullscreen" : ""} ${isDropTarget}`.trim()}
        key={pane.id}
        onClick={() => shellGrid.setSelectedPaneId(pane.id)}
        onDragLeave={() => {
          if (fullscreen) {
            return;
          }
          setDropTarget((current) => (current?.paneId === pane.id ? null : current));
        }}
        onDragOver={(event) => {
          if (fullscreen || !addDragSourcePaneId) {
            return;
          }
          event.preventDefault();
          setDropTarget({
            paneId: pane.id,
            direction: resolveDropDirection(event),
          });
        }}
        onDrop={(event) => {
          if (fullscreen || !addDragSourcePaneId) {
            return;
          }
          event.preventDefault();
          const direction = resolveDropDirection(event);
          setDropTarget(null);
          setAddDragSourcePaneId("");
          void shellGrid.addPane(pane.id, direction);
        }}
      >
        <header className="shell-terminal-card-head">
          <div className="shell-terminal-card-copy">
            <input
              aria-label={`${pane.title} title`}
              className="shell-terminal-title-input"
              onClick={(event) => {
                event.stopPropagation();
              }}
              onChange={(event) => {
                shellGrid.renamePane(pane.id, event.currentTarget.value);
              }}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              type="text"
              value={pane.title}
            />
          </div>
          <div className="shell-terminal-card-actions">
            <span>{displayTerminalStatus(pane.status, pane.exitCode)}</span>
            <button
              aria-label={fullscreen ? "exit fullscreen" : "enter fullscreen"}
              className="shell-terminal-icon-button"
              onClick={(event) => {
                event.stopPropagation();
                setFullscreenPaneId((current) => (current === pane.id ? "" : pane.id));
              }}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/canvas-fullscreen.svg" />
            </button>
            <button
              aria-label="stop terminal"
              className="shell-terminal-icon-button"
              onClick={(event) => {
                event.stopPropagation();
                void shellGrid.interruptPane(pane.id);
              }}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/canvas-stop.svg" />
            </button>
            <button
              aria-label="clear terminal"
              className="shell-terminal-icon-button"
              onClick={(event) => {
                event.stopPropagation();
                shellGrid.clearPane(pane.id);
              }}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/reload.svg" />
            </button>
            <button
              aria-label="close terminal"
              className="shell-terminal-icon-button"
              disabled={shellGrid.panes.length <= 1}
              onClick={(event) => {
                event.stopPropagation();
                if (shellGrid.panes.length <= 1) {
                  return;
                }
                if (fullscreenPaneId === pane.id) {
                  setFullscreenPaneId("");
                }
                void shellGrid.closePane(pane.id);
              }}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/xmark.svg" />
            </button>
            {!fullscreen ? (
              <button
                aria-label="add terminal"
                className="shell-terminal-icon-button"
                draggable
                onClick={(event) => {
                  event.stopPropagation();
                  void shellGrid.addPane(pane.id, defaultShellAddDirection(shellGrid.panes.length));
                }}
                onDragEnd={() => {
                  setAddDragSourcePaneId("");
                  setDropTarget(null);
                }}
                onDragStart={(event) => {
                  event.stopPropagation();
                  setAddDragSourcePaneId(pane.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                type="button"
              >
                <img alt="" aria-hidden="true" src="/plus-large-svgrepo-com.svg" />
              </button>
            ) : null}
          </div>
        </header>
        <TaskTerminalViewport
          onTerminalData={(chars) => shellGrid.sendChars(pane.id, chars)}
          onTerminalResize={(cols, rows) => shellGrid.resizePane(pane.id, cols, rows)}
          sessionId={pane.id}
          selected={shellGrid.selectedPaneId === pane.id || fullscreen}
          theme="dark"
        />
        {!fullscreen && dropTarget?.paneId === pane.id ? <div className={`shell-terminal-drop-preview is-${dropTarget.direction}`} /> : null}
      </article>
    );
  };

  const renderLayoutNode = (node: ShellTerminalLayoutNode | null): ReactNode => {
    if (!node) {
      return null;
    }
    if (node.kind === "leaf") {
      return renderPaneCard(node.paneId);
    }

    return (
      <div
        className={`shell-terminal-split is-${node.orientation}`}
        key={node.id}
        style={
          node.orientation === "horizontal"
            ? { gridTemplateColumns: `minmax(0, ${node.ratio}fr) 1px minmax(0, ${1 - node.ratio}fr)` }
            : { gridTemplateRows: `minmax(0, ${node.ratio}fr) 1px minmax(0, ${1 - node.ratio}fr)` }
        }
      >
        {renderLayoutNode(node.first)}
        <div
          className={`shell-terminal-resizer is-${node.orientation}`}
          onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const container = event.currentTarget.parentElement;
            if (!container) {
              return;
            }
            const rect = container.getBoundingClientRect();
            const onMove = (moveEvent: MouseEvent) => {
              const nextRatio = node.orientation === "horizontal"
                ? (moveEvent.clientX - rect.left) / Math.max(rect.width, 1)
                : (moveEvent.clientY - rect.top) / Math.max(rect.height, 1);
              shellGrid.setSplitRatio(node.id, nextRatio);
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        />
        {renderLayoutNode(node.second)}
      </div>
    );
  };

  return (
    <section className="shell-layout workspace-tab-panel">
      <section className="shell-main-surface">
        <div className="shell-board">
          {!initialThreadResolved && !displayThread ? (
            <div className="shell-loading-surface" aria-hidden="true" />
          ) : !displayThread ? (
            <section className="shell-empty-state panel-card">
              <strong>{t("shell.empty.selectThread.title")}</strong>
              <p>{t("shell.empty.selectThread.body")}</p>
              <div className="shell-empty-actions">
                <button className="tasks-thread-new-button" onClick={() => void state.openNewThread()} type="button">
                  {t("tasks.thread.new")}
                </button>
                <button className="tasks-thread-new-button" onClick={() => void state.openProjectDirectory()} type="button">
                  {t("shell.empty.openProject")}
                </button>
              </div>
            </section>
          ) : shellGrid.isUnsupported ? (
            <section className="shell-empty-state panel-card">
              <strong>{t("shell.empty.desktopOnly.title")}</strong>
              <p>{t("shell.empty.desktopOnly.body")}</p>
            </section>
          ) : (
            <div className="shell-terminal-grid">
              {!fullscreenPaneId ? renderLayoutNode(shellGrid.layout) : null}
            </div>
          )}
        </div>
      </section>
      {fullscreenPane ? (
        <div className="shell-fullscreen-overlay">
          {renderPaneCard(fullscreenPane.id, true)}
        </div>
      ) : null}
    </section>
  );
}
