import { appendRunArtifact, patchRunRecord, patchRunStage, patchRunStatus, type AgenticRunEnvelope } from "./runContract";
import type { AgenticVerificationStatus, CompanionEvent, TaskTerminalResult } from "../types";
import type { MissionControlState } from "./missionControlTypes";
import type { TeamRuntimeSession } from "./coordinationTypes";
import { buildMissionFeatureMemory, missionNowIso, patchMissionChildByRole, trimMissionTextTail } from "./missionControlUtils";

function patchMissionCoordination(
  coordination: TeamRuntimeSession | null | undefined,
  updater: (current: TeamRuntimeSession) => TeamRuntimeSession,
): TeamRuntimeSession | null {
  return coordination ? updater(coordination) : null;
}

export function applyImplementerRunResult(
  state: MissionControlState,
  params: {
    runId: string;
    status: "done" | "error";
    artifactPaths: string[];
    summary?: string;
    baseEnvelope?: AgenticRunEnvelope;
  },
): MissionControlState {
  const artifacts = [...new Set(params.artifactPaths.map((row) => String(row ?? "").trim()).filter(Boolean))];
  const nextChildren = patchMissionChildByRole(state.childEnvelopes, "implementer", (row) => {
    let next = params.baseEnvelope
      ? patchRunRecord(params.baseEnvelope, {
          surface: row.record.surface,
          agentRole: row.record.agentRole,
          parentRunId: row.record.parentRunId,
          nextAction: row.record.nextAction,
          verificationStatus: row.record.verificationStatus,
          summary: row.record.summary,
        })
      : row;
    next = patchRunStatus(next, params.status);
    next = patchRunStage(next, "codex", params.status === "done" ? "done" : "error", params.summary ?? "");
    next = patchRunRecord(next, {
      handoffArtifactIds: artifacts,
      summary: params.summary ?? row.record.summary,
      nextAction:
        params.status === "done"
          ? {
              surface: "vscode",
              title: "작업용 터미널에서 검증 명령 실행",
              detail: state.terminalSession.allowedCommands[0] ?? "허용된 명령을 실행하세요.",
              cta: "명령 실행",
              status: "ready",
            }
          : {
              surface: "vscode",
              title: "구현 실패 검토",
              detail: params.summary ?? "실패한 요청을 확인하고 다시 실행하세요.",
              status: "blocked",
            },
    });
    return artifacts.reduce((acc, path) => appendRunArtifact(acc, { kind: "raw", path }), next);
  });
  const nextParent = patchRunRecord(state.parentEnvelope, {
    surface: "vscode",
    handoffArtifactIds: artifacts,
    nextAction:
      params.status === "done"
        ? {
            surface: "vscode",
            title: "작업용 터미널에서 검증 명령 실행",
            detail: state.terminalSession.allowedCommands[0] ?? "허용된 명령을 실행하세요.",
            cta: "명령 실행",
            status: "ready",
          }
        : {
            surface: "rail",
            title: "구현 오류를 검토하세요",
            detail: params.summary ?? "역할 실행이 실패했습니다.",
            status: "blocked",
          },
  });
  return {
    ...state,
    parentEnvelope: artifacts.reduce((acc, path) => appendRunArtifact(acc, { kind: "raw", path }), nextParent),
    childEnvelopes: nextChildren,
    coordination: patchMissionCoordination(state.coordination, (coordination) => ({
      ...coordination,
      status: params.status === "done" ? "running" : "blocked",
      nextAction:
        params.status === "done"
          ? (
            state.terminalSession.allowedCommands[0]
              ? `Run terminal verification: ${state.terminalSession.allowedCommands[0]}`
              : "Run terminal verification for the implementation."
          )
          : "Review the implementation failure and rerun the task.",
      blockedReason: params.status === "done" ? null : (params.summary ?? "Implementation run failed."),
      resumeHint: params.status === "done" ? null : "Retry the implementer flow after fixing the failure.",
      lanes: coordination.lanes.map((lane) =>
        lane.id === "implementer"
          ? {
              ...lane,
              status: params.status === "done" ? "done" : "failed",
              summary: params.summary ?? (params.status === "done" ? "Implementation finished." : "Implementation failed."),
              updatedAt: missionNowIso(),
            }
          : lane.id === "reviewer"
            ? {
                ...lane,
                status: params.status === "done" ? "review" : "blocked",
                summary: params.status === "done" ? "Waiting for terminal and Unity verification." : "Blocked until the implementer succeeds.",
                updatedAt: missionNowIso(),
              }
            : lane,
      ),
      updatedAt: missionNowIso(),
    })),
    featureMemory: buildMissionFeatureMemory({
      parentRunId: state.parentEnvelope.record.runId,
      taskId: state.parentEnvelope.record.taskId ?? state.terminalSession.taskId,
      title: state.title,
      prompt: state.prompt,
      artifactPaths: artifacts,
      verificationStatus: state.parentEnvelope.record.verificationStatus ?? "pending",
      openRisks: params.status === "done" ? ["터미널 검증 대기"] : ["구현 실행 실패"],
    }),
  };
}

