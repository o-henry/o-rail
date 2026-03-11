import type { StudioRoleId } from "../../features/studio/handoffTypes";
import { isStudioRolePaletteVisible, normalizeStudioRoleSelection } from "../../features/studio/pmPlanningMode";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";

type RoleDockStatus = "IDLE" | "RUNNING" | "VERIFY" | "DONE";

type WorkflowRoleDockProps = {
  roleId: StudioRoleId;
  onSelectRoleId: (roleId: StudioRoleId) => void;
  roleSelectionLockedTo?: StudioRoleId | null;
  prompt: string;
  onChangePrompt: (value: string) => void;
  onSaveRequest: () => void;
  onDeleteQueuedRequest: (text: string) => void;
  saveDisabled: boolean;
  roleStatusById: Partial<Record<StudioRoleId, { status: RoleDockStatus; taskId?: string }>>;
  queuedRequests: string[];
  requestTargetCount: number;
};

export default function WorkflowRoleDock(props: WorkflowRoleDockProps) {
  const lockedRoleId = normalizeStudioRoleSelection(props.roleSelectionLockedTo ?? null);
  const selectedRoleId = normalizeStudioRoleSelection(props.roleId) ?? props.roleId;

  return (
    <aside className="panel-card workflow-role-dock" aria-label="역할 워크스페이스">
      <header className="workflow-role-dock-head">
        <div className="workflow-role-dock-head-text">
          <strong>역할 워크스페이스</strong>
          <span>그래프 역할 추가 요청 저장</span>
        </div>
      </header>

      <>

      <section className="workflow-role-cards" aria-label="역할 카드">
        {STUDIO_ROLE_TEMPLATES.filter((role) => isStudioRolePaletteVisible(role.id)).map((role) => {
          const selected = role.id === selectedRoleId;
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
          요청사항
          <textarea
            className="workflow-handoff-request-input"
            onChange={(event) => props.onChangePrompt(event.currentTarget.value)}
            placeholder="다음 그래프 실행 때 이 역할에 추가로 반영할 요청을 입력하세요."
            value={props.prompt}
          />
        </label>
        <button
          className="mini-action-button workflow-role-run-button"
          disabled={props.saveDisabled}
          onClick={props.onSaveRequest}
          type="button"
        >
          <span className="mini-action-button-label">추가 요청 저장</span>
        </button>
      </section>

      <section className="workflow-role-summary">
        <strong>저장된 추가 요청</strong>
        <p className="workflow-role-summary-path">
          {props.requestTargetCount > 0
            ? `대상 역할 노드 ${props.requestTargetCount}개`
            : "대상 역할 노드 없음"}
        </p>
        {props.queuedRequests.length === 0 ? (
          <p className="workflow-role-summary-empty">저장된 추가 요청 없음</p>
        ) : (
          <ul className="workflow-role-summary-list">
            {props.queuedRequests.map((row, index) => (
              <li key={`${index}:${row}`}>
                <span>{row}</span>
                <div className="workflow-role-summary-item-actions">
                  <small>저장됨</small>
                  <button
                    aria-label={`저장된 추가 요청 삭제: ${row}`}
                    className="workflow-role-summary-remove"
                    onClick={() => props.onDeleteQueuedRequest(row)}
                    type="button"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      </>
    </aside>
  );
}
