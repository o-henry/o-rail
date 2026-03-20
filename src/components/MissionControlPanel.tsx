import { useMemo } from "react";

import { createMissionControlPreviewState, type MissionControlState } from "../features/orchestration/agentic/missionControl";
import type { CompanionEventType } from "../features/orchestration/types";
import MissionControlTeamRuntimeSection from "./MissionControlTeamRuntimeSection";

type MissionControlPanelProps = {
  mission: MissionControlState | null;
  onClearMission: () => void;
  onExecuteTaskCommand: (command: string) => void;
  onRecordCompanionEvent: (type: Exclude<CompanionEventType, "unity_verification_completed">, message?: string) => void;
  onRecordUnityVerification: (success: boolean, message: string) => void;
  emptyCopy?: string;
  className?: string;
};

function surfaceLabel(surface: string | undefined): string {
  if (surface === "vscode") {
    return "VS Code 작업";
  }
  if (surface === "unity") {
    return "Unity 확인";
  }
  return "RAIL 조율";
}

function roleLabel(role: string | undefined, primaryRoleLabel: string): string {
  if (role === "planner") {
    return "1단계 · 계획 정리";
  }
  if (role === "reviewer") {
    return "3단계 · 검토 확인";
  }
  return `2단계 · ${primaryRoleLabel} 구현`;
}

function eventButtonLabel(type: Exclude<CompanionEventType, "unity_verification_completed">): string {
  if (type === "task_received") {
    return "작업 수신";
  }
  if (type === "patch_ready") {
    return "패치 준비";
  }
  if (type === "approval_requested") {
    return "검토 요청";
  }
  if (type === "test_passed") {
    return "검증 통과";
  }
  return "검증 실패";
}

function statusLabel(status: string | undefined): string {
  if (status === "planning") {
    return "계획 중";
  }
  if (status === "done") {
    return "완료";
  }
  if (status === "running") {
    return "진행 중";
  }
  if (status === "review") {
    return "검토";
  }
  if (status === "error" || status === "failed") {
    return "실패";
  }
  if (status === "blocked") {
    return "대기";
  }
  if (status === "waiting_review") {
    return "검토 대기";
  }
  if (status === "needs_resume") {
    return "재개 필요";
  }
  if (status === "cancelled") {
    return "취소";
  }
  return "준비";
}

function terminalStatusLabel(status: string, busy: boolean): string {
  if (busy) {
    return "실행 중";
  }
  if (status === "done") {
    return "완료";
  }
  if (status === "error") {
    return "오류";
  }
  return "대기";
}

function eventTypeLabel(type: CompanionEventType): string {
  if (type === "task_received") {
    return "작업 수신";
  }
  if (type === "patch_ready") {
    return "패치 준비";
  }
  if (type === "approval_requested") {
    return "검토 요청";
  }
  if (type === "test_passed") {
    return "검증 통과";
  }
  if (type === "test_failed") {
    return "검증 실패";
  }
  return "Unity 검증 완료";
}

