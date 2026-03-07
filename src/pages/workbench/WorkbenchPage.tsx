import type { GraphNode } from "../../features/workflow/types";
import { WorkspaceActivityFeed } from "./WorkspaceActivityFeed";
import { WorkspaceAgentRail } from "./WorkspaceAgentRail";
import { useWorkspaceTerminalGrid } from "./useWorkspaceTerminalGrid";
import type { WorkbenchNodeState, WorkbenchWorkspaceEvent } from "./workbenchRuntimeTypes";

type WorkbenchPageProps = {
  cwd: string;
  graphFileName: string;
  graphNodes: GraphNode[];
  nodeStates: Record<string, WorkbenchNodeState>;
  workspaceEvents: WorkbenchWorkspaceEvent[];
};

export default function WorkbenchPage(props: WorkbenchPageProps) {
  const runtime = useWorkspaceTerminalGrid({
    cwd: props.cwd,
    graphFileName: props.graphFileName,
    graphNodes: props.graphNodes,
    nodeStates: props.nodeStates,
    workspaceEvents: props.workspaceEvents,
  });

  const selectedPane = runtime.panes.find((pane) => pane.id === runtime.selectedPaneId) ?? runtime.panes[0] ?? null;

  return (
    <section className="workspace-runtime-shell workspace-tab-panel">
      <div className="workspace-runtime-backdrop" />
      <header className="workspace-runtime-header">
        <div className="workspace-runtime-title">
          <strong>워크스페이스</strong>
          <p>그래프 실행과 역할 에이전트 런타임을 같은 화면에서 추적하고 개입합니다.</p>
        </div>
        <div className="workspace-runtime-header-actions">
          <button className="mini-action-button" onClick={runtime.startAllPanes} type="button">
            <span className="mini-action-button-label">모든 에이전트 시작</span>
          </button>
          <button className="mini-action-button" onClick={runtime.stopAllPanes} type="button">
            <span className="mini-action-button-label">모든 에이전트 중단</span>
          </button>
        </div>
      </header>

      <div className="workspace-runtime-layout">
        <WorkspaceActivityFeed
          entries={runtime.activityEntries}
          graphObserverText={runtime.graphObserverText}
          selectedPaneId={runtime.selectedPaneId}
        />

        <WorkspaceAgentRail
          onSelectPane={runtime.setSelectedPaneId}
          onStartPane={runtime.startPane}
          onStopPane={runtime.stopPane}
          panes={runtime.panes}
          selectedPaneId={runtime.selectedPaneId}
          statusLabel={runtime.statusMessage}
        />
      </div>

      <footer className="workspace-runtime-composer">
        <div className="workspace-runtime-composer-copy">
          <strong>{selectedPane?.title ?? "에이전트 선택"}</strong>
          <span>{selectedPane?.subtitle ?? "우측 레일에서 대상 에이전트를 선택하세요."}</span>
        </div>
        <div className="workspace-runtime-composer-row">
          <input
            className="workflow-handoff-task-input"
            onChange={(event) => {
              if (selectedPane) {
                runtime.setPaneInput(selectedPane.id, event.currentTarget.value);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && selectedPane) {
                event.preventDefault();
                runtime.sendPaneInput(selectedPane.id);
              }
            }}
            placeholder="요구사항을 수정하거나 추가 지시를 입력하세요."
            value={selectedPane?.input ?? ""}
          />
          <button
            className="mini-action-button"
            disabled={!selectedPane}
            onClick={() => {
              if (selectedPane) {
                runtime.sendPaneInput(selectedPane.id);
              }
            }}
            type="button"
          >
            <span className="mini-action-button-label">추가 요구 전송</span>
          </button>
        </div>
      </footer>
    </section>
  );
}
