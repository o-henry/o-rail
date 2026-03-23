import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import {
  formatSourceKindLabel,
  toFileName,
  toUpperSnakeToken,
} from "./knowledgeEntryMapping";
import { buildKnowledgeHighlightParts } from "./knowledgeSearch";

type KnowledgeBaseDetailPanelProps = {
  detailError: string;
  detailLoading: boolean;
  jsonContent: string;
  jsonReadable: { summaryRows: Array<{ key: string; value: string }>; pretty: string };
  markdownContent: string;
  onDeleteSelected: () => void;
  onInjectContextSources: (entries: KnowledgeEntry[]) => void;
  onOpenInVisualize?: (entry: KnowledgeEntry) => void;
  onRevealPath: (path: string) => Promise<void>;
  searchQuery: string;
  selected: KnowledgeEntry | null;
};

function renderHighlightedText(text: string, query: string) {
  return buildKnowledgeHighlightParts(text, query).map((part, index) => (
    part.matched
      ? <mark className="knowledge-search-highlight" key={`${index}:${part.text}`}>{part.text}</mark>
      : <span key={`${index}:${part.text}`}>{part.text}</span>
  ));
}

export function KnowledgeBaseDetailPanel(props: KnowledgeBaseDetailPanelProps) {
  const { selected } = props;
  const canOpenInVisualize = Boolean(
    selected
    && selected.runId
    && selected.roleId === "research_analyst"
    && (
      String(selected.markdownPath ?? "").includes("research_")
      || String(selected.jsonPath ?? "").includes("research_")
    ),
  );
  return (
    <section
      aria-label={selected ? `${selected.title} 상세 정보` : "데이터베이스 상세 정보"}
      className="knowledge-detail panel-card knowledge-island"
      data-e2e="knowledge-detail-panel"
    >
      {selected ? (
        <>
          <header className="knowledge-detail-head">
            <h3>{selected.title}</h3>
            <div className="knowledge-detail-actions">
              <button
                aria-label={`${selected.title} 컨텍스트로 사용`}
                data-e2e="knowledge-use-as-context"
                onClick={() => props.onInjectContextSources([selected])}
                title="컨텍스트로 사용"
                type="button"
              >
                컨텍스트로 사용
              </button>
              <button
                aria-label={`${selected.title} 삭제`}
                className="danger"
                data-e2e="knowledge-delete-selected"
                onClick={props.onDeleteSelected}
                title="삭제"
                type="button"
              >
                삭제
              </button>
              {canOpenInVisualize ? (
                <button
                  aria-label={`${selected.title} 시각화에서 보기`}
                  data-e2e="knowledge-open-visualize"
                  onClick={() => props.onOpenInVisualize?.(selected)}
                  title="시각화에서 보기"
                  type="button"
                >
                  시각화에서 보기
                </button>
              ) : null}
            </div>
          </header>
          <p>{selected.summary || "요약 없음"}</p>
          <dl className="knowledge-paths">
            <dt>AGENT</dt>
            <dd>{selected.taskAgentLabel || selected.studioRoleLabel || selected.roleId}</dd>
            <dt>ORCHESTRATOR</dt>
            <dd>{selected.orchestratorAgentLabel || "-"}</dd>
            <dt>STUDIO ROLE</dt>
            <dd>{selected.studioRoleLabel || selected.roleId}</dd>
            <dt>유형</dt>
            <dd>{formatSourceKindLabel(selected.sourceKind)}</dd>
            <dt>SOURCE</dt>
            <dd>{selected.sourceUrl || "-"}</dd>
            <dt>TASK</dt>
            <dd>{toUpperSnakeToken(selected.taskId)}</dd>
            <dt>MARKDOWN</dt>
            <dd>{toFileName(selected.markdownPath ?? "")}</dd>
            <dt>JSON</dt>
            <dd>{toFileName(selected.jsonPath ?? "")}</dd>
          </dl>
          <div className="knowledge-artifact-actions">
            <button
              aria-label={`${selected.title} MARKDOWN 열기`}
              data-e2e="knowledge-open-markdown"
              disabled={!selected.markdownPath}
              onClick={() => void props.onRevealPath(String(selected.markdownPath ?? ""))}
              title={selected.markdownPath || "MARKDOWN 열기"}
              type="button"
            >
              MARKDOWN 열기
            </button>
            <button
              aria-label={`${selected.title} JSON 열기`}
              data-e2e="knowledge-open-json"
              disabled={!selected.jsonPath}
              onClick={() => void props.onRevealPath(String(selected.jsonPath ?? ""))}
              title={selected.jsonPath || "JSON 열기"}
              type="button"
            >
              JSON 열기
            </button>
          </div>
          {props.detailError ? <p className="knowledge-detail-error">{props.detailError}</p> : null}
          {props.detailLoading ? <p className="knowledge-empty">문서를 업데이트하는 중...</p> : null}
          {props.markdownContent ? (
            <section className="knowledge-doc-block">
              <header className="knowledge-doc-head">
                <strong>문서 (Markdown)</strong>
              </header>
              <pre className="knowledge-doc-markdown">{renderHighlightedText(props.markdownContent, props.searchQuery)}</pre>
            </section>
          ) : null}
          {props.jsonContent ? (
            <section className="knowledge-doc-block">
              <header className="knowledge-doc-head">
                <strong>구조화 데이터 (JSON)</strong>
              </header>
              {props.jsonReadable.summaryRows.length > 0 ? (
                <ul className="knowledge-json-summary">
                  {props.jsonReadable.summaryRows.map((row) => (
                    <li key={`${row.key}:${row.value}`}>
                      <strong>{row.key}</strong>
                      <span>{row.value}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <pre className="knowledge-doc-pre">{renderHighlightedText(props.jsonReadable.pretty, props.searchQuery)}</pre>
            </section>
          ) : null}
        </>
      ) : (
        <p className="knowledge-empty">좌측에서 문서를 선택하세요.</p>
      )}
    </section>
  );
}
