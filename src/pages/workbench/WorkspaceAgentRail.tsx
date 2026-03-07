import type { WorkspaceTerminalPane } from "./workspaceTerminalTypes";

type WorkspaceAgentRailProps = {
  panes: WorkspaceTerminalPane[];
  selectedPaneId: string;
  statusLabel: (status: WorkspaceTerminalPane["status"], exitCode?: number | null) => string;
  onSelectPane: (paneId: string) => void;
  onStartPane: (paneId: string) => void;
  onStopPane: (paneId: string) => void;
};

export function WorkspaceAgentRail(props: WorkspaceAgentRailProps) {
  return (
    <aside className="workspace-runtime-rail" aria-label="에이전트 레일">
      <header className="workspace-runtime-rail-head">
        <strong>에이전트</strong>
        <span>실행 중인 역할을 고르고 중단하거나 다시 시작합니다.</span>
      </header>
      <div className="workspace-runtime-agent-list">
        {props.panes.map((pane) => (
          <button
            className={`workspace-runtime-agent${pane.id === props.selectedPaneId ? " is-selected" : ""}`}
            key={pane.id}
            onClick={() => props.onSelectPane(pane.id)}
            type="button"
          >
            <div className="workspace-runtime-agent-head">
              <strong>{pane.title}</strong>
              <span>{props.statusLabel(pane.status, pane.exitCode)}</span>
            </div>
            <p>{pane.subtitle}</p>
            <div className="workspace-runtime-agent-actions">
              <button
                className="mini-action-button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onStartPane(pane.id);
                }}
                type="button"
              >
                <span className="mini-action-button-label">시작</span>
              </button>
              <button
                className="mini-action-button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onStopPane(pane.id);
                }}
                type="button"
              >
                <span className="mini-action-button-label">중단</span>
              </button>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
