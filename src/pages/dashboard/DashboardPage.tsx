import { useMemo } from "react";
import MissionControlPanel from "../../components/MissionControlPanel";
import type { DashboardTopicId, DashboardTopicRunState, DashboardTopicSnapshot } from "../../features/dashboard/intelligence";
import type { MissionControlState } from "../../features/orchestration/agentic/missionControl";
import type { CompanionEventType } from "../../features/orchestration/types";
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
  mission: MissionControlState | null;
  onClearMission: () => void;
  onExecuteTaskCommand: (command: string) => void;
  onRecordCompanionEvent: (type: Exclude<CompanionEventType, "unity_verification_completed">, message?: string) => void;
  onRecordUnityVerification: (success: boolean, message: string) => void;
};

type OpsCard = {
  id: string;
  title: string;
  value: string;
  caption: string;
};

function formatSurface(surface: string | undefined): string {
  if (surface === "vscode") {
    return "VS Code";
  }
  if (surface === "unity") {
    return "Unity";
  }
  return "RAIL";
}

export default function DashboardPage(props: DashboardPageProps) {
  const cards = useMemo<OpsCard[]>(() => {
    const nextAction = props.mission?.parentEnvelope.record.nextAction;
    const verification = props.mission?.parentEnvelope.record.verificationStatus ?? "pending";
    const doneRoles = props.mission?.childEnvelopes.filter((row) => row.record.status === "done").length ?? 0;
    const totalRoles = props.mission?.childEnvelopes.length ?? 3;
    return [
      {
        id: "surface",
        title: "현재 작업면",
        value: formatSurface(props.mission?.parentEnvelope.record.surface),
        caption: nextAction?.title ?? "활성 미션 없음",
      },
      {
        id: "nextAction",
        title: "다음 행동",
        value: nextAction?.detail ?? "그래프 탭에서 역할 실행을 시작하세요.",
        caption: nextAction?.cta ?? "그래프 탭으로 이동",
      },
      {
        id: "verification",
        title: "Unity 검증",
        value: verification,
        caption: verification === "verified" ? "검증 완료" : "검증 대기 또는 실패",
      },
      {
        id: "roles",
        title: "역할 진행",
        value: `${doneRoles}/${totalRoles}`,
        caption: props.pendingApprovalsCount > 0 ? `승인 대기 ${props.pendingApprovalsCount}건` : "승인 대기 없음",
      },
    ];
  }, [
    props.mission,
    props.pendingApprovalsCount,
  ]);

  const pendingItems = useMemo(() => {
    const items: string[] = [];
    const verification = props.mission?.parentEnvelope.record.verificationStatus;
    if (props.mission?.parentEnvelope.record.nextAction?.detail) {
      items.push(props.mission.parentEnvelope.record.nextAction.detail);
    }
    if (verification && verification !== "verified") {
      items.push(`Unity verification: ${verification}`);
    }
    if (props.pendingApprovalsCount > 0) {
      items.push(`승인 대기 ${props.pendingApprovalsCount}건`);
    }
    if (props.isGraphRunning) {
      items.push("그래프 실행이 진행 중입니다.");
    }
    if (props.webBridgeRunning) {
      items.push(`웹 브리지 연결 중 · provider ${props.connectedProviderCount}개`);
    }
    if (props.enabledScheduleCount > 0) {
      items.push(`예약 실행 ${props.enabledScheduleCount}/${props.scheduleCount}개 활성`);
    }
    return items.slice(0, 6);
  }, [
    props.connectedProviderCount,
    props.enabledScheduleCount,
    props.isGraphRunning,
    props.mission,
    props.pendingApprovalsCount,
    props.scheduleCount,
    props.webBridgeRunning,
  ]);

  const recentEvents = useMemo(
    () =>
      [...props.workspaceEvents]
        .filter((entry) => entry.actor !== "user")
        .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
        .slice(0, 8),
    [props.workspaceEvents],
  );

  const roleSummaries = useMemo(
    () =>
      props.mission?.childEnvelopes.map((row) => ({
        id: row.record.runId,
        label: row.record.agentRole ?? "implementer",
        status: row.record.status,
        summary: row.record.summary || row.record.nextAction?.title || "요약 없음",
      })) ?? [],
    [props.mission],
  );

  const memoryItems = useMemo(() => {
    if (!props.mission) {
      return [];
    }
    const items = [props.mission.featureMemory.summary, ...props.mission.featureMemory.openRisks];
    return items.map((row) => String(row ?? "").trim()).filter(Boolean).slice(0, 5);
  }, [props.mission]);

  return (
    <section className="dashboard-ops-layout workspace-tab-panel">
      <section className="dashboard-ops-hero panel-card">
        <div>
          <span className="dashboard-ops-kicker">WORK HOME</span>
          <h2>지금 해야 할 일과 미션 상태만 보여주는 작업 홈</h2>
          <p>대시보드 요약 대신, 현재 미션 진행 상황과 다음 행동을 바로 이어서 확인하는 화면입니다.</p>
        </div>
        <div className="dashboard-ops-card-grid">
          {cards.map((card) => (
            <article className="dashboard-ops-card" key={card.id}>
              <span>{card.title}</span>
              <strong>{card.value}</strong>
              <p>{card.caption}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-ops-main">
        <div className="dashboard-ops-primary">
          <MissionControlPanel
            emptyCopy="그래프 탭에서 역할 실행을 시작하면 현재 미션이 여기에 그대로 이어집니다."
            mission={props.mission}
            onClearMission={props.onClearMission}
            onExecuteTaskCommand={props.onExecuteTaskCommand}
            onRecordCompanionEvent={props.onRecordCompanionEvent}
            onRecordUnityVerification={props.onRecordUnityVerification}
          />
        </div>

        <aside className="dashboard-ops-sidebar">
          <section className="panel-card dashboard-ops-panel">
            <div className="dashboard-ops-panel-head">
              <strong>현재 대기열</strong>
              <small>{props.isGraphRunning ? "graph running" : "graph idle"}</small>
            </div>
            {pendingItems.length > 0 ? (
              <ul className="dashboard-ops-list">
                {pendingItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-ops-empty">현재 대기 중인 작업이 없습니다.</p>
            )}
          </section>

          <section className="panel-card dashboard-ops-panel">
            <div className="dashboard-ops-panel-head">
              <strong>역할 진행</strong>
              <small>{roleSummaries.length} roles</small>
            </div>
            {roleSummaries.length > 0 ? (
              <ul className="dashboard-ops-event-list">
                {roleSummaries.map((item) => (
                  <li key={item.id}>
                    <span>{item.label}</span>
                    <p>
                      {item.status} · {item.summary}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-ops-empty">활성 역할이 없습니다.</p>
            )}
          </section>

          <section className="panel-card dashboard-ops-panel">
            <div className="dashboard-ops-panel-head">
              <strong>Feature Memory</strong>
              <small>{memoryItems.length} notes</small>
            </div>
            {memoryItems.length > 0 ? (
              <ul className="dashboard-ops-list">
                {memoryItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-ops-empty">아직 기록된 feature memory가 없습니다.</p>
            )}
          </section>

          <section className="panel-card dashboard-ops-panel">
            <div className="dashboard-ops-panel-head">
              <strong>최근 이벤트</strong>
              <small>{recentEvents.length} entries</small>
            </div>
            {recentEvents.length > 0 ? (
              <ul className="dashboard-ops-event-list">
                {recentEvents.map((entry) => (
                  <li key={entry.id}>
                    <span>{entry.source}</span>
                    <p>{entry.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-ops-empty">최근 이벤트가 없습니다.</p>
            )}
          </section>
        </aside>
      </section>
    </section>
  );
}
