import type { WorkspaceActivityEntry } from "./workspaceTerminalTypes";

type WorkspaceActivityFeedProps = {
  entries: WorkspaceActivityEntry[];
  graphObserverText: string;
  selectedPaneId: string;
};

export function WorkspaceActivityFeed(props: WorkspaceActivityFeedProps) {
  return (
    <section className="workspace-runtime-feed" aria-label="워크스페이스 실행 피드">
      <header className="workspace-runtime-feed-head">
        <strong>런타임 피드</strong>
        <span>그래프와 에이전트 실행 중간 과정을 여기서 추적합니다.</span>
      </header>

      <article className="workspace-runtime-graph-block">
        <div className="workspace-runtime-entry-meta">
          <span>GRAPH OBSERVER</span>
        </div>
        <pre>{props.graphObserverText || "그래프 실행 로그가 아직 없습니다."}</pre>
      </article>

      <div className="workspace-runtime-entry-list">
        {props.entries.length === 0 ? (
          <p className="workspace-runtime-empty">워크스페이스 이벤트가 아직 없습니다.</p>
        ) : (
          props.entries.map((entry) => (
            <article
              className={`workspace-runtime-entry is-${entry.tone}${entry.paneId && entry.paneId === props.selectedPaneId ? " is-selected" : ""}`}
              key={entry.id}
            >
              <div className="workspace-runtime-entry-meta">
                <span>{entry.title}</span>
                <span>{entry.meta}</span>
              </div>
              <p>{entry.body}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
