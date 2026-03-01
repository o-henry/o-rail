import { useMemo, useState } from "react";
import {
  DASHBOARD_TOPIC_IDS,
  type DashboardTopicId,
  type DashboardTopicRunState,
  type DashboardTopicSnapshot,
} from "../../features/dashboard/intelligence";
import { useI18n } from "../../i18n";
import { type DashboardStockDocumentPost } from "./stockWidgetChartData";
import type { DashboardDetailTopic } from "./DashboardDetailPage";

type DashboardPageProps = {
  isGraphRunning: boolean;
  pendingApprovalsCount: number;
  webBridgeRunning: boolean;
  connectedProviderCount: number;
  scheduleCount: number;
  enabledScheduleCount: number;
  focusTopic: DashboardDetailTopic | null;
  onFocusTopic: (topic: DashboardDetailTopic | null) => void;
  stockDocumentPosts: DashboardStockDocumentPost[];
  topicSnapshots: Partial<Record<DashboardTopicId, DashboardTopicSnapshot>>;
  runStateByTopic: Record<DashboardTopicId, DashboardTopicRunState>;
  workspaceEvents: Array<{
    id: string;
    at: string;
    source: string;
    actor: string;
    level: string;
    message: string;
    runId?: string;
    topic?: string;
  }>;
};

type DashboardCard = {
  id: "workflow" | "approvals" | "webConnect" | "schedules";
  title: string;
  value: string;
  caption: string;
};

type DashboardResourceLine = {
  id: string;
  topic: DashboardTopicId | "feed";
  kind: "reference" | "event" | "highlight" | "summary" | "log";
  text: string;
};

function topicTitleKey(topic: DashboardTopicId): string {
  return `dashboard.widget.${topic}.title`;
}

function normalizeDashboardLogText(input: string): string {
  return input.replace(/\bstatus\b/gi, "상태");
}

