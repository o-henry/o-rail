import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeRunRecord } from "../app/mainAppRuntimeHelpers";
import type { RunRecord } from "../app/main/types";
import {
  addUserMemoryEntry,
  clearUserMemoryEntries,
  loadUserMemoryAutoCaptureEnabled,
  readUserMemoryEntries,
  removeUserMemoryEntry,
  type UserMemoryEntry,
  writeUserMemoryAutoCaptureEnabled,
} from "../features/studio/userMemoryStore";
import { summarizeUserMemoryActivity, type UserMemoryActivityRow } from "../features/studio/userMemoryActivity";

function formatMemoryTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UserMemoryPanel() {
  const [entries, setEntries] = useState<UserMemoryEntry[]>([]);
  const [activityRows, setActivityRows] = useState<UserMemoryActivityRow[]>([]);
  const [draft, setDraft] = useState("");
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setEntries(readUserMemoryEntries());
    setAutoCaptureEnabled(loadUserMemoryAutoCaptureEnabled());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadActivity = async () => {
      try {
        const files = await invoke<string[]>("run_list");
        const recentFiles = files.slice().sort((a, b) => b.localeCompare(a)).slice(0, 10);
        const loadedRuns = await Promise.all(
          recentFiles.map(async (name) => {
            try {
              const run = await invoke<RunRecord>("run_load", { name });
              return normalizeRunRecord(run) as RunRecord;
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) {
          setActivityRows(summarizeUserMemoryActivity(loadedRuns.filter((run): run is RunRecord => run !== null)));
        }
      } catch {
        if (!cancelled) {
          setActivityRows([]);
        }
      }
    };

    void loadActivity();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries],
  );

  const onAddMemory = () => {
    const next = addUserMemoryEntry(draft, "manual");
    setEntries(next);
    setDraft("");
    setNotice(next.length > 0 ? "메모리를 저장했습니다." : "저장할 메모리가 없습니다.");
  };

  const onToggleAutoCapture = () => {
    const next = writeUserMemoryAutoCaptureEnabled(!autoCaptureEnabled);
    setAutoCaptureEnabled(next);
    setNotice(next ? "자동 기억을 켰습니다." : "자동 기억을 껐습니다.");
  };

  const onDeleteMemory = (entryId: string) => {
    setEntries(removeUserMemoryEntry(entryId));
    setNotice("메모리를 삭제했습니다.");
  };

  const onClearAll = () => {
    setEntries(clearUserMemoryEntries());
    setNotice("메모리를 모두 지웠습니다.");
  };

  return (
    <section className="controls bridge-memory-panel">
      <div className="web-automation-head">
        <h2>메모리 관리</h2>
        <div className="bridge-head-actions">
          <button
            className="settings-account-button bridge-head-action-button"
            onClick={onToggleAutoCapture}
            type="button"
          >
            <span className="settings-button-label">{autoCaptureEnabled ? "자동 기억 켜짐" : "자동 기억 꺼짐"}</span>
          </button>
          <button
            className="settings-account-button bridge-head-action-button"
            disabled={sortedEntries.length === 0}
            onClick={onClearAll}
            type="button"
          >
            <span className="settings-button-label">전체 삭제</span>
          </button>
        </div>
      </div>
      <div className="settings-badges">
        <span className={`status-tag ${autoCaptureEnabled ? "on" : "off"}`}>
          {autoCaptureEnabled ? "자동 기억 활성화" : "자동 기억 비활성화"}
        </span>
        <span className="status-tag neutral">저장된 메모리 {sortedEntries.length}개</span>
      </div>
      <p className="bridge-provider-meta settings-memory-copy">
        사용자의 장기 성향, 작업 제약, 선호도를 저장해 이후 에이전트 실행 프롬프트에 관련 있을 때만 반영합니다.
        현재 요청과 충돌하면 현재 요청이 우선됩니다.
      </p>
      <div className="settings-memory-composer">
        <textarea
          className="settings-memory-textarea"
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="예: 나는 1인 인디 게임 개발자이고, 빠른 프로토타이핑과 현실적인 제작 범위를 중요하게 생각한다."
          rows={3}
          value={draft}
        />
        <div className="button-row">
          <button
            className="settings-account-button"
            disabled={draft.trim().length === 0}
            onClick={onAddMemory}
            type="button"
          >
            <span className="settings-button-label">메모리 추가</span>
          </button>
        </div>
      </div>
      {notice ? (
        <div aria-live="polite" className="usage-method">
          {notice}
        </div>
      ) : null}
      <div className="settings-memory-list">
        {sortedEntries.length === 0 ? (
          <div className="settings-memory-empty">아직 저장된 사용자 메모리가 없습니다.</div>
        ) : (
          sortedEntries.map((entry) => (
            <article className="settings-memory-item" key={entry.id}>
              <div className="settings-memory-item-copy">
                <div className="settings-memory-item-meta">
                  <strong>{entry.source === "manual" ? "수동 메모리" : "자동 메모리"}</strong>
                  <small>{formatMemoryTimestamp(entry.updatedAt)}</small>
                </div>
                <p>{entry.text}</p>
              </div>
              <button
                aria-label={`메모리 삭제: ${entry.text}`}
                className="settings-memory-item-remove"
                onClick={() => onDeleteMemory(entry.id)}
                type="button"
              >
                ×
              </button>
            </article>
          ))
        )}
      </div>
      <section className="settings-memory-activity">
        <div className="settings-memory-activity-head">
          <strong>최근 메모리/RAG 활용</strong>
          <small>최근 실행 기준</small>
        </div>
        {activityRows.length === 0 ? (
          <div className="settings-memory-empty">최근 실행에서 기록된 RAG 활용 또는 실행 메모리가 없습니다.</div>
        ) : (
          <div className="settings-memory-activity-list">
            {activityRows.map((row) => (
              <article className="settings-memory-activity-item" key={row.key}>
                <div className="settings-memory-item-meta">
                  <strong>{row.nodeLabel}</strong>
                  <small>{formatMemoryTimestamp(row.updatedAt)}</small>
                </div>
                <p>{row.rememberedSummary || "저장된 실행 메모리 요약 없음"}</p>
                <div className="settings-memory-activity-tags">
                  <span className="status-tag neutral">run {row.runId}</span>
                  <span className={`status-tag ${row.reusedMemoryCount > 0 ? "on" : "off"}`}>
                    메모리 재사용 {row.reusedMemoryCount}건
                  </span>
                  <span className={`status-tag ${row.ragSources.length > 0 ? "on" : "off"}`}>
                    RAG {row.ragSources.length}건
                  </span>
                </div>
                {row.ragSources.length > 0 ? (
                  <div className="settings-memory-rag-list">
                    {row.ragSources.map((source) => (
                      <code key={`${row.key}:${source}`}>{source}</code>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
