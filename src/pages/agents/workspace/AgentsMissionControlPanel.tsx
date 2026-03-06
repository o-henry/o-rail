import type { MissionControlState } from "../../../features/orchestration/agentic/missionControl";
import type { CompanionEventType } from "../../../features/orchestration/types";

type AgentsMissionControlPanelProps = {
  mission: MissionControlState | null;
  onClearMission: () => void;
  onExecuteTaskCommand: (command: string) => void;
  onRecordCompanionEvent: (type: Exclude<CompanionEventType, "unity_verification_completed">, message?: string) => void;
  onRecordUnityVerification: (success: boolean, message: string) => void;
};

function surfaceLabel(surface: string | undefined): string {
  if (surface === "vscode") {
    return "VS Code";
  }
  if (surface === "unity") {
    return "Unity";
  }
  return "RAIL";
}

function roleLabel(role: string | undefined, primaryRoleLabel: string): string {
  if (role === "planner") {
    return "Planner";
  }
  if (role === "reviewer") {
    return "Reviewer";
  }
  return `Implementer · ${primaryRoleLabel}`;
}

function eventButtonLabel(type: Exclude<CompanionEventType, "unity_verification_completed">): string {
  if (type === "task_received") {
    return "TASK RECEIVED";
  }
  if (type === "patch_ready") {
    return "PATCH READY";
  }
  if (type === "approval_requested") {
    return "APPROVAL";
  }
  if (type === "test_passed") {
    return "TEST PASSED";
  }
  return "TEST FAILED";
}

export function AgentsMissionControlPanel(props: AgentsMissionControlPanelProps) {
  if (!props.mission) {
    return (
      <section className="panel-card agents-mission-panel is-empty" aria-label="Mission control">
        <div className="agents-mission-empty-copy">
          <strong>Mission Control</strong>
          <p>메시지를 전송하면 Planner, Implementer, Reviewer가 연결된 작업 관제 세션이 시작됩니다.</p>
        </div>
      </section>
    );
  }

  const { mission } = props;
  const nextAction = mission.parentEnvelope.record.nextAction;
  const activeSurface = mission.parentEnvelope.record.surface;
  const latestResult = mission.terminalResults[0] ?? null;
  const terminalBusy = mission.terminalSession.status === "running";

  return (
    <section className="panel-card agents-mission-panel" aria-label="Mission control">
      <header className="agents-mission-head">
        <div>
          <strong>Mission Control</strong>
          <p>{mission.title}</p>
        </div>
        <button className="agents-mission-clear-button" onClick={props.onClearMission} type="button">
          CLEAR
        </button>
      </header>

      <section className={`agents-mission-banner is-${activeSurface ?? "rail"}`}>
        <div className="agents-mission-banner-copy">
          <span className="agents-mission-banner-kicker">CURRENT SURFACE</span>
          <strong>{surfaceLabel(activeSurface)}</strong>
          <p>{nextAction?.title ?? "다음 행동 없음"}</p>
        </div>
        <div className="agents-mission-next-action">
          <span>NEXT ACTION</span>
          <b>{nextAction?.detail ?? "새 작업을 시작하세요."}</b>
          {nextAction?.cta ? <small>{nextAction.cta}</small> : null}
        </div>
      </section>

      <section className="agents-mission-role-board" aria-label="Mission roles">
        {mission.childEnvelopes.map((row) => (
          <article className="agents-mission-role-card" key={row.record.runId}>
            <div className="agents-mission-role-head">
              <strong>{roleLabel(row.record.agentRole, mission.primaryRoleLabel)}</strong>
              <span className={`agents-mission-status-chip is-${row.record.status}`}>{row.record.status.toUpperCase()}</span>
            </div>
            <p>{row.record.summary || row.record.nextAction?.title || "요약 없음"}</p>
            <div className="agents-mission-role-meta">
              <span>{surfaceLabel(row.record.surface)}</span>
              <span>{row.record.taskId}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="agents-mission-grid">
        <article className="agents-mission-card">
          <div className="agents-mission-card-head">
            <strong>VS Code Companion</strong>
            <small>{mission.bridgePaths.companionContractPath.split(/[\\/]/).pop()}</small>
          </div>
          <p className="agents-mission-contract-path">{mission.bridgePaths.companionContractPath}</p>
          <div className="agents-mission-button-row">
            {(["task_received", "patch_ready", "approval_requested"] as const).map((type) => (
              <button key={type} onClick={() => props.onRecordCompanionEvent(type)} type="button">
                {eventButtonLabel(type)}
              </button>
            ))}
          </div>
          <ul className="agents-mission-event-list">
            {mission.bridgeEvents.length === 0 ? (
              <li>브리지 이벤트 없음</li>
            ) : (
              mission.bridgeEvents.slice(0, 4).map((event) => (
                <li key={event.id}>
                  <span>{event.type}</span>
                  <p>{event.message}</p>
                </li>
              ))
            )}
          </ul>
        </article>

        <article className="agents-mission-card">
          <div className="agents-mission-card-head">
            <strong>Task Terminal</strong>
            <small>{terminalBusy ? "RUNNING" : mission.terminalSession.status.toUpperCase()}</small>
          </div>
          <div className="agents-mission-command-list">
            {mission.terminalSession.allowedCommands.map((command) => (
              <button
                key={command}
                className="agents-mission-command-button"
                disabled={terminalBusy}
                onClick={() => props.onExecuteTaskCommand(command)}
                type="button"
              >
                <code>{command}</code>
              </button>
            ))}
          </div>
          {latestResult ? (
            <div className="agents-mission-terminal-result">
              <div className="agents-mission-terminal-meta">
                <span>{latestResult.command}</span>
                <b className={latestResult.exitCode === 0 && !latestResult.timedOut ? "is-ok" : "is-error"}>
                  {latestResult.timedOut ? "TIMEOUT" : `EXIT ${latestResult.exitCode}`}
                </b>
              </div>
              <pre>{latestResult.stderrTail || latestResult.stdoutTail || "출력 없음"}</pre>
            </div>
          ) : (
            <p className="agents-mission-muted">아직 실행 결과가 없습니다.</p>
          )}
        </article>

        <article className="agents-mission-card">
          <div className="agents-mission-card-head">
            <strong>Unity Verification</strong>
            <small>{mission.parentEnvelope.record.verificationStatus ?? "pending"}</small>
          </div>
          <p className="agents-mission-contract-path">{mission.bridgePaths.unityContractPath}</p>
          <div className="agents-mission-button-row">
            <button
              onClick={() => props.onRecordUnityVerification(true, "Unity 검증 완료: 플레이/에셋 등록 성공")}
              type="button"
            >
              VERIFY PASS
            </button>
            <button
              onClick={() => props.onRecordUnityVerification(false, "Unity 검증 실패: 플레이 모드 또는 에셋 등록 이슈")}
              type="button"
            >
              VERIFY FAIL
            </button>
          </div>
          <div className="agents-mission-memory">
            <span>FEATURE MEMORY</span>
            <p>{mission.featureMemory.summary}</p>
          </div>
        </article>
      </section>
    </section>
  );
}