export default function DashboardPage(props: DashboardPageProps) {
  const { t } = useI18n();
  const [runFilter, setRunFilter] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");

  const cards = useMemo<DashboardCard[]>(
    () => [
      {
        id: "workflow",
        title: t("dashboard.card.workflow"),
        value: props.isGraphRunning ? t("dashboard.status.running") : t("dashboard.status.idle"),
        caption: "",
      },
      {
        id: "approvals",
        title: t("dashboard.card.approvals"),
        value: String(props.pendingApprovalsCount),
        caption:
          props.pendingApprovalsCount > 0
            ? t("modal.approvalRequired")
            : t("label.status.done"),
      },
      {
        id: "webConnect",
        title: t("dashboard.card.webConnect"),
        value: props.webBridgeRunning ? t("dashboard.status.connected") : t("dashboard.status.disconnected"),
        caption: `${props.connectedProviderCount} providers`,
      },
      {
        id: "schedules",
        title: t("dashboard.card.schedules"),
        value: `${props.enabledScheduleCount}/${props.scheduleCount}`,
        caption: t("dashboard.card.lastBatch"),
      },
    ],
    [
      props.connectedProviderCount,
      props.enabledScheduleCount,
      props.isGraphRunning,
      props.pendingApprovalsCount,
      props.scheduleCount,
      props.webBridgeRunning,
      t,
    ],
  );

  const snapshotSummaries = useMemo(() => {
    const snapshots = Object.values(props.topicSnapshots)
      .filter((snapshot): snapshot is DashboardTopicSnapshot => Boolean(snapshot))
      .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime())
      .slice(0, 8);
    return snapshots.map((snapshot) => `${t(topicTitleKey(snapshot.topic))}: ${snapshot.summary}`);
  }, [props.topicSnapshots, t]);

  const fallbackFeedSummaries = useMemo(
    () =>
      [...props.stockDocumentPosts]
        .filter((post) => (post.summary ?? "").trim().length > 0)
        .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime())
        .slice(0, 8)
        .map((post) => String(post.summary ?? "").trim()),
    [props.stockDocumentPosts],
  );

  const workSummaryItems = snapshotSummaries.length > 0 ? snapshotSummaries : fallbackFeedSummaries;
  const terminalLines = workSummaryItems.length > 0 ? workSummaryItems : [t("dashboard.value.none")];
  const resourceLines = useMemo<DashboardResourceLine[]>(() => {
    const runFilterValue = runFilter;
    const topicFilterValue = topicFilter;
    const eventLines: DashboardResourceLine[] = props.workspaceEvents
      .filter((entry) => entry.actor !== "user")
      .filter((entry) => (runFilterValue === "all" ? true : String(entry.runId ?? "") === runFilterValue))
      .filter((entry) => (topicFilterValue === "all" ? true : String(entry.topic ?? "") === topicFilterValue))
      .slice(0, 10)
      .map((entry) => ({
        id: `log-${entry.id}`,
        topic: "feed",
        kind: "log",
        text: normalizeDashboardLogText(
          `${entry.runId ? `[${entry.runId}] ` : ""}${entry.topic ? `${entry.topic} · ` : ""}${entry.source} · ${entry.message}`,
        ),
      }));

    const snapshots = Object.values(props.topicSnapshots)
      .filter((snapshot): snapshot is DashboardTopicSnapshot => Boolean(snapshot))
      .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());
    const collected: DashboardResourceLine[] = [];
    snapshots.forEach((snapshot) => {
      snapshot.references.slice(0, 2).forEach((reference, index) => {
        const title = String(reference.title ?? "").trim();
        const source = String(reference.source ?? "").trim();
        const text = [title, source].filter((part) => part.length > 0).join(" · ") || reference.url;
        if (!text) {
          return;
        }
        collected.push({
          id: `${snapshot.topic}-ref-${index}-${text}`,
          topic: snapshot.topic,
          kind: "reference",
          text,
        });
      });
      snapshot.events.slice(0, 1).forEach((event, index) => {
        const title = String(event.title ?? "").trim();
        const note = String(event.note ?? "").trim();
        const text = [title, note].filter((part) => part.length > 0).join(" · ");
        if (!text) {
          return;
        }
        collected.push({
          id: `${snapshot.topic}-event-${index}-${text}`,
          topic: snapshot.topic,
          kind: "event",
          text,
        });
      });
      snapshot.highlights.slice(0, 1).forEach((highlight, index) => {
        const text = String(highlight ?? "").trim();
        if (!text) {
          return;
        }
        collected.push({
          id: `${snapshot.topic}-highlight-${index}-${text}`,
          topic: snapshot.topic,
          kind: "highlight",
          text,
        });
      });
    });

    const merged = [...eventLines, ...collected];
    if (merged.length > 0) {
      return merged.slice(0, 12);
    }

    const fallback: DashboardResourceLine[] = fallbackFeedSummaries.slice(0, 12).map((summary, index) => ({
      id: `feed-summary-${index}-${summary}`,
      topic: "feed",
      kind: "summary",
      text: summary,
    }));
    if (fallback.length > 0) {
      return fallback;
    }
    return [
      {
        id: "resource-empty",
        topic: "feed",
        kind: "summary",
        text: t("dashboard.value.none"),
      },
    ];
  }, [fallbackFeedSummaries, props.topicSnapshots, props.workspaceEvents, runFilter, topicFilter]);

  const runFilterOptions = useMemo(
    () =>
      [...new Set(
        props.workspaceEvents
          .filter((entry) => entry.actor !== "user")
          .map((entry) => String(entry.runId ?? "").trim())
          .filter((value) => value.length > 0),
      )].slice(0, 30),
    [props.workspaceEvents],
  );
  const topicFilterOptions = useMemo(
    () =>
      [...new Set(
        props.workspaceEvents
          .filter((entry) => entry.actor !== "user")
          .map((entry) => String(entry.topic ?? "").trim())
          .filter((value) => value.length > 0),
      )].slice(0, 20),
    [props.workspaceEvents],
  );

  const latestSnapshotText = useMemo(() => {
    const snapshots = Object.values(props.topicSnapshots).filter(
      (snapshot): snapshot is DashboardTopicSnapshot => Boolean(snapshot),
    );
    if (snapshots.length === 0) {
      return t("dashboard.value.none");
    }
    const latest = snapshots.sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime())[0];
    const timestamp = new Date(latest.generatedAt);
    if (Number.isNaN(timestamp.getTime())) {
      return latest.generatedAt;
    }
    return timestamp.toLocaleString();
  }, [props.topicSnapshots, t]);

  const topicRunStateRows = useMemo(
    () =>
      DASHBOARD_TOPIC_IDS.map((topic) => {
        const row = props.runStateByTopic[topic];
        const lastRunText = row?.lastRunAt ? new Date(row.lastRunAt).toLocaleTimeString() : "";
        const statusText = row?.running ? "RUNNING" : row?.lastError ? "ERROR" : row?.lastRunAt ? "DONE" : "IDLE";
        const progressText = String(row?.progressText ?? "").trim();
        return {
          id: topic,
          topic,
          statusText,
          detailText: row?.lastError ? String(row.lastError) : row?.running ? progressText || "실행 중" : lastRunText,
          running: Boolean(row?.running),
          hasState: Boolean(row?.running || row?.lastError || row?.lastRunAt || progressText),
        };
      }).filter((row) => row.hasState),
    [props.runStateByTopic],
  );
  const runningTopicCount = topicRunStateRows.filter((row) => row.running).length;
  const runningTopicLabels = topicRunStateRows.filter((row) => row.running).map((row) => t(topicTitleKey(row.topic)));
  const latestErroredTopic = topicRunStateRows.find((row) => row.statusText === "ERROR");
  const latestDoneTopic = topicRunStateRows.find((row) => row.statusText === "DONE");

  const runtimeBanner = useMemo(() => {
    if (runningTopicLabels.length > 0) {
      return {
        tone: "running" as const,
        text: `실행 중: ${runningTopicLabels.join(", ")}`,
      };
    }
    if (latestErroredTopic) {
      return {
        tone: "error" as const,
        text: `실행 실패: ${t(topicTitleKey(latestErroredTopic.topic))}`,
      };
    }
    if (latestDoneTopic) {
      return {
        tone: "done" as const,
        text: `최근 완료: ${t(topicTitleKey(latestDoneTopic.topic))}`,
      };
    }
    return {
      tone: "idle" as const,
      text: "대기 중: 실행 기록이 없습니다.",
    };
  }, [latestDoneTopic, latestErroredTopic, runningTopicLabels, t]);

  return (
    <section className="dashboard-layout dashboard-terminal-layout workspace-tab-panel">
      <section className="dashboard-terminal-shell">
        <aside className="panel-card dashboard-terminal-sidebar">
          <div className="dashboard-terminal-sidebar-meta">
            <p>{t("dashboard.card.lastBatch")}</p>
            <b>{latestSnapshotText}</b>
            <div className="dashboard-terminal-log-filters">
              <label>
                RUN
                <select value={runFilter} onChange={(event) => setRunFilter(event.target.value)}>
                  <option value="all">all</option>
                  {runFilterOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                TOPIC
                <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
                  <option value="all">all</option>
                  {topicFilterOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {topicRunStateRows.length > 0 ? (
            <div className="dashboard-terminal-runstate" role="status">
              {topicRunStateRows.map((row) => (
                <article className="dashboard-terminal-runstate-row" key={row.id}>
                  <b>{t(topicTitleKey(row.topic))}</b>
                  <span className={`dashboard-terminal-runstate-state ${row.statusText.toLowerCase()}`}>{row.statusText}</span>
                  {row.detailText ? <p>{row.detailText}</p> : null}
                </article>
              ))}
            </div>
          ) : null}
          <ul className="dashboard-terminal-log-list">
            {resourceLines.map((line) => (
              <li key={line.id}>
                <span aria-hidden="true">
                  {line.kind === "reference" ? "REF" : line.kind === "event" ? "EVT" : line.kind === "highlight" ? "HLT" : line.kind === "log" ? "LOG" : "SUM"}
                </span>
                <p>{line.topic === "feed" ? line.text : `${t(topicTitleKey(line.topic))} · ${line.text}`}</p>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel-card dashboard-terminal-workspace">
          <header className="dashboard-terminal-workspace-head">
            <strong>{t("dashboard.card.workflow")}</strong>
            <div className="dashboard-terminal-head-meta">
              <span>{runningTopicCount > 0 ? `RUNNING ${runningTopicCount}` : "IDLE"}</span>
              <div className="dashboard-terminal-head-metrics">
                {cards.map((card) => (
                  <article className="dashboard-terminal-head-metric" key={card.id}>
                    <b>{card.title}</b>
                    <strong>{card.value}</strong>
                  </article>
                ))}
              </div>
            </div>
          </header>
          <div className={`dashboard-terminal-runtime-banner ${runtimeBanner.tone}`} role="status">
            <span>{runtimeBanner.text}</span>
          </div>

          <section className="dashboard-terminal-editor">
            <pre>{terminalLines.map((line, index) => `[${String(index + 1).padStart(2, "0")}] ${line}`).join("\n")}</pre>
          </section>
        </section>
      </section>
    </section>
  );
}
