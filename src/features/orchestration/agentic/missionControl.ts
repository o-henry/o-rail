import {
  appendRunArtifact,
  createAgenticRunEnvelope,
  createAgenticRunId,
  patchRunRecord,
  patchRunStage,
  patchRunStatus,
  type AgenticRunEnvelope,
} from "./runContract";
import type { AgenticVerificationStatus, CompanionEvent, TaskTerminalResult } from "../types";
import type { MissionControlLaunchInput, MissionControlState } from "./missionControlTypes";
import {
  buildMissionFeatureMemory,
  buildMissionRunDir,
  missionChildRunIds,
  missionNowIso,
  missionTitle,
  normalizeMissionCommands,
  patchMissionChildByRole,
  trimMissionTextTail,
  withMissionRunSummary,
} from "./missionControlUtils";
export type { MissionControlLaunchInput, MissionControlState } from "./missionControlTypes";

export function createMissionControlState(input: MissionControlLaunchInput): MissionControlState {
  const parentRunId = createAgenticRunId("mission");
  const plannerRunId = createAgenticRunId("planner");
  const implementerRunId = createAgenticRunId("implementer");
  const reviewerRunId = createAgenticRunId("reviewer");
  const allowedCommands = normalizeMissionCommands(input.allowedCommands ?? [], input.prompt);
  const title = missionTitle(input.taskId, input.roleLabel, input.prompt);
  const runDir = buildMissionRunDir(input.cwd, parentRunId);
  const plannerBriefPath = `${runDir}/planner-brief.json`;
  const companionContractPath = `${runDir}/companion.contract.json`;
  const unityContractPath = `${runDir}/unity.contract.json`;
  const featureMemoryPath = `${runDir}/feature-memory.json`;
  const missionSnapshotPath = `${runDir}/mission-control.json`;

  let plannerEnvelope = createAgenticRunEnvelope({
    runId: plannerRunId,
    runKind: "studio_role",
    sourceTab: input.sourceTab,
    queueKey: `mission:${parentRunId}:planner`,
    roleId: "planner",
    taskId: input.taskId,
    surface: "rail",
    agentRole: "planner",
    parentRunId,
    verificationStatus: "pending",
    nextAction: {
      surface: "rail",
      title: "요구사항 분해 완료",
      detail: "Implementer와 Reviewer를 위한 작업 계약을 생성했습니다.",
      status: "done",
    },
    summary: `${input.roleLabel} 작업 분해`,
  });
  plannerEnvelope = patchRunStage(plannerEnvelope, "codex", "done", "Planner 분해 완료");
  plannerEnvelope = patchRunStatus(plannerEnvelope, "done");
  plannerEnvelope = withMissionRunSummary(plannerEnvelope, "Planner 분해 완료", plannerBriefPath);

  let implementerEnvelope = createAgenticRunEnvelope({
    runId: implementerRunId,
    runKind: "studio_role",
    sourceTab: input.sourceTab,
    queueKey: `mission:${parentRunId}:implementer`,
    roleId: input.roleId,
    taskId: input.taskId,
    surface: "vscode",
    agentRole: "implementer",
    parentRunId,
    verificationStatus: "pending",
    nextAction: {
      surface: "vscode",
      title: "VS Code에서 구현 진행",
      detail: "Companion contract와 작업 지시를 확인하세요.",
      cta: "Open companion contract",
      status: "ready",
    },
    summary: `${input.roleLabel} 구현 대기`,
  });

  let reviewerEnvelope = createAgenticRunEnvelope({
    runId: reviewerRunId,
    runKind: "studio_role",
    sourceTab: input.sourceTab,
    queueKey: `mission:${parentRunId}:reviewer`,
    roleId: "reviewer",
    taskId: input.taskId,
    surface: "rail",
    agentRole: "reviewer",
    parentRunId,
    verificationStatus: "pending",
    nextAction: {
      surface: "rail",
      title: "Implementer 산출물 대기",
      detail: "터미널/Unity 결과가 들어오면 검토를 진행합니다.",
      status: "blocked",
    },
    summary: "Reviewer 대기",
  });

  const children = [plannerEnvelope, implementerEnvelope, reviewerEnvelope];
  let parentEnvelope = createAgenticRunEnvelope({
    runId: parentRunId,
    runKind: "studio_role",
    sourceTab: input.sourceTab,
    queueKey: `mission:${input.taskId}`,
    roleId: input.roleId,
    taskId: input.taskId,
    surface: "vscode",
    childRunIds: missionChildRunIds(children),
    verificationStatus: "pending",
    nextAction: {
      surface: "vscode",
      title: "VS Code에서 구현을 시작하세요",
      detail: allowedCommands[0] ? `다음 검증 명령: ${allowedCommands[0]}` : "Companion contract를 확인하세요.",
      cta: "Start implementer run",
      status: "ready",
    },
    summary: title,
  });
  parentEnvelope = patchRunStatus(parentEnvelope, "running");
  parentEnvelope = appendRunArtifact(parentEnvelope, {
    kind: "snapshot",
    path: plannerBriefPath,
  });
  parentEnvelope = appendRunArtifact(parentEnvelope, {
    kind: "raw",
    path: companionContractPath,
  });
  parentEnvelope = appendRunArtifact(parentEnvelope, {
    kind: "raw",
    path: unityContractPath,
  });
  parentEnvelope = appendRunArtifact(parentEnvelope, {
    kind: "snapshot",
    path: featureMemoryPath,
  });
  parentEnvelope = appendRunArtifact(parentEnvelope, {
    kind: "snapshot",
    path: missionSnapshotPath,
  });

  return {
    parentEnvelope,
    childEnvelopes: children,
    primaryRoleId: input.roleId,
    primaryRoleLabel: input.roleLabel,
    prompt: input.prompt,
    title,
    bridgeEvents: [],
    terminalSession: {
      runId: parentRunId,
      taskId: input.taskId,
      cwd: input.cwd,
      allowedCommands,
      status: "idle",
    },
    terminalResults: [],
    featureMemory: buildMissionFeatureMemory({
      parentRunId,
      taskId: input.taskId,
      title,
      prompt: input.prompt,
      artifactPaths: [],
      verificationStatus: "pending",
      openRisks: ["Unity verification pending"],
    }),
    bridgePaths: {
      plannerBriefPath,
      companionContractPath,
      unityContractPath,
      featureMemoryPath,
      missionSnapshotPath,
    },
  };
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
              cta: "Run command",
              status: "ready",
            }
          : {
              surface: "vscode",
              title: "Implementer 실패 검토",
              detail: params.summary ?? "실패한 요청을 확인하고 다시 실행하세요.",
              status: "blocked",
            },
    });
    return artifacts.reduce(
      (acc, path) =>
        appendRunArtifact(acc, {
          kind: "raw",
          path,
        }),
      next,
    );
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
            cta: "Run command",
            status: "ready",
          }
        : {
            surface: "rail",
            title: "Implementer 오류를 검토하세요",
            detail: params.summary ?? "역할 실행이 실패했습니다.",
            status: "blocked",
          },
  });
  return {
    ...state,
    parentEnvelope: artifacts.reduce(
      (acc, path) =>
        appendRunArtifact(acc, {
          kind: "raw",
          path,
        }),
      nextParent,
    ),
    childEnvelopes: nextChildren,
    featureMemory: buildMissionFeatureMemory({
      parentRunId: state.parentEnvelope.record.runId,
      taskId: state.parentEnvelope.record.taskId ?? state.terminalSession.taskId,
      title: state.title,
      prompt: state.prompt,
      artifactPaths: artifacts,
      verificationStatus: state.parentEnvelope.record.verificationStatus ?? "pending",
      openRisks: params.status === "done" ? ["Terminal verification pending"] : ["Implementer run failed"],
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
            cta: "Run command",
            status: "ready",
          }
        : state.parentEnvelope.record.nextAction,
  });
  return {
    ...state,
    parentEnvelope: nextParent,
    bridgeEvents: [nextEvent, ...state.bridgeEvents].slice(0, 12),
  };
}

