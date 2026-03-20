import type { MissionControlState } from "../features/orchestration/agentic/missionControl";

type Props = {
  coordination: NonNullable<MissionControlState["coordination"]>;
  statusLabel: (status: string | undefined) => string;
};

function laneChipStatus(status: string): string {
  if (status === "active") {
    return "running";
  }
  if (status === "done") {
    return "done";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "review") {
    return "review";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "idle";
}

export default function MissionControlTeamRuntimeSection(props: Props) {
  const { coordination, statusLabel } = props;

  return (
    <section className="agents-mission-role-section" aria-label="Team runtime">
      <div className="agents-mission-section-head">
        <strong>Team runtime</strong>
        <p>{coordination.nextAction}</p>
      </div>
      <div className="agents-mission-status-note">
        <span>상태</span>
        <p>{statusLabel(coordination.status)}</p>
      </div>
      {coordination.blockedReason ? (
        <div className="agents-mission-status-note">
          <span>막힘 이유</span>
          <p>{coordination.blockedReason}</p>
        </div>
      ) : null}
      {coordination.resumeHint ? (
        <div className="agents-mission-status-note">
          <span>재개 힌트</span>
          <p>{coordination.resumeHint}</p>
        </div>
      ) : null}
      <div className="agents-mission-role-board">
        {coordination.lanes.map((lane) => (
          <article className="agents-mission-role-card" key={lane.id}>
            <div className="agents-mission-role-head">
              <strong>{lane.title}</strong>
              <span className={`agents-mission-status-chip is-${laneChipStatus(lane.status)}`}>{statusLabel(lane.status)}</span>
            </div>
            <p>{lane.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
