import { useState } from "react";
import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import {
  formatArtifactFileNames,
  formatSourceKindLabel,
} from "./knowledgeEntryMapping";
import type { KnowledgeGroup } from "./knowledgeBaseUtils";

type KnowledgeBaseListPanelProps = {
  collapsedByGroup: Record<string, boolean>;
  entryStats: {
    total: number;
    runs: number;
    roles: number;
  };
  filteredCount: number;
  grouped: KnowledgeGroup[];
  onDeleteGroup: (runIds: string[], taskId: string, promptLabel: string) => void;
  onSelectEntry: (entryId: string) => void;
  onSearchQueryChange: (value: string) => void;
  onToggleGroup: (groupId: string) => void;
  searchQuery: string;
  selectedEntry: KnowledgeEntry | null;
};

export function KnowledgeBaseListPanel(props: KnowledgeBaseListPanelProps) {
  const [collapsedByRoleGroup, setCollapsedByRoleGroup] = useState<Record<string, boolean>>({});

  const toggleRoleGroup = (groupId: string) => {
    setCollapsedByRoleGroup((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  return (
    <section aria-label="데이터베이스 산출물 목록" className="knowledge-list panel-card knowledge-island" data-e2e="knowledge-list-panel">
      <header className="knowledge-list-head">
        <strong>산출물 탐색</strong>
        <div className="knowledge-list-stats">
          <span className="knowledge-list-stat">{`문서 ${props.entryStats.total}`}</span>
          <span className="knowledge-list-stat">{`실행 ${props.entryStats.runs}`}</span>
          <span className="knowledge-list-stat">{`역할 ${props.entryStats.roles}`}</span>
        </div>
      </header>
      <input
        aria-label="데이터베이스 문서 검색"
        className="knowledge-list-search"
        data-e2e="knowledge-search-input"
        onChange={(event) => props.onSearchQueryChange(event.currentTarget.value)}
        placeholder="문서 검색"
        type="search"
        value={props.searchQuery}
      />
      {props.filteredCount === 0 ? (
        <p className="knowledge-empty">표시할 문서가 없습니다.</p>
      ) : (
        props.grouped.map((group) => {
          const collapsed = props.collapsedByGroup[group.id] === true;
          return (
            <section key={group.id} className="knowledge-group">
              <div className="knowledge-group-head">
                <button
                  aria-label={`${group.promptLabel} 그룹 ${collapsed ? "펼치기" : "접기"}`}
                  className="knowledge-group-trigger"
                  data-e2e={`knowledge-group-${group.taskId}`}
                  onClick={() => props.onToggleGroup(group.id)}
                  title={`${group.promptLabel} · ${group.entries.length}개`}
                  type="button"
                >
                  <strong>{group.promptLabel}</strong>
                  <span className="knowledge-group-count">
                    <img
                      alt=""
                      aria-hidden="true"
                      className={`knowledge-group-arrow${collapsed ? " is-collapsed" : ""}`}
                      src="/down-arrow2.svg"
                    />
                    <span className="knowledge-group-count-copy">
                      <span className="knowledge-group-count-value">{`${group.roleGroups.length}명`}</span>
                      <span aria-hidden="true" className="knowledge-group-count-dot">·</span>
                      <span className="knowledge-group-count-value">{`${group.entries.length}개`}</span>
                    </span>
                  </span>
                </button>
                <button
                  aria-label={`${group.taskId} 그룹 삭제`}
                  className="knowledge-group-delete"
                  data-e2e={`knowledge-delete-group-${group.taskId}`}
                  onClick={() => props.onDeleteGroup(group.runIds, group.taskId, group.promptLabel)}
                  type="button"
                >
                  그룹 삭제
                </button>
              </div>
              {!collapsed ? (
                <div className="knowledge-group-items">
                  {group.roleGroups.map((roleGroup) => {
                    const roleCollapsed = collapsedByRoleGroup[roleGroup.id] === true;
                    const hasSelectedEntry = roleGroup.entries.some((entry) => entry.id === props.selectedEntry?.id);
                    return (
                      <section
                        className={`knowledge-role-tree${hasSelectedEntry ? " is-selected" : ""}`}
                        key={roleGroup.id}
                      >
                        <div className="knowledge-role-head">
                          <button
                            aria-label={`${roleGroup.label} ${roleCollapsed ? "펼치기" : "접기"}`}
                            className="knowledge-role-toggle"
                            onClick={() => toggleRoleGroup(roleGroup.id)}
                            type="button"
                          >
                            <img
                              alt=""
                              aria-hidden="true"
                              className={roleCollapsed ? "" : "is-expanded"}
                              src="/down-arrow2.svg"
                            />
                          </button>
                          <button
                            aria-label={`${roleGroup.label} 문서 목록 ${roleCollapsed ? "펼치기" : "접기"}`}
                            className={`knowledge-role-trigger${hasSelectedEntry ? " is-selected" : ""}`}
                            onClick={() => toggleRoleGroup(roleGroup.id)}
                            title={`${roleGroup.label} · ${roleGroup.entries.length}개`}
                            type="button"
                          >
                            <div className="knowledge-role-copy">
                              <strong>{roleGroup.label}</strong>
                              <span>{roleGroup.detail}</span>
                              <small>{`${roleGroup.entries.length}개 문서`}</small>
                            </div>
                          </button>
                        </div>
                        {!roleCollapsed ? (
                          <div className="knowledge-role-items">
                            {roleGroup.entries.map((entry) => {
                              const artifactName = formatArtifactFileNames(entry);
                              const displayTitle = artifactName !== "-" ? artifactName : entry.title;
                              return (
                                <button
                                  aria-label={`${displayTitle} 문서 선택`}
                                  key={entry.id}
                                  className={`knowledge-row${props.selectedEntry?.id === entry.id ? " is-selected" : ""}`}
                                  data-e2e={`knowledge-entry-${entry.id}`}
                                  onClick={() => props.onSelectEntry(entry.id)}
                                  title={`${entry.title} · ${formatSourceKindLabel(entry.sourceKind)}`}
                                  type="button"
                                >
                                  <strong>{displayTitle}</strong>
                                  <span>{entry.title}</span>
                                  <small>{new Date(entry.createdAt).toLocaleString()}</small>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </section>
  );
}
