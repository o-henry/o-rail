import { useEffect, useRef } from "react";
import { TasksThreadMessageContent } from "../tasks/TasksThreadMessageContent";

export type VisualizeChartAssistantLogEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type VisualizeChartAssistantPaneProps = {
  open: boolean;
  busy: boolean;
  draft: string;
  reportBody: string;
  logs: VisualizeChartAssistantLogEntry[];
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
};

export function VisualizeChartAssistantPane(props: VisualizeChartAssistantPaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [props.logs, props.open]);

  if (!props.open) {
    return null;
  }

  return (
    <aside className="visualize-chart-assistant-pane" aria-label="Chart assistant">
      <div className="visualize-chart-assistant-scroll" ref={scrollRef}>
        <section className="visualize-chart-assistant-section">
          <div className="visualize-chart-assistant-section-head">
            <strong>RESEARCH DOCUMENT</strong>
            <span>{props.reportBody.trim() ? "loaded" : "empty"}</span>
          </div>
          <div className="visualize-chart-assistant-document">
            {props.reportBody.trim()
              ? <TasksThreadMessageContent content={props.reportBody} />
              : <p className="visualize-chart-assistant-empty">리서치 문서가 아직 없습니다.</p>}
          </div>
        </section>

        <section className="visualize-chart-assistant-section">
          <div className="visualize-chart-assistant-section-head">
            <strong>GENERATION LOG</strong>
            <span>{props.busy ? "running" : "idle"}</span>
          </div>
          <div className="visualize-chart-assistant-log">
            {props.logs.length ? (
              props.logs.map((entry) => (
                <article className={`visualize-chart-assistant-log-item is-${entry.role}`} key={entry.id}>
                  <strong>{entry.role === "user" ? "USER" : "AGENT"}</strong>
                  <p>{entry.text}</p>
                </article>
              ))
            ) : (
              <p className="visualize-chart-assistant-empty">
                우측 상단 버튼을 눌러 패널을 연 뒤, 차트 생성 요청을 입력하세요.
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="tasks-thread-composer-shell question-input agents-composer visualize-chart-assistant-composer">
        <div className="tasks-thread-composer-input-wrap">
          <textarea
            aria-label="Visualize chart request"
            className="tasks-thread-composer-input"
            onChange={(event) => props.onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                props.onSubmit();
              }
            }}
            placeholder="예: 장르별 인기 차트를 만들어줘"
            rows={1}
            value={props.draft}
          />
        </div>
        <div className="question-input-footer tasks-thread-composer-toolbar">
          <div className="agents-composer-left tasks-thread-composer-controls" />
          <button
            className="agents-send-button"
            disabled={props.busy || !props.draft.trim()}
            onClick={props.onSubmit}
            type="button"
          >
            {props.busy ? "생성 중" : "생성"}
          </button>
        </div>
      </div>
    </aside>
  );
}