export function applyCompanionEvent(
  state: MissionControlState,
  event: Omit<CompanionEvent, "id" | "at" | "runId" | "taskId">,
): MissionControlState {
  const nextEvent: CompanionEvent = {
    id: `event-${Date.now()}-${state.bridgeEvents.length + 1}`,
    at: missionNowIso(),
    runId: state.parentEnvelope.record.runId,
    taskId: state.terminalSession.taskId,
    ...event,
  };
  const nextParent = patchRunRecord(state.parentEnvelope, {
    surface: event.source,
    nextAction:
      event.type === "patch_ready"
        ? {
            surface: "vscode",
            title: "작업용 터미널에서 테스트를 실행하세요",
            detail: state.terminalSession.allowedCommands[0] ?? "허용된 명령을 실행하세요.",
            cta: "명령 실행",
            status: "ready",
          }
        : state.parentEnvelope.record.nextAction,
  });
  return {
    ...state,
    parentEnvelope: nextParent,
    bridgeEvents: [nextEvent, ...state.bridgeEvents].slice(0, 12),
    coordination: patchMissionCoordination(state.coordination, (coordination) => ({
      ...coordination,
      nextAction: nextParent.record.nextAction?.detail ?? coordination.nextAction,
      updatedAt: nextEvent.at,
    })),
  };
}

export function applyTaskTerminalResult(state: MissionControlState, result: TaskTerminalResult): MissionControlState {
  const ok = result.exitCode === 0 && !result.timedOut;
  const nextChildren = patchMissionChildByRole(state.childEnvelopes, "reviewer", (row) => {
    let next = patchRunStage(
      row,
      "critic",
      ok ? "done" : "error",
      ok ? "검증 명령 통과" : trimMissionTextTail(result.stderrTail || result.stdoutTail || "검증 명령 실패"),
      ok ? undefined : trimMissionTextTail(result.stderrTail || result.stdoutTail || "검증 명령 실패"),
    );
    next = patchRunStatus(next, ok ? "done" : "error");
    next = patchRunRecord(next, {
      surface: ok ? "unity" : "vscode",
      nextAction: ok
        ? {
            surface: "unity",
            title: "Unity에서 플레이/에셋 검증",
            detail: "검증 결과를 미션 컨트롤에 기록하세요.",
            cta: "Unity 검증 기록",
            status: "ready",
          }
        : {
            surface: "vscode",
            title: "오류를 수정하고 다시 실행",
            detail: trimMissionTextTail(result.stderrTail || result.stdoutTail || "검증 명령 실패"),
            status: "blocked",
          },
    });
    return result.artifacts.reduce((acc: AgenticRunEnvelope, path: string) => appendRunArtifact(acc, { kind: "log", path }), next);
  });
  const nextParent = patchRunRecord(state.parentEnvelope, {
    surface: ok ? "unity" : "vscode",
    nextAction: ok
      ? {
          surface: "unity",
          title: "Unity에서 플레이/에셋 검증",
          detail: "플레이 모드 확인 또는 에셋 등록 결과를 기록하세요.",
          cta: "Unity 검증 기록",
          status: "ready",
        }
      : {
          surface: "vscode",
          title: "실패한 명령을 수정하고 재실행",
          detail: trimMissionTextTail(result.stderrTail || result.stdoutTail || "검증 명령 실패"),
          status: "blocked",
        },
  });
  return {
    ...state,
    parentEnvelope: result.artifacts.reduce((acc: AgenticRunEnvelope, path: string) => appendRunArtifact(acc, { kind: "log", path }), nextParent),
    childEnvelopes: nextChildren,
    coordination: patchMissionCoordination(state.coordination, (coordination) => ({
      ...coordination,
      status: ok ? "waiting_review" : "blocked",
      nextAction: ok
        ? "Record Unity verification to finish the mission."
        : "Fix the failed terminal verification and rerun it.",
      blockedReason: ok ? null : trimMissionTextTail(result.stderrTail || result.stdoutTail || "검증 명령 실패"),
      resumeHint: ok ? "Record Unity verification when ready." : "Re-run the terminal verification after fixing the issue.",
      lanes: coordination.lanes.map((lane) =>
        lane.id === "reviewer"
          ? {
              ...lane,
              status: ok ? "review" : "failed",
              summary: ok ? "Terminal verification passed. Waiting for Unity verification." : "Terminal verification failed.",
              updatedAt: result.at,
            }
          : lane,
      ),
      updatedAt: result.at,
    })),
    bridgeEvents: [
      {
        id: `event-${Date.now()}-${state.bridgeEvents.length + 1}`,
        at: missionNowIso(),
        runId: state.parentEnvelope.record.runId,
        taskId: state.terminalSession.taskId,
        source: "vscode",
        type: ok ? "test_passed" : "test_failed",
        message: ok ? `명령 통과: ${result.command}` : `명령 실패: ${result.command}`,
      } satisfies CompanionEvent,
      ...state.bridgeEvents,
    ].slice(0, 12),
    terminalSession: {
      ...state.terminalSession,
      status: ok ? "done" : "error",
      lastCommand: result.command,
      lastResultAt: result.at,
    },
    terminalResults: [result, ...state.terminalResults].slice(0, 6),
    featureMemory: buildMissionFeatureMemory({
      parentRunId: state.parentEnvelope.record.runId,
      taskId: state.terminalSession.taskId,
      title: state.title,
      prompt: state.prompt,
      artifactPaths: [...state.featureMemory.modifiedArtifacts, ...result.artifacts],
      verificationStatus: state.parentEnvelope.record.verificationStatus ?? "pending",
      openRisks: ok ? ["Unity 검증 대기"] : ["터미널 명령 실패"],
    }),
  };
}

