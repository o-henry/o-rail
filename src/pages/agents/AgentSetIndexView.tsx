import { useEffect, useMemo, useState } from "react";
import type { AgentSetGroup, AgentSetState } from "./agentTypes";

type AgentSetIndexViewProps = {
  groupedSetOptions: AgentSetGroup[];
  setStateMap: Record<string, AgentSetState>;
  onSelectSet: (setId: string) => void;
};

function formatSetCode(setId: string): string {
  return String(setId ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toUpperCase();
}

export function AgentSetIndexView({
  groupedSetOptions,
  setStateMap,
  onSelectSet,
}: AgentSetIndexViewProps) {
  const allSetOptions = useMemo(() => groupedSetOptions.flatMap((group) => group.items), [groupedSetOptions]);
  const [previewSetId, setPreviewSetId] = useState(allSetOptions[0]?.id ?? "");

  useEffect(() => {
    if (allSetOptions.some((item) => item.id === previewSetId)) {
      return;
    }
    setPreviewSetId(allSetOptions[0]?.id ?? "");
  }, [allSetOptions, previewSetId]);

  const previewSet = useMemo(
    () => allSetOptions.find((item) => item.id === previewSetId) ?? allSetOptions[0] ?? null,
    [allSetOptions, previewSetId],
  );
  const previewInsights =
    previewSet && previewSet.id.startsWith("data-") ? setStateMap[previewSet.id]?.dashboardInsights ?? [] : [];

  return (
    <section className="agents-layout agents-set-mode workspace-tab-panel">
      <div className="agents-set-picker">
        <section className="agents-set-picker-split">
          <div className="agents-set-picker-main">
            <header className="agents-set-picker-head">
              <h2>에이전트 팀 운영 보드</h2>
              <p>역할 카드를 선택하면 해당 역할 워크스페이스가 열립니다.</p>
            </header>
            <div className="agents-set-groups">
              {groupedSetOptions.map((group) => (
                <section className="agents-set-group" key={group.id}>
                  <div className="agents-set-group-head">
                    <h3 className="agents-set-group-title">{group.title}</h3>
                  </div>
                  <div className="agents-set-list" role="list" aria-label={`${group.title} Agent sets`}>
                    {group.items.map((setOption) => {
                      return (
                        <button
                          className={`agents-set-index-row${previewSetId === setOption.id ? " is-preview-active" : ""}`}
                          key={setOption.id}
                          onClick={() => onSelectSet(setOption.id)}
                          onFocus={() => setPreviewSetId(setOption.id)}
                          onMouseEnter={() => setPreviewSetId(setOption.id)}
                          role="listitem"
                          type="button"
                        >
                          <div className="agents-set-index-meta">
                            <strong>{setOption.label}</strong>
                            <code>{setOption.description}</code>
                            <small>
                              TASK · {setStateMap[setOption.id]?.threads[0]?.id ?? "task-pending"} · 상태 ·
                              {setStateMap[setOption.id]?.dashboardInsights?.[0] ? " 완료" : " 대기"}
                            </small>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <aside className="panel-card agents-set-picker-sidebar" aria-label="Set preview">
            <header className="agents-set-picker-sidebar-head">
              <div className="agents-set-picker-sidebar-title">
                <small>미리보기</small>
                <strong>{previewSet?.label ?? "선택된 세트 없음"}</strong>
                {previewSet?.id ? <code>{formatSetCode(previewSet.id)}</code> : null}
              </div>
            </header>
            <section className="agents-sidebar-card">
              <h4>세트 미리보기</h4>
              <p className="agents-sidebar-agent-name">{previewSet?.label ?? "선택된 세트 없음"}</p>
              <p className="agents-sidebar-agent-role">{previewSet?.description ?? "역할 설명이 없습니다."}</p>
            </section>
            <section className="agents-sidebar-card">
              <h4>최근 스냅샷</h4>
              <ul className="agents-sidebar-list">
                {(previewInsights.length > 0 ? previewInsights : ["스냅샷 데이터가 없습니다."]).slice(0, 6).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
            <section className="agents-sidebar-card">
              <h4>안내</h4>
              <p>좌측에서 세트를 클릭하면 에이전트 워크스페이스로 이동합니다.</p>
            </section>
          </aside>
        </section>
      </div>
    </section>
  );
}
