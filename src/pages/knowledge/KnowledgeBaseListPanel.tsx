import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import {
  formatArtifactFileNames,
  formatSourceKindLabel,
} from "./knowledgeEntryMapping";
import type { KnowledgeGroup } from "./knowledgeBaseUtils";

type KnowledgeBaseListPanelProps = {
  collapsedByGroup: Record<string, boolean>;
  filteredCount: number;
  grouped: KnowledgeGroup[];
  onDeleteGroup: (runId: string, taskId: string) => void;
  onSelectEntry: (entryId: string) => void;
  onToggleGroup: (groupId: string) => void;
  selectedEntry: KnowledgeEntry | null;
};

export function KnowledgeBaseListPanel(props: KnowledgeBaseListPanelProps) {
  return (
    <section aria-label="데이터베이스 산출물 목록" className="knowledge-list panel-card knowledge-island" data-e2e="knowledge-list-panel">
      <header className="knowledge-list-head">
        <strong>산출물 탐색</strong>
        <span>{`표시 ${props.filteredCount}개`}</span>
      </header>
      {props.filteredCount === 0 ? (
        <p className="knowledge-empty">표시할 문서가 없습니다.</p>
      ) : (
        props.grouped.map((group) => {
          const collapsed = props.collapsedByGroup[group.id] === true;
          return (
            <section key={group.id} className="knowledge-group">
              <div className="knowledge-group-head">
                <button
                  aria-label={`${group.taskId} 그룹 ${collapsed ? "펼치기" : "접기"}`}
                  className="knowledge-group-trigger"
                  data-e2e={`knowledge-group-${group.taskId}`}
                  onClick={() => props.onToggleGroup(group.id)}
                  title={`${group.taskId} · ${group.entries.length}개`}
                  type="button"
                >
                  <strong>{group.taskId}</strong>
                  <span className="knowledge-group-count">
                    <img
                      alt=""
                      aria-hidden="true"
                      className={`knowledge-group-arrow${collapsed ? " is-collapsed" : ""}`}
                      src="/down-arrow2.svg"
                    />
                    <span>{`${group.entries.length}개`}</span>
                  </span>
                </button>
                <button
                  aria-label={`${group.taskId} 그룹 삭제`}
                  className="knowledge-group-delete"
                  data-e2e={`knowledge-delete-group-${group.taskId}`}
                  onClick={() => props.onDeleteGroup(group.runId, group.taskId)}
                  type="button"
                >
                  그룹 삭제
                </button>
              </div>
              {!collapsed ? (
                <div className="knowledge-group-items">
                  {group.entries.map((entry) => (
                    <button
                      aria-label={`${entry.title} 문서 선택`}
                      key={entry.id}
                      className={`knowledge-row${props.selectedEntry?.id === entry.id ? " is-selected" : ""}`}
                      data-e2e={`knowledge-entry-${entry.id}`}
                      onClick={() => props.onSelectEntry(entry.id)}
                      title={`${entry.title} · ${entry.taskAgentLabel || entry.studioRoleLabel || entry.roleId}`}
                      type="button"
                    >
                      <strong>{entry.title}</strong>
                      <span>
                        {entry.taskAgentLabel || entry.studioRoleLabel || entry.roleId}
                        {entry.orchestratorAgentLabel ? ` · 총괄 ${entry.orchestratorAgentLabel}` : ""}
                      </span>
                      <span>{`${formatSourceKindLabel(entry.sourceKind)} · ${formatArtifactFileNames(entry)}`}</span>
                      <small>{new Date(entry.createdAt).toLocaleString()}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </section>
  );
}
