import {
  applyCompanionEvent,
  applyImplementerRunResult,
  applyTaskTerminalResult,
  applyUnityVerification,
  createMissionControlState,
  type MissionControlState,
} from "../agentic/missionControl";
import type { AgenticRunEnvelope } from "../agentic/runContract";
import type { CompanionEventType, TaskTerminalResult } from "../types";
import { createRandomIdSuffix } from "../../../shared/lib/randomId";
import type { WorkSession, WorkSessionKind, WorkSessionNote, WorkSessionRecord, WorkSessionStatus } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function makeSessionId(prefix: WorkSessionKind): string {
  return `${prefix}-${Date.now().toString(36)}-${createRandomIdSuffix(8)}`;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function collectMissionArtifactPaths(mission: MissionControlState): string[] {
  return dedupeStrings([
    ...mission.parentEnvelope.artifacts.map((row) => row.path),
    ...mission.childEnvelopes.flatMap((row) => row.artifacts.map((artifact) => artifact.path)),
    ...mission.terminalResults.flatMap((row) => row.artifacts),
    ...mission.featureMemory.modifiedArtifacts,
    mission.bridgePaths.plannerBriefPath,
    mission.bridgePaths.companionContractPath,
    mission.bridgePaths.unityContractPath,
    mission.bridgePaths.featureMemoryPath,
    mission.bridgePaths.missionSnapshotPath,
  ]);
}

export function workSessionStatusLabel(status: WorkSessionStatus): string {
  if (status === "waiting") {
    return "대기";
  }
  if (status === "active") {
    return "진행";
  }
  if (status === "review") {
    return "검토";
  }
  if (status === "unity") {
    return "Unity 확인";
  }
  return "완료";
}

export function deriveRoleSessionStatus(mission: MissionControlState): WorkSessionStatus {
  if (mission.parentEnvelope.record.verificationStatus === "verified") {
    return "done";
  }
  if (mission.parentEnvelope.record.verificationStatus === "failed") {
    return "active";
  }
  const nextSurface = mission.parentEnvelope.record.nextAction?.surface ?? mission.parentEnvelope.record.surface ?? "rail";
  if (nextSurface === "unity") {
    return "unity";
  }
  const reviewer = mission.childEnvelopes.find((row) => row.record.agentRole === "reviewer");
  if (reviewer?.record.status === "done") {
    return "review";
  }
  const implementer = mission.childEnvelopes.find((row) => row.record.agentRole === "implementer");
  if (implementer?.record.status === "done" || implementer?.record.status === "error") {
    return "review";
  }
  return "active";
}

function deriveSessionMemorySummary(mission: MissionControlState): string {
  return String(mission.featureMemory.summary ?? "").trim() || String(mission.title ?? "").trim();
}

export function createRoleRunSession(input: {
  cwd: string;
  roleId: string;
  roleLabel: string;
  taskId: string;
  prompt: string;
  allowedCommands?: string[];
}): WorkSession {
  const mission = createMissionControlState({
    cwd: input.cwd,
    sourceTab: "workbench",
    roleId: input.roleId,
    roleLabel: input.roleLabel,
    taskId: input.taskId,
    prompt: input.prompt,
    allowedCommands: input.allowedCommands,
  });
  const now = nowIso();
  return {
    id: makeSessionId("role_run"),
    kind: "role_run",
    title: mission.title,
    roleId: input.roleId,
    roleLabel: input.roleLabel,
    taskId: input.taskId,
    status: deriveRoleSessionStatus(mission),
    surface: mission.parentEnvelope.record.nextAction?.surface ?? mission.parentEnvelope.record.surface ?? "vscode",
    nextAction: mission.parentEnvelope.record.nextAction ?? {
      surface: "vscode",
      title: "구현을 시작하세요",
      status: "ready",
    },
    verificationStatus: mission.parentEnvelope.record.verificationStatus ?? "pending",
    linkedRunIds: dedupeStrings([mission.parentEnvelope.record.runId, ...mission.childEnvelopes.map((row) => row.record.runId)]),
    artifactPaths: collectMissionArtifactPaths(mission),
    memorySummary: deriveSessionMemorySummary(mission),
    updatedAt: now,
    createdAt: now,
    prompt: input.prompt,
    commands: [...mission.terminalSession.allowedCommands],
    notes: [],
    reviewState: "pending",
    bridgeEvents: [...mission.bridgeEvents],
    terminalResults: [...mission.terminalResults],
    mission,
  };
}

export function createManualTaskSession(input: {
  title: string;
  taskId: string;
  prompt?: string;
  commands?: string[];
}): WorkSession {
  const now = nowIso();
  const title = String(input.title ?? "").trim() || String(input.taskId ?? "").trim() || "일반 작업";
  return {
    id: makeSessionId("manual_task"),
    kind: "manual_task",
    title,
    taskId: String(input.taskId ?? "").trim() || `TASK-${Date.now().toString(36).slice(-4).toUpperCase()}`,
    status: "waiting",
    surface: "rail",
    nextAction: {
      surface: "rail",
      title: "작업을 시작하세요",
      detail: "메모를 남기거나 검증 명령을 연결할 수 있습니다.",
      status: "ready",
    },
    verificationStatus: "pending",
    linkedRunIds: [],
    artifactPaths: [],
    memorySummary: String(input.prompt ?? "").trim(),
    updatedAt: now,
    createdAt: now,
    prompt: String(input.prompt ?? "").trim(),
    commands: dedupeStrings(input.commands ?? []),
    notes: [],
    reviewState: "none",
    bridgeEvents: [],
    terminalResults: [],
    mission: null,
  };
}

export function patchSessionFromMission(session: WorkSession, mission: MissionControlState): WorkSession {
  return {
    ...session,
    title: mission.title,
    surface: mission.parentEnvelope.record.nextAction?.surface ?? mission.parentEnvelope.record.surface ?? session.surface,
    status: deriveRoleSessionStatus(mission),
    nextAction: mission.parentEnvelope.record.nextAction ?? session.nextAction,
    verificationStatus: mission.parentEnvelope.record.verificationStatus ?? session.verificationStatus,
    linkedRunIds: dedupeStrings([mission.parentEnvelope.record.runId, ...mission.childEnvelopes.map((row) => row.record.runId)]),
    artifactPaths: collectMissionArtifactPaths(mission),
    memorySummary: deriveSessionMemorySummary(mission),
    updatedAt: nowIso(),
    commands: [...mission.terminalSession.allowedCommands],
    bridgeEvents: [...mission.bridgeEvents],
    terminalResults: [...mission.terminalResults],
    mission,
  };
}

export function appendSessionNote(session: WorkSession, body: string): WorkSession {
  const trimmed = String(body ?? "").trim();
  if (!trimmed) {
    return session;
  }
  const note: WorkSessionNote = {
    id: `note-${Date.now()}-${session.notes.length + 1}`,
    body: trimmed,
    createdAt: nowIso(),
  };
  return {
    ...session,
    updatedAt: note.createdAt,
    notes: [note, ...session.notes].slice(0, 24),
  };
}

export function appendSessionArtifactPath(session: WorkSession, path: string): WorkSession {
  const nextPath = String(path ?? "").trim();
  if (!nextPath) {
    return session;
  }
  return {
    ...session,
    updatedAt: nowIso(),
    artifactPaths: dedupeStrings([nextPath, ...session.artifactPaths]),
  };
}

export function applyRoleRunCompletion(
  session: WorkSession,
  payload: {
    runId: string;
    runStatus: "done" | "error";
    artifactPaths: string[];
    envelope?: AgenticRunEnvelope;
  },
): WorkSession {
  if (session.kind !== "role_run" || !session.mission) {
    return session;
  }
  const mission = applyImplementerRunResult(session.mission, {
    runId: payload.runId,
    status: payload.runStatus,
    artifactPaths: payload.artifactPaths,
    summary: payload.envelope?.record.summary,
    baseEnvelope: payload.envelope,
  });
  return patchSessionFromMission(session, mission);
}

export function applySessionCompanion(
  session: WorkSession,
  type: Exclude<CompanionEventType, "unity_verification_completed">,
  message?: string,
): WorkSession {
  if (session.kind === "role_run" && session.mission) {
    return patchSessionFromMission(
      session,
      applyCompanionEvent(session.mission, {
        source: "vscode",
        type,
        message: String(message ?? "").trim() || type,
      }),
    );
  }
  return {
    ...session,
    updatedAt: nowIso(),
    bridgeEvents: [
      {
        id: `event-${Date.now()}-${session.bridgeEvents.length + 1}`,
        at: nowIso(),
        runId: session.linkedRunIds[0] ?? session.id,
        taskId: session.taskId,
        source: "vscode" as const,
        type,
        message: String(message ?? "").trim() || type,
      },
      ...session.bridgeEvents,
    ].slice(0, 12),
    reviewState: type === "approval_requested" ? "pending" : session.reviewState,
  };
}

export function applySessionTaskResult(session: WorkSession, result: TaskTerminalResult): WorkSession {
  if (session.kind === "role_run" && session.mission) {
    return patchSessionFromMission(session, applyTaskTerminalResult(session.mission, result));
  }
  const ok = result.exitCode === 0 && !result.timedOut;
  return {
    ...session,
    updatedAt: result.at,
    status: ok ? "review" : "active",
    surface: ok ? "rail" : "vscode",
    nextAction: ok
      ? {
          surface: "rail",
          title: "검토 후 Unity 확인 여부를 결정하세요",
          detail: "일반 작업 카드를 다음 단계로 이동할 수 있습니다.",
          status: "ready",
        }
      : {
          surface: "vscode",
          title: "오류를 수정하고 다시 실행하세요",
          detail: result.stderrTail || result.stdoutTail || "명령 실행 실패",
          status: "blocked",
        },
    artifactPaths: dedupeStrings([...session.artifactPaths, ...result.artifacts]),
    terminalResults: [result, ...session.terminalResults].slice(0, 6),
  };
}

export function applySessionUnityResult(session: WorkSession, success: boolean, message: string): WorkSession {
  if (session.kind === "role_run" && session.mission) {
    return patchSessionFromMission(session, applyUnityVerification(session.mission, { success, message }));
  }
  return {
    ...session,
    updatedAt: nowIso(),
    status: success ? "done" : "active",
    surface: success ? "rail" : "vscode",
    verificationStatus: success ? "verified" : "failed",
    nextAction: success
      ? {
          surface: "rail",
          title: "작업 완료",
          detail: message,
          status: "done",
        }
      : {
          surface: "vscode",
          title: "Unity 확인 실패를 수정하세요",
          detail: message,
          status: "blocked",
        },
  };
}

export function patchManualSessionStatus(session: WorkSession, status: WorkSessionStatus): WorkSession {
  if (session.kind !== "manual_task") {
    return session;
  }
  const surface = status === "unity" ? "unity" : status === "done" ? "rail" : status === "review" ? "rail" : "vscode";
  return {
    ...session,
    status,
    surface,
    updatedAt: nowIso(),
    verificationStatus: status === "done" ? "verified" : session.verificationStatus,
    nextAction:
      status === "unity"
        ? {
            surface: "unity",
            title: "Unity에서 확인 후 결과를 기록하세요",
            status: "ready",
          }
        : status === "review"
          ? {
              surface: "rail",
              title: "검토 메모를 남기세요",
              status: "ready",
            }
          : status === "done"
            ? {
                surface: "rail",
                title: "작업 완료",
                status: "done",
              }
            : {
                surface,
                title: "작업을 계속 진행하세요",
                status: "ready",
              },
  };
}

export function sortSessions(sessions: WorkSession[]): WorkSession[] {
  return [...sessions].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function createEmptyWorkSessionRecord(): WorkSessionRecord {
  return {
    version: 1,
    sessions: [],
    selectedSessionId: null,
  };
}
