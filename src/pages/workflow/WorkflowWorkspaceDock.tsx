import { useEffect, useMemo, useState } from "react";
import type { GraphNode } from "../../features/workflow/types";
import { useWorkflowWorkspaceTerminalGrid } from "./useWorkflowWorkspaceTerminalGrid";
import type { WorkflowWorkspaceNodeState, WorkflowWorkspaceEvent } from "./workflowWorkspaceRuntimeTypes";
import { buildWorkspacePaneViewport, tailGraphObserverLines } from "./workspaceDockState";

type WorkflowWorkspaceDockProps = {
  activeRoleId: string;
  cwd: string;
  graphFileName: string;
  graphNodes: GraphNode[];
  nodeStates: Record<string, WorkflowWorkspaceNodeState>;
  workspaceEvents: WorkflowWorkspaceEvent[];
};

export default function WorkflowWorkspaceDock(props: WorkflowWorkspaceDockProps) {
  const runtime = useWorkflowWorkspaceTerminalGrid({
    cwd: props.cwd,
    graphFileName: props.graphFileName,
    graphNodes: props.graphNodes,
    nodeStates: props.nodeStates,
    workspaceEvents: props.workspaceEvents,
  });
  const [expanded, setExpanded] = useState(true);
  const traceLines = useMemo(() => tailGraphObserverLines(runtime.graphObserverText, 4), [runtime.graphObserverText]);
  const { selectPaneByRoleId } = runtime;

  useEffect(() => {
    selectPaneByRoleId(props.activeRoleId);
  }, [props.activeRoleId, selectPaneByRoleId]);

  return (
    <section className={`workflow-workspace-dock${expanded ? " is-expanded" : " is-collapsed"}`} aria-label="워크스페이스">
      <header className="workflow-workspace-dock-head">
        <div className="workflow-workspace-dock-title">
          <strong>워크스페이스</strong>
          <span>그래프 실행과 연결된 Codex 세션을 여기서 추적하고 바로 개입합니다.</span>
        </div>
        <div className="workflow-workspace-dock-actions">
          <button className="mini-action-button" onClick={runtime.startAllPanes} type="button">
            <span className="mini-action-button-label">모두 시작</span>
          </button>
          <button className="mini-action-button" onClick={runtime.stopAllPanes} type="button">
            <span className="mini-action-button-label">모두 중단</span>
          </button>
          <button className="mini-action-button" onClick={() => setExpanded((current) => !current)} type="button">
            <span className="mini-action-button-label">{expanded ? "접기" : "열기"}</span>
          </button>
        </div>
      </header>

      <div className="workflow-workspace-trace">
        <span className="workflow-workspace-trace-label">GRAPH TRACE</span>
        <div className="workflow-workspace-trace-lines">
          {(traceLines.length > 0 ? traceLines : ["그래프 실행 로그가 아직 없습니다."]).map((line, index) => (
            <span key={`${line}-${index}`}>{line}</span>
          ))}
        </div>
      </div>

      {expanded && (
        <div className="workflow-workspace-grid">
          {runtime.panes.map((pane) => {
            const viewportText = buildWorkspacePaneViewport({
              pane,
              activityEntries: runtime.activityEntries,
            });
            const selected = pane.id === runtime.selectedPaneId;
            return (
              <section
                className={`workflow-workspace-pane${selected ? " is-selected" : ""}`}
                key={pane.id}
                onClick={() => runtime.setSelectedPaneId(pane.id)}
              >
                <div className="workflow-workspace-pane-topbar">
                  <span className="workflow-workspace-pane-chip">~</span>
                  <span className="workflow-workspace-pane-role">{pane.title}</span>
                  <span className="workflow-workspace-pane-status">{runtime.statusMessage(pane.status, pane.exitCode)}</span>
                </div>
                <div className="workflow-workspace-pane-path">~/{props.cwd ? props.cwd.split("/").slice(-2).join("/") : "workspace"}</div>
                <pre className="workflow-workspace-pane-body">{viewportText}</pre>
                <div className="workflow-workspace-pane-actions">
                  <button
                    className="mini-action-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void runtime.startPane(pane.id);
                    }}
                    type="button"
                  >
                    <span className="mini-action-button-label">시작</span>
                  </button>
                  <button
                    className="mini-action-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void runtime.stopPane(pane.id);
                    }}
                    type="button"
                  >
                    <span className="mini-action-button-label">중단</span>
                  </button>
                  <button
                    className="mini-action-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      runtime.clearPane(pane.id);
                    }}
                    type="button"
                  >
                    <span className="mini-action-button-label">비우기</span>
                  </button>
                </div>
                <div className="workflow-workspace-pane-composer">
                  <input
                    className="workflow-workspace-pane-input"
                    onChange={(event) => runtime.setPaneInput(pane.id, event.currentTarget.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void runtime.sendPaneInput(pane.id);
                      }
                    }}
                    placeholder="추가 요구사항 또는 수정 지시"
                    value={pane.input}
                  />
                  <button
                    className="mini-action-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void runtime.sendPaneInput(pane.id);
                    }}
                    type="button"
                  >
                    <span className="mini-action-button-label">전송</span>
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
