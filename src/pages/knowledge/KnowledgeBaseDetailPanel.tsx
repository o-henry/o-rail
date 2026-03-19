import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import {
  formatSourceKindLabel,
  toFileName,
  toUpperSnakeToken,
} from "./knowledgeEntryMapping";

type KnowledgeBaseDetailPanelProps = {
  detailError: string;
  detailLoading: boolean;
  jsonContent: string;
  jsonReadable: { summaryRows: Array<{ key: string; value: string }>; pretty: string };
  markdownContent: string;
  onDeleteSelected: () => void;
  onInjectContextSources: (entries: KnowledgeEntry[]) => void;
  onRevealPath: (path: string) => Promise<void>;
  selected: KnowledgeEntry | null;
};

export function KnowledgeBaseDetailPanel(props: KnowledgeBaseDetailPanelProps) {
  const { selected } = props;
  return (
    <section className="knowledge-detail panel-card knowledge-island">
      {selected ? (
        <>
          <header className="knowledge-detail-head">
            <h3>{selected.title}</h3>
            <div className="knowledge-detail-actions">
              <button type="button" onClick={() => props.onInjectContextSources([selected])}>
                컨텍스트로 사용
              </button>
              <button type="button" className="danger" onClick={props.onDeleteSelected}>
                삭제
              </button>
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
              disabled={!selected.markdownPath}
              onClick={() => void props.onRevealPath(String(selected.markdownPath ?? ""))}
              type="button"
            >
              MARKDOWN 열기
            </button>
            <button
              disabled={!selected.jsonPath}
              onClick={() => void props.onRevealPath(String(selected.jsonPath ?? ""))}
              type="button"
            >
              JSON 열기
            </button>
          </div>
          {props.detailError ? <p className="knowledge-detail-error">{props.detailError}</p> : null}
          {props.detailLoading ? <p className="knowledge-empty">문서를 불러오는 중...</p> : null}
          {!props.detailLoading && props.markdownContent ? (
            <section className="knowledge-doc-block">
              <header className="knowledge-doc-head">
                <strong>문서 (Markdown)</strong>
              </header>
              <pre className="knowledge-doc-markdown">{props.markdownContent}</pre>
            </section>
          ) : null}
          {!props.detailLoading && props.jsonContent ? (
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
              <pre className="knowledge-doc-pre">{props.jsonReadable.pretty}</pre>
            </section>
          ) : null}
        </>
      ) : (
        <p className="knowledge-empty">좌측에서 문서를 선택하세요.</p>
      )}
    </section>
  );
}