export default function MissionControlPanel(props: MissionControlPanelProps) {
  const previewMission = useMemo(() => createMissionControlPreviewState(), []);
  const mission = props.mission ?? previewMission;
  const isPreview = !props.mission;
  const rootClassName = `panel-card agents-mission-panel${isPreview ? " is-preview" : ""}${props.className ? ` ${props.className}` : ""}`;
  const title = "미션 컨트롤";
  const nextAction = mission.parentEnvelope.record.nextAction;
  const activeSurface = mission.parentEnvelope.record.surface;
  const latestResult = mission.terminalResults[0] ?? null;
  const terminalBusy = !isPreview && mission.terminalSession.status === "running";
  const latestBridgeEvent = mission.bridgeEvents[0] ?? null;
  const coordination = mission.coordination ?? null;
  const verificationLabel =
    mission.parentEnvelope.record.verificationStatus === "verified"
      ? "완료"
      : mission.parentEnvelope.record.verificationStatus === "failed"
        ? "실패"
        : "대기";

  return (
    <section className={rootClassName} aria-label="Mission control">
      <header className="agents-mission-head">
        <div>
          <strong>{title}</strong>
          <p>
            {isPreview
              ? props.emptyCopy ?? "실행 전 미리보기입니다. 역할 실행을 시작하면 실제 미션 상태가 여기에 이어집니다."
              : mission.title}
          </p>
        </div>
        {isPreview ? (
          <span className="agents-mission-preview-chip">미리보기</span>
        ) : (
          <button className="agents-mission-clear-button" onClick={props.onClearMission} type="button">
            닫기
          </button>
        )}
      </header>

      <section className="agents-mission-summary" aria-label="Mission summary">
        <article className="agents-mission-summary-card">
          <span className="agents-mission-banner-kicker">현재 담당 역할</span>
          <strong>{mission.primaryRoleLabel}</strong>
          <p>{isPreview ? "역할 실행 전 미리보기 상태입니다." : "현재 선택한 역할의 실행 상태입니다."}</p>
        </article>
        <article className="agents-mission-summary-card">
          <span className="agents-mission-banner-kicker">현재 작업 위치</span>
          <strong>{surfaceLabel(activeSurface)}</strong>
          <p>{nextAction?.title ?? "다음 행동 없음"}</p>
        </article>
        <article className="agents-mission-summary-card agents-mission-summary-card-wide">
          <span className="agents-mission-banner-kicker">다음 행동</span>
          <strong>{nextAction?.detail ?? "새 작업을 시작하세요."}</strong>
          <p>검증 상태: {verificationLabel}</p>
        </article>
      </section>

      <details className="agents-mission-details">
        <summary>세부 보기</summary>

        <section className="agents-mission-role-section" aria-label="Mission roles">
          <div className="agents-mission-section-head">
            <strong>내부 실행 단계</strong>
            <p>이건 새 멀티에이전트가 아니라, 현재 역할을 처리하기 위한 3단계 흐름입니다.</p>
          </div>
          <div className="agents-mission-role-board">
            {mission.childEnvelopes.map((row) => (
              <article className="agents-mission-role-card" key={row.record.runId}>
                <div className="agents-mission-role-head">
                  <strong>{roleLabel(row.record.agentRole, mission.primaryRoleLabel)}</strong>
                  <span className={`agents-mission-status-chip is-${row.record.status}`}>{statusLabel(row.record.status)}</span>
                </div>
                <p>{row.record.summary || row.record.nextAction?.title || "요약 없음"}</p>
                <div className="agents-mission-role-meta">
                  <span>{surfaceLabel(row.record.surface)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        {coordination ? <MissionControlTeamRuntimeSection coordination={coordination} statusLabel={statusLabel} /> : null}

        <section className="agents-mission-grid">
          <article className="agents-mission-card">
            <div className="agents-mission-card-head">
              <strong>코드 작업 연동</strong>
              <small>{latestBridgeEvent ? "최근 상태 있음" : "대기 중"}</small>
            </div>
            <p className="agents-mission-card-copy">VS Code 쪽 작업 상태를 이 미션에 기록합니다.</p>
            <div className="agents-mission-button-row">
              {(["task_received", "patch_ready", "approval_requested"] as const).map((type) => (
                <button disabled={isPreview} key={type} onClick={() => props.onRecordCompanionEvent(type)} type="button">
                  {eventButtonLabel(type)}
                </button>
              ))}
            </div>
            <div className="agents-mission-status-note">
              <span>최근 상태</span>
              <p>{latestBridgeEvent ? `${eventTypeLabel(latestBridgeEvent.type)} · ${latestBridgeEvent.message}` : "아직 기록된 작업 상태가 없습니다."}</p>
            </div>
          </article>

          <article className="agents-mission-card agents-mission-card-terminal">
            <div className="agents-mission-card-head">
              <strong>작업용 터미널</strong>
              <small>{terminalStatusLabel(mission.terminalSession.status, terminalBusy)}</small>
            </div>
            <p className="agents-mission-card-copy">현재 미션에 허용된 검증 명령만 여기서 실행합니다.</p>
            <div className="agents-mission-command-list">
              {mission.terminalSession.allowedCommands.map((command) => (
                <button
                  key={command}
                  className="agents-mission-command-button"
                  disabled={terminalBusy || isPreview}
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
                    {latestResult.timedOut ? "시간 초과" : latestResult.exitCode === 0 ? "성공" : `실패 (${latestResult.exitCode})`}
                  </b>
                </div>
                <details className="agents-mission-terminal-details">
                  <summary>최근 출력 보기</summary>
                  <pre>{latestResult.stderrTail || latestResult.stdoutTail || "출력 없음"}</pre>
                </details>
              </div>
            ) : (
              <p className="agents-mission-muted">아직 실행 결과가 없습니다.</p>
            )}
          </article>

          <article className="agents-mission-card">
            <div className="agents-mission-card-head">
              <strong>Unity 검증</strong>
              <small>{verificationLabel}</small>
            </div>
            <p className="agents-mission-card-copy">플레이 모드 확인이나 에셋 등록 결과를 마지막에 남깁니다.</p>
            <div className="agents-mission-button-row">
              <button
                disabled={isPreview}
                onClick={() => props.onRecordUnityVerification(true, "Unity 검증 완료: 플레이/에셋 등록 성공")}
                type="button"
              >
                검증 완료
              </button>
              <button
                disabled={isPreview}
                onClick={() => props.onRecordUnityVerification(false, "Unity 검증 실패: 플레이 모드 또는 에셋 등록 이슈")}
                type="button"
              >
                검증 실패
              </button>
            </div>
            <div className="agents-mission-memory">
              <span>기능 메모</span>
              <p>{mission.featureMemory.summary}</p>
            </div>
          </article>
        </section>
      </details>
    </section>
  );
}