export function applyUnityVerification(
  state: MissionControlState,
  params: { success: boolean; message: string },
): MissionControlState {
  const verificationStatus: AgenticVerificationStatus = params.success ? "verified" : "failed";
  const nextParentBase = patchRunRecord(state.parentEnvelope, {
    surface: params.success ? "rail" : "vscode",
    verificationStatus,
    nextAction: params.success
      ? {
          surface: "rail",
          title: "기능 검증 완료",
          detail: "다음 기능 작업을 시작할 수 있습니다.",
          status: "done",
        }
      : {
          surface: "vscode",
          title: "Unity 실패를 수정하세요",
          detail: params.message,
          status: "blocked",
        },
  });
  const nextParent = patchRunStatus(nextParentBase, params.success ? "done" : "running");
  return {
    ...state,
    parentEnvelope: nextParent,
    coordination: patchMissionCoordination(state.coordination, (coordination) => ({
      ...coordination,
      status: params.success ? "completed" : "needs_resume",
      nextAction: params.success ? "Mission complete." : "Resume implementation to address the failed Unity verification.",
      blockedReason: params.success ? null : params.message,
      resumeHint: params.success ? null : "Fix the Unity issue and rerun verification.",
      lanes: coordination.lanes.map((lane) =>
        lane.id === "reviewer"
          ? {
              ...lane,
              status: params.success ? "done" : "blocked",
              summary: params.success ? "Unity verification completed." : params.message,
              updatedAt: missionNowIso(),
            }
          : lane.id === "implementer" && params.success
            ? { ...lane, status: "done", updatedAt: missionNowIso() }
            : lane,
      ),
      updatedAt: missionNowIso(),
    })),
    bridgeEvents: [
      {
        id: `event-${Date.now()}-${state.bridgeEvents.length + 1}`,
        at: missionNowIso(),
        runId: state.parentEnvelope.record.runId,
        taskId: state.terminalSession.taskId,
        source: "unity",
        type: "unity_verification_completed",
        message: params.message,
        payload: { success: params.success },
      } satisfies CompanionEvent,
      ...state.bridgeEvents,
    ].slice(0, 12),
    featureMemory: buildMissionFeatureMemory({
      parentRunId: state.parentEnvelope.record.runId,
      taskId: state.terminalSession.taskId,
      title: state.title,
      prompt: state.prompt,
      artifactPaths: state.featureMemory.modifiedArtifacts,
      verificationStatus,
      openRisks: params.success ? [] : [params.message],
    }),
  };
}
