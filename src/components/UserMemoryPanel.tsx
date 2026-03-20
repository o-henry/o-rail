import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeRunRecord } from "../app/mainAppRuntimeHelpers";
import type { RunRecord } from "../app/main/types";
import { useI18n } from "../i18n";
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

function localeToDateLocale(locale: string): string {
  if (locale === "en") {
    return "en-US";
  }
  if (locale === "jp") {
    return "ja-JP";
  }
  if (locale === "zh") {
    return "zh-CN";
  }
  return "ko-KR";
}

function formatMemoryTimestamp(value: string, locale: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toLocaleString(localeToDateLocale(locale), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UserMemoryPanel() {
  const { locale, t } = useI18n();
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
    setNotice(next.length > 0 ? t("memory.notice.saved") : t("memory.notice.empty"));
  };

  const onToggleAutoCapture = () => {
    const next = writeUserMemoryAutoCaptureEnabled(!autoCaptureEnabled);
    setAutoCaptureEnabled(next);
    setNotice(next ? t("memory.notice.autoOn") : t("memory.notice.autoOff"));
  };

  const onDeleteMemory = (entryId: string) => {
    setEntries(removeUserMemoryEntry(entryId));
    setNotice(t("memory.notice.deleted"));
  };

  const onClearAll = () => {
    setEntries(clearUserMemoryEntries());
    setNotice(t("memory.notice.cleared"));
  };

  return (
    <section className="controls bridge-memory-panel">
      <div className="web-automation-head">
        <h2>{t("memory.title")}</h2>
        <div className="bridge-head-actions">
          <button
            className="settings-account-button bridge-head-action-button"
            onClick={onToggleAutoCapture}
            type="button"
          >
            <span className="settings-button-label">{autoCaptureEnabled ? t("memory.toggle.on") : t("memory.toggle.off")}</span>
          </button>
          <button
            className="settings-account-button bridge-head-action-button"
            disabled={sortedEntries.length === 0}
            onClick={onClearAll}
            type="button"
          >
            <span className="settings-button-label">{t("memory.clearAll")}</span>
          </button>
        </div>
      </div>
      <div className="settings-badges">
        <span className={`status-tag ${autoCaptureEnabled ? "on" : "off"}`}>
          {autoCaptureEnabled ? t("memory.auto.on") : t("memory.auto.off")}
        </span>
        <span className="status-tag neutral">{t("memory.count", { count: sortedEntries.length })}</span>
      </div>
      <p className="bridge-provider-meta settings-memory-copy">
        {t("memory.copy")}
      </p>
      <div className="settings-memory-composer">
        <textarea
          className="settings-memory-textarea"
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={t("memory.placeholder")}
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
            <span className="settings-button-label">{t("memory.add")}</span>
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
          <div className="settings-memory-empty">{t("memory.empty")}</div>
        ) : (
          sortedEntries.map((entry) => (
            <article className="settings-memory-item" key={entry.id}>
              <div className="settings-memory-item-copy">
                <div className="settings-memory-item-meta">
                  <strong>{entry.source === "manual" ? t("memory.source.manual") : t("memory.source.auto")}</strong>
                  <small>{formatMemoryTimestamp(entry.updatedAt, locale)}</small>
                </div>
                <p>{entry.text}</p>
              </div>
              <button
                aria-label={t("memory.deleteAria", { text: entry.text })}
                className="settings-memory-item-remove"
                onClick={() => onDeleteMemory(entry.id)}
                type="button"
              >
                <img alt="" aria-hidden="true" src="/xmark-small-svgrepo-com.svg" />
              </button>
            </article>
          ))
        )}
      </div>
      {false ? (
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
                  <small>{formatMemoryTimestamp(row.updatedAt, locale)}</small>
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
      ) : null}
    </section>
  );
}
