import { useEffect, useMemo, useState } from "react";
import {
  persistKnowledgeIndexToWorkspace,
  readKnowledgeEntries,
  removeKnowledgeEntry,
  upsertKnowledgeEntry,
} from "../../features/studio/knowledgeIndex";
import type { KnowledgeEntry, KnowledgeSourcePost } from "../../features/studio/knowledgeTypes";
import { invoke, revealItemInDir } from "../../shared/tauri";

type KnowledgeBasePageProps = {
  cwd: string;
  posts: KnowledgeSourcePost[];
  onInjectContextSources: (entries: KnowledgeEntry[]) => void;
};

type KnowledgeGroup = {
  taskId: string;
  entries: KnowledgeEntry[];
};

const HIDDEN_MARKET_TOPICS = new Set([
  "MARKET_SUMMARY",
  "GLOBAL_HEADLINES",
  "TREND_RADAR",
  "COMMUNITY_HOT_TOPICS",
  "DEV_COMMUNITY_HOT_TOPICS",
  "EVENT_CALENDAR",
  "RISK_ALERT_BOARD",
  "DEV_ECOSYSTEM_UPDATES",
  "PAPER_TOPICS",
]);

function toUpperSnakeToken(raw: string): string {
  const base = String(raw ?? "").trim();
  if (!base) {
    return "TASK_UNKNOWN";
  }
  const snake = base
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return snake || "TASK_UNKNOWN";
}

function isHiddenKnowledgeEntry(entry: Pick<KnowledgeEntry, "runId" | "taskId">): boolean {
  const runId = String(entry.runId ?? "").trim();
  const taskId = toUpperSnakeToken(String(entry.taskId ?? ""));
  const raw = `${runId} ${taskId}`.toUpperCase();
  if (runId.startsWith("topic-") || HIDDEN_MARKET_TOPICS.has(taskId)) {
    return true;
  }
  return /GLOBAL_HEADLINES|MARKET_SUMMARY|TREND_RADAR|COMMUNITY_HOT_TOPICS|EVENT_CALENDAR|RISK_ALERT_BOARD|DEV_ECOSYSTEM_UPDATES/.test(raw);
}

function findAttachmentPath(post: KnowledgeSourcePost, kind: string): string | undefined {
  const match = post.attachments.find((row) => row.kind === kind);
  const path = String(match?.filePath ?? "").trim();
  return path || undefined;
}

function formatArtifactFileNames(entry: Pick<KnowledgeEntry, "markdownPath" | "jsonPath">): string {
  const names = [entry.markdownPath, entry.jsonPath]
    .map((path) => String(path ?? "").trim())
    .filter(Boolean)
    .map((path) => toFileName(path));
  if (names.length === 0) {
    return "-";
  }
  return names.join(" · ");
}

export function toKnowledgeEntry(post: KnowledgeSourcePost): KnowledgeEntry | null {
  const runId = String(post.runId ?? "").trim();
  const taskId = toUpperSnakeToken(String(post.topicLabel ?? post.topic ?? "TASK_UNKNOWN"));
  if (isHiddenKnowledgeEntry({ runId, taskId })) {
    return null;
  }
  return {
    id: post.id,
    runId,
    taskId,
    roleId: "technical_writer",
    sourceKind: "artifact",
    title: String(post.summary ?? "").slice(0, 72) || post.agentName,
    summary: String(post.summary ?? ""),
    createdAt: post.createdAt,
    markdownPath: findAttachmentPath(post, "markdown"),
    jsonPath: findAttachmentPath(post, "json"),
  };
}

function formatSourceKindLabel(kind: KnowledgeEntry["sourceKind"]): string {
  if (kind === "artifact") {
    return "산출물";
  }
  if (kind === "ai") {
    return "AI 자료";
  }
  return "WEB 자료";
}

function toFileName(path: string): string {
  const normalized = String(path ?? "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}

function summarizeJsonValue(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "-";
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) {
      return "(빈 문자열)";
    }
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  if (Array.isArray(raw)) {
    return `배열 ${raw.length}개`;
  }
  if (typeof raw === "object") {
    const keys = Object.keys(raw as Record<string, unknown>);
    return keys.length > 0 ? `객체 (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", ..." : ""})` : "객체 (빈 값)";
  }
  return String(raw);
}

function toReadableJsonInfo(text: string): { summaryRows: Array<{ key: string; value: string }>; pretty: string } {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { summaryRows: [], pretty: "" };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        summaryRows: [{ key: "VALUE", value: summarizeJsonValue(parsed) }],
        pretty: JSON.stringify(parsed, null, 2),
      };
    }
    const object = parsed as Record<string, unknown>;
    const summaryRows = Object.entries(object).map(([key, value]) => ({
      key: key.toUpperCase(),
      value: summarizeJsonValue(value),
    }));
    return {
      summaryRows,
      pretty: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return {
      summaryRows: [{ key: "RAW", value: "JSON 파싱 실패 (원문 표시)" }],
      pretty: trimmed,
    };
  }
}

