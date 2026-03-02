import { useMemo, useState } from "react";
import FancySelect from "../../components/FancySelect";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";
import {
  persistHandoffRecordsToWorkspace,
  readHandoffRecords,
  upsertHandoffRecord,
} from "../../features/studio/handoffStore";
import type { HandoffRecord, StudioRoleId } from "../../features/studio/handoffTypes";
import { invoke } from "../../shared/tauri";

type HandoffPageProps = {
  cwd: string;
  onOpenAgents: () => void;
  onConsumeHandoff: (payload: {
    handoffId: string;
    toRole: StudioRoleId;
    taskId: string;
    request: string;
  }) => void;
};

function createHandoffId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `handoff-${stamp}-${random}`;
}

function roleLabel(roleId: StudioRoleId): string {
  return STUDIO_ROLE_TEMPLATES.find((role) => role.id === roleId)?.label ?? roleId;
}

export default function HandoffPage({ cwd, onOpenAgents, onConsumeHandoff }: HandoffPageProps) {
  const [records, setRecords] = useState<HandoffRecord[]>(() => readHandoffRecords());
  const [selectedId, setSelectedId] = useState<string>(() => readHandoffRecords()[0]?.id ?? "");
  const [fromRole, setFromRole] = useState<StudioRoleId>("pm_planner");
  const [toRole, setToRole] = useState<StudioRoleId>("client_programmer");
  const [taskId, setTaskId] = useState("TASK-001");
  const [requestText, setRequestText] = useState("");

  const selected = useMemo(
    () => records.find((row) => row.id === selectedId) ?? records[0] ?? null,
    [records, selectedId],
  );

  const roleOptions = STUDIO_ROLE_TEMPLATES.map((role) => ({
    value: role.id,
    label: role.label,
  }));

  const onCreateHandoff = () => {
    const normalizedRequest = requestText.trim();
    const normalizedTaskId = taskId.trim();
    if (!normalizedRequest || !normalizedTaskId) {
      return;
    }
    const id = createHandoffId();
    const next = upsertHandoffRecord({
      id,
      fromRole,
      toRole,
      taskId: normalizedTaskId,
      request: normalizedRequest,
      artifactPaths: [],
      status: "requested",
    });
    setRecords(next);
    setSelectedId(id);
    setRequestText("");
    void persistHandoffRecordsToWorkspace({ cwd, invokeFn: invoke, rows: next });
  };

  const onUpdateStatus = (status: HandoffRecord["status"], rejectReason?: string) => {
    if (!selected) {
      return;
    }
    const next = upsertHandoffRecord({
      ...selected,
      status,
      rejectReason,
    });
    setRecords(next);
    void persistHandoffRecordsToWorkspace({ cwd, invokeFn: invoke, rows: next });
  };

  return (
    <section className="panel-card handoff-view workspace-tab-panel">
      <header className="handoff-head">
        <h2>핸드오프</h2>
        <p>역할 간 인수인계를 등록하고 수락/반려/재요청 상태를 관리합니다.</p>
      </header>
      <section className="handoff-layout">
        <section className="handoff-list panel-card">
          <header className="handoff-section-head">
            <h3>인수인계 목록</h3>
          </header>
          <div className="handoff-list-scroll" role="list">
            {records.length === 0 ? (
              <p className="handoff-empty">등록된 인수인계가 없습니다.</p>
            ) : (
              records.map((row) => (
                <button
                  key={row.id}
                  className={`handoff-row${selected?.id === row.id ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                  role="listitem"
                  type="button"
                >
                  <strong>{row.taskId}</strong>
                  <span>{roleLabel(row.fromRole)} → {roleLabel(row.toRole)}</span>
                  <code>{row.status.toUpperCase()}</code>
                </button>
              ))
            )}
          </div>
        </section>
        <section className="handoff-detail panel-card">
          <header className="handoff-section-head">
            <h3>상세</h3>
          </header>
          {selected ? (
            <div className="handoff-detail-body">
              <div className="handoff-detail-grid">
                <span>FROM</span>
                <strong>{roleLabel(selected.fromRole)}</strong>
                <span>TO</span>
                <strong>{roleLabel(selected.toRole)}</strong>
                <span>TASK</span>
                <strong>{selected.taskId}</strong>
                <span>상태</span>
                <strong>{selected.status.toUpperCase()}</strong>
              </div>
              <p className="handoff-request">{selected.request}</p>
              <div className="handoff-actions">
                <button type="button" onClick={() => onUpdateStatus("accepted")}>수락</button>
                <button type="button" onClick={() => onUpdateStatus("rejected", "요구사항 보완 필요")}>반려</button>
                <button type="button" onClick={() => onUpdateStatus("requested")}>재요청</button>
                <button
                  type="button"
                  onClick={() => {
                    onConsumeHandoff({
                      handoffId: selected.id,
                      toRole: selected.toRole,
                      taskId: selected.taskId,
                      request: selected.request,
                    });
                    onOpenAgents();
                  }}
                >
                  에이전트 컨텍스트로 주입
                </button>
              </div>
            </div>
          ) : (
            <p className="handoff-empty">좌측에서 인수인계를 선택하세요.</p>
          )}
          <div className="handoff-create">
            <h4>새 인수인계</h4>
            <div className="handoff-create-row">
              <FancySelect
                ariaLabel="from role"
                className="handoff-select"
                onChange={(next) => setFromRole(next as StudioRoleId)}
                options={roleOptions}
                value={fromRole}
              />
              <FancySelect
                ariaLabel="to role"
                className="handoff-select"
                onChange={(next) => setToRole(next as StudioRoleId)}
                options={roleOptions}
                value={toRole}
              />
            </div>
            <input value={taskId} onChange={(event) => setTaskId(event.target.value)} />
            <textarea
              placeholder="인수인계 요청사항"
              value={requestText}
              onChange={(event) => setRequestText(event.target.value)}
            />
            <button type="button" onClick={onCreateHandoff}>인수인계 등록</button>
          </div>
        </section>
      </section>
    </section>
  );
}