export function applyTaskTerminalResult(
  state: MissionControlState,
  result: TaskTerminalResult,
): MissionControlState {
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
            detail: "검증 결과를 Mission Control에 기록하세요.",
            cta: "Record Unity verification",
            status: "ready",
          }
        : {
            surface: "vscode",
            title: "오류를 수정하고 다시 실행",
            detail: trimMissionTextTail(result.stderrTail || result.stdoutTail || "검증 명령 실패"),
            status: "blocked",
          },
    });
    return result.artifacts.reduce(
      (acc: AgenticRunEnvelope, path: string) =>
        appendRunArtifact(acc, {
          kind: "log",
          path,
        }),
      next,
    );
  });
  const nextParent = patchRunRecord(state.parentEnvelope, {
    surface: ok ? "unity" : "vscode",
    nextAction: ok
      ? {
          surface: "unity",
          title: "Unity에서 플레이/에셋 검증",
          detail: "플레이 모드 확인 또는 에셋 등록 결과를 기록하세요.",
          cta: "Record Unity verification",
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
    parentEnvelope: result.artifacts.reduce(
      (acc: AgenticRunEnvelope, path: string) =>
        appendRunArtifact(acc, {
          kind: "log",
          path,
        }),
      nextParent,
    ),
    childEnvelopes: nextChildren,
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
      artifactPaths: [
        ...state.featureMemory.modifiedArtifacts,
        ...result.artifacts,
      ],
      verificationStatus: state.parentEnvelope.record.verificationStatus ?? "pending",
      openRisks: ok ? ["Unity verification pending"] : ["Terminal command failed"],
    }),
  };
}

export function applyUnityVerification(
  state: MissionControlState,
  params: {
    success: boolean;
    message: string;
  },
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