export default function KnowledgeBasePage({ cwd, posts, onInjectContextSources }: KnowledgeBasePageProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [entries, setEntries] = useState<KnowledgeEntry[]>(() =>
    readKnowledgeEntries().filter((row) => !isHiddenKnowledgeEntry(row)),
  );
  const [collapsedByGroup, setCollapsedByGroup] = useState<Record<string, boolean>>({});
  const [markdownContent, setMarkdownContent] = useState("");
  const [jsonContent, setJsonContent] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    let next = readKnowledgeEntries().filter((row) => !isHiddenKnowledgeEntry(row));
    for (const post of posts) {
      const row = toKnowledgeEntry(post);
      if (!row) {
        continue;
      }
      next = upsertKnowledgeEntry(row).filter((entry) => !isHiddenKnowledgeEntry(entry));
    }
    setEntries(next);
    void persistKnowledgeIndexToWorkspace({ cwd, invokeFn: invoke, rows: next });
  }, [cwd, posts]);

  const filtered = useMemo(() => [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [entries]);
  const grouped = useMemo<KnowledgeGroup[]>(() => {
    const byTask = new Map<string, KnowledgeEntry[]>();
    for (const entry of filtered) {
      const task = toUpperSnakeToken(String(entry.taskId ?? ""));
      const bucket = byTask.get(task) ?? [];
      bucket.push(entry);
      byTask.set(task, bucket);
    }
    return [...byTask.entries()].map(([taskId, rows]) => ({
      taskId,
      entries: rows,
    }));
  }, [filtered]);

  const selected = filtered.find((row) => row.id === selectedId) ?? filtered[0] ?? null;
  const entryStats = useMemo(
    () => ({
      total: entries.length,
      artifact: entries.filter((row) => row.sourceKind === "artifact").length,
      web: entries.filter((row) => row.sourceKind === "web").length,
      ai: entries.filter((row) => row.sourceKind === "ai").length,
    }),
    [entries],
  );

  useEffect(() => {
    if (!selected && selectedId) {
      setSelectedId("");
    }
  }, [selected, selectedId]);

  useEffect(() => {
    if (grouped.length === 0) {
      setCollapsedByGroup({});
      return;
    }
    setCollapsedByGroup((prev) => {
      const next: Record<string, boolean> = {};
      for (const group of grouped) {
        next[group.taskId] = prev[group.taskId] ?? false;
      }
      return next;
    });
  }, [grouped]);

  useEffect(() => {
    let cancelled = false;
    const selectedMarkdownPath = String(selected?.markdownPath ?? "").trim();
    const selectedJsonPath = String(selected?.jsonPath ?? "").trim();
    if (!selected || (!selectedMarkdownPath && !selectedJsonPath)) {
      setMarkdownContent("");
      setJsonContent("");
      setDetailError("");
      setDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setDetailLoading(true);
    setDetailError("");
    void (async () => {
      const errors: string[] = [];
      try {
        if (selectedMarkdownPath) {
          try {
            const markdownText = await invoke<string>("workspace_read_text", {
              path: selectedMarkdownPath,
            });
            if (cancelled) {
              return;
            }
            setMarkdownContent(String(markdownText ?? ""));
          } catch (error) {
            errors.push(`Markdown 읽기 실패: ${String(error)}`);
            setMarkdownContent("");
          }
        } else {
          setMarkdownContent("");
        }

        if (selectedJsonPath) {
          try {
            const jsonText = await invoke<string>("workspace_read_text", {
              path: selectedJsonPath,
            });
            if (cancelled) {
              return;
            }
            setJsonContent(String(jsonText ?? ""));
          } catch (error) {
            errors.push(`JSON 읽기 실패: ${String(error)}`);
            setJsonContent("");
          }
        } else {
          setJsonContent("");
        }

        if (errors.length > 0) {
          setDetailError(errors.join(" / "));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.markdownPath, selected?.jsonPath]);

  const persistRows = (rows: KnowledgeEntry[]) => {
    setEntries(rows);
    void persistKnowledgeIndexToWorkspace({ cwd, invokeFn: invoke, rows });
  };

  const onDeleteSelected = () => {
    if (!selected) {
      return;
    }
    const next = removeKnowledgeEntry(selected.id);
    persistRows(next);
    setSelectedId("");
  };

  const onRevealPath = async (path: string) => {
    const normalized = String(path ?? "").trim();
    if (!normalized) {
      return;
    }
    try {
      await revealItemInDir(normalized);
    } catch (error) {
      setDetailError(`Finder 열기 실패: ${String(error)}`);
    }
  };

  const jsonReadable = useMemo(() => toReadableJsonInfo(jsonContent), [jsonContent]);

  return (
    <section className="panel-card knowledge-view workspace-tab-panel">
      <header className="knowledge-head">
        <h2>데이터베이스</h2>
        <p>역할 실행으로 생성된 산출물(Markdown/JSON)을 탐색하고 에이전트 컨텍스트로 재주입합니다.</p>
      </header>
      <section className="knowledge-overview">
        <article className="knowledge-overview-card panel-card">
          <strong>전체 문서</strong>
          <span>{entryStats.total}</span>
        </article>
        <article className="knowledge-overview-card panel-card">
          <strong>산출물</strong>
          <span>{entryStats.artifact}</span>
        </article>
        <article className="knowledge-overview-card panel-card">
          <strong>WEB 자료</strong>
          <span>{entryStats.web}</span>
        </article>
        <article className="knowledge-overview-card panel-card">
          <strong>AI 자료</strong>
          <span>{entryStats.ai}</span>
        </article>
      </section>
      <section className="knowledge-layout">
        <section className="knowledge-list panel-card knowledge-island">
          <header className="knowledge-list-head">
            <strong>산출물 탐색</strong>
            <span>{`표시 ${filtered.length}개`}</span>
          </header>
          {filtered.length === 0 ? (
            <p className="knowledge-empty">표시할 문서가 없습니다.</p>
          ) : (
            grouped.map((group) => {
              const collapsed = collapsedByGroup[group.taskId] === true;
              return (
                <section key={group.taskId} className="knowledge-group">
                  <button
                    className="knowledge-group-trigger"
                    onClick={() =>
                      setCollapsedByGroup((prev) => ({
                        ...prev,
                        [group.taskId]: !collapsed,
                      }))
                    }
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
                  {!collapsed ? (
                    <div className="knowledge-group-items">
                      {group.entries.map((entry) => (
                        <button
                          key={entry.id}
                          className={`knowledge-row${selected?.id === entry.id ? " is-selected" : ""}`}
                          onClick={() => setSelectedId(entry.id)}
                          type="button"
                        >
                          <strong>{entry.title}</strong>
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
        <section className="knowledge-detail panel-card knowledge-island">
          {selected ? (
            <>
              <header className="knowledge-detail-head">
                <h3>{selected.title}</h3>
                <div className="knowledge-detail-actions">
                  <button type="button" onClick={() => onInjectContextSources([selected])}>
                    컨텍스트로 사용
                  </button>
                  <button type="button" className="danger" onClick={onDeleteSelected}>
                    삭제
                  </button>
                </div>
              </header>
              <p>{selected.summary || "요약 없음"}</p>
              <dl className="knowledge-paths">
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
                  onClick={() => void onRevealPath(String(selected.markdownPath ?? ""))}
                  type="button"
                >
                  Markdown 열기
                </button>
                <button
                  disabled={!selected.jsonPath}
                  onClick={() => void onRevealPath(String(selected.jsonPath ?? ""))}
                  type="button"
                >
                  JSON 열기
                </button>
              </div>
              {detailError ? <p className="knowledge-detail-error">{detailError}</p> : null}
              {detailLoading ? <p className="knowledge-empty">문서를 불러오는 중...</p> : null}
              {!detailLoading && markdownContent ? (
                <section className="knowledge-doc-block">
                  <header className="knowledge-doc-head">
                    <strong>문서 (Markdown)</strong>
                  </header>
                  <pre className="knowledge-doc-markdown">{markdownContent}</pre>
                </section>
              ) : null}
              {!detailLoading && jsonContent ? (
                <section className="knowledge-doc-block">
                  <header className="knowledge-doc-head">
                    <strong>구조화 데이터 (JSON)</strong>
                  </header>
                  {jsonReadable.summaryRows.length > 0 ? (
                    <ul className="knowledge-json-summary">
                      {jsonReadable.summaryRows.map((row) => (
                        <li key={`${row.key}:${row.value}`}>
                          <strong>{row.key}</strong>
                          <span>{row.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <pre className="knowledge-doc-pre">{jsonReadable.pretty}</pre>
                </section>
              ) : null}
            </>
          ) : (
            <p className="knowledge-empty">좌측에서 문서를 선택하세요.</p>
          )}
        </section>
      </section>
    </section>
  );
}
