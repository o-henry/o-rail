import { useMemo, useState } from "react";
import FancySelect from "../../components/FancySelect";
import type { FeedViewPost } from "../../app/main";
import {
  persistKnowledgeIndexToWorkspace,
  readKnowledgeEntries,
  upsertKnowledgeEntry,
} from "../../features/studio/knowledgeIndex";
import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import { invoke } from "../../shared/tauri";

type KnowledgeBasePageProps = {
  cwd: string;
  posts: FeedViewPost[];
  onInjectContextSources: (sourceIds: string[]) => void;
};

function toKnowledgeEntry(post: FeedViewPost): KnowledgeEntry {
  return {
    id: post.id,
    runId: post.runId,
    taskId: String(post.topicLabel ?? post.topic ?? "TASK-UNKNOWN"),
    roleId: "technical_writer",
    title: String(post.summary ?? "").slice(0, 72) || post.agentName,
    summary: String(post.summary ?? ""),
    createdAt: post.createdAt,
    markdownPath: post.attachments.find((row) => row.kind === "markdown")?.filePath,
    jsonPath: post.attachments.find((row) => row.kind === "json")?.filePath,
  };
}

export default function KnowledgeBasePage({ cwd, posts, onInjectContextSources }: KnowledgeBasePageProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const indexedEntries = useMemo(() => {
    const fromFeed = posts.map((post) => toKnowledgeEntry(post));
    let next = readKnowledgeEntries();
    for (const entry of fromFeed) {
      next = upsertKnowledgeEntry(entry);
    }
    void persistKnowledgeIndexToWorkspace({ cwd, invokeFn: invoke, rows: next });
    return next;
  }, [posts]);

  const topicOptions = useMemo(() => {
    const values = Array.from(new Set(indexedEntries.map((row) => row.taskId))).sort();
    return [{ value: "all", label: "전체" }, ...values.map((value) => ({ value, label: value }))];
  }, [indexedEntries]);
  const roleOptions = useMemo(() => {
    const values = Array.from(new Set(indexedEntries.map((row) => row.roleId))).sort();
    return [{ value: "all", label: "전체" }, ...values.map((value) => ({ value, label: value }))];
  }, [indexedEntries]);

  const filtered = useMemo(
    () =>
      indexedEntries.filter((row) => (topicFilter === "all" ? true : row.taskId === topicFilter)).filter((row) => (
        roleFilter === "all" ? true : row.roleId === roleFilter
      )),
    [indexedEntries, roleFilter, topicFilter],
  );
  const selected = filtered.find((row) => row.id === selectedId) ?? filtered[0] ?? null;

  return (
    <section className="panel-card knowledge-view workspace-tab-panel">
      <header className="knowledge-head">
        <h2>지식베이스</h2>
        <p>산출물(MD/JSON)을 태스크/역할 기준으로 탐색하고 실행 컨텍스트로 재주입합니다.</p>
      </header>
      <section className="knowledge-filters">
        <div>
          <label>TASK</label>
          <FancySelect
            ariaLabel="task filter"
            className="knowledge-select"
            onChange={setTopicFilter}
            options={topicOptions}
            value={topicFilter}
          />
        </div>
        <div>
          <label>ROLE</label>
          <FancySelect
            ariaLabel="role filter"
            className="knowledge-select"
            onChange={setRoleFilter}
            options={roleOptions}
            value={roleFilter}
          />
        </div>
      </section>
      <section className="knowledge-layout">
        <section className="knowledge-list panel-card">
          {filtered.length === 0 ? (
            <p className="knowledge-empty">표시할 문서가 없습니다.</p>
          ) : (
            filtered.map((entry) => (
              <button
                key={entry.id}
                className={`knowledge-row${selected?.id === entry.id ? " is-selected" : ""}`}
                onClick={() => setSelectedId(entry.id)}
                type="button"
              >
                <strong>{entry.title}</strong>
                <span>{entry.taskId}</span>
                <small>{new Date(entry.createdAt).toLocaleString()}</small>
              </button>
            ))
          )}
        </section>
        <section className="knowledge-detail panel-card">
          {selected ? (
            <>
              <header className="knowledge-detail-head">
                <h3>{selected.title}</h3>
                <button type="button" onClick={() => onInjectContextSources([selected.id])}>
                  컨텍스트로 사용
                </button>
              </header>
              <p>{selected.summary || "요약 없음"}</p>
              <dl className="knowledge-paths">
                <dt>MD</dt>
                <dd>{selected.markdownPath || "-"}</dd>
                <dt>JSON</dt>
                <dd>{selected.jsonPath || "-"}</dd>
              </dl>
            </>
          ) : (
            <p className="knowledge-empty">좌측에서 문서를 선택하세요.</p>
          )}
        </section>
      </section>
    </section>
  );
}
