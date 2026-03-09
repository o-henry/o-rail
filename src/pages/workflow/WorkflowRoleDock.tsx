import type { HandoffRecord, StudioRoleId } from "../../features/studio/handoffTypes";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";

type RoleDockStatus = "IDLE" | "RUNNING" | "VERIFY" | "DONE";

type WorkflowRoleDockProps = {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  roleId: StudioRoleId;
  onSelectRoleId: (roleId: StudioRoleId) => void;
  roleSelectionLockedTo?: StudioRoleId | null;
  taskId: string;
  onChangeTaskId: (value: string) => void;
  prompt: string;
  onChangePrompt: (value: string) => void;
  onRunRole: () => void;
  runDisabled: boolean;
  roleStatusById: Partial<Record<StudioRoleId, { status: RoleDockStatus; taskId?: string }>>;
  selectedRoleHandoffs: HandoffRecord[];
  selectedRoleBlockers: HandoffRecord[];
  onClearRecentHandoffs: () => void;
  onOpenKnowledge: () => void;
};

export default function WorkflowRoleDock(props: WorkflowRoleDockProps) {
  const latestArtifactPath = props.selectedRoleHandoffs
    .flatMap((row) => row.artifactPaths.map((path) => String(path ?? "").trim()).filter(Boolean))
    .find((path) => path.toLowerCase().endsWith(".json"))
    ?? props.selectedRoleHandoffs
      .flatMap((row) => row.artifactPaths.map((path) => String(path ?? "").trim()).filter(Boolean))[0];
  const latestArtifactName = latestArtifactPath
    ? latestArtifactPath.split(/[\\/]/).filter(Boolean).pop() ?? latestArtifactPath
    : "";
  const lockedRoleId = props.roleSelectionLockedTo ?? null;

  return (
    <aside className={`panel-card workflow-role-dock${props.collapsed ? " is-collapsed" : ""}`.trim()} aria-label="역할 워크스페이스">
      <header className="workflow-role-dock-head">
        <div className="workflow-role-dock-head-text">
          <strong>역할 워크스페이스</strong>
          <span>그래프 단일 실행 보드</span>
        </div>
        <button
          aria-label={props.collapsed ? "역할 워크스페이스 펼치기" : "역할 워크스페이스 축소"}
          className="workflow-island-collapse-button"
          onClick={props.onToggleCollapsed}
          type="button"
        >
          <img
            alt=""
            className="workflow-island-collapse-icon"
            src={props.collapsed ? "/down-arrow.svg" : "/up-arrow.svg"}
          />
        </button>
      </header>

      {!props.collapsed && (
        <>

      <section className="workflow-role-cards" aria-label="역할 카드">
        {STUDIO_ROLE_TEMPLATES.map((role) => {
          const selected = role.id === props.roleId;
          const lockedOut = Boolean(lockedRoleId) && role.id !== lockedRoleId;
          const roleState = props.roleStatusById[role.id]?.status ?? "IDLE";
          const roleTaskId = props.roleStatusById[role.id]?.taskId ?? "";
          return (
            <button
              key={role.id}
              className={`workflow-role-card${selected ? " is-selected" : ""}${lockedOut ? " is-locked-out" : ""}`}
              disabled={lockedOut}
              onClick={() => props.onSelectRoleId(role.id)}
              type="button"
            >
              <strong>{role.label}</strong>
              <span>{role.goal}</span>
              <div className="workflow-role-card-meta">
                <span className={`workflow-role-status-chip is-${roleState.toLowerCase()}`}>{roleState}</span>
                {roleTaskId ? <code>{roleTaskId}</code> : null}
              </div>
            </button>
          );
        })}
      </section>

      <section className="workflow-role-form">
        <label>
          TASK ID
          <input
            className="workflow-handoff-task-input"
            onChange={(event) => props.onChangeTaskId(event.currentTarget.value)}
            placeholder="TASK-001"
            value={props.taskId}
          />
        </label>
        <label>
          요청사항
          <textarea
            className="workflow-handoff-request-input"
            onChange={(event) => props.onChangePrompt(event.currentTarget.value)}
            placeholder="현재 역할에서 바로 처리할 요청을 입력하세요."
            value={props.prompt}
          />
        </label>
        <button
          className="mini-action-button workflow-role-run-button"
          disabled={props.runDisabled}
          onClick={props.onRunRole}
          type="button"
        >
          <span className="mini-action-button-label">역할 실행</span>
        </button>
      </section>

      <section className="workflow-role-summary">
        <div className="workflow-role-summary-head">
          <strong>최근 인수인계</strong>
          <button className="mini-action-button workflow-role-summary-clear" onClick={props.onClearRecentHandoffs} type="button">
            <span className="mini-action-button-label">CLEAR</span>
          </button>
        </div>
        {props.selectedRoleHandoffs.length === 0 ? (
          <p className="workflow-role-summary-empty">HANDOFF 없음</p>
        ) : (
          <ul className="workflow-role-summary-list">
            {props.selectedRoleHandoffs.map((row) => (
              <li key={row.id}>
                <span>{row.taskId}</span>
                <code>{row.status.toUpperCase()}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="workflow-role-summary">
        <div className="workflow-role-summary-head">
          <strong>최근 산출물</strong>
          <button className="mini-action-button workflow-role-summary-open" onClick={props.onOpenKnowledge} type="button">
            <span className="mini-action-button-label">데이터베이스에서 보기</span>
          </button>
        </div>
        <p className="workflow-role-summary-path">
          {latestArtifactName || "산출물 없음"}
        </p>
      </section>

      <section className="workflow-role-summary">
        <strong>차단 이슈</strong>
        {props.selectedRoleBlockers.length === 0 ? (
          <p className="workflow-role-summary-empty">BLOCKER 없음</p>
        ) : (
          <ul className="workflow-role-summary-list">
            {props.selectedRoleBlockers.map((row) => (
              <li key={row.id}>
                <span>{row.taskId}</span>
                <code>{String(row.rejectReason ?? "REJECTED").trim() || "REJECTED"}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      )}
    </aside>
  );
}
