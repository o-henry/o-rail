import {
  createAgenticRunEnvelope,
  createAgenticRunId,
  patchRunStage,
  patchRunStatus,
} from "./runContract";
import { createCoordinationState, readyCoordinationForExecution, startCoordinationRun } from "./coordination";
import type { MissionControlLaunchInput, MissionControlState } from "./missionControlTypes";
import {
  buildMissionFeatureMemory,
  buildMissionRunDir,
  missionChildRunIds,
  missionNowIso,
  missionTitle,
  normalizeMissionCommands,
  withMissionRunSummary,
} from "./missionControlUtils";
import { applyImplementerRunResult, applyTaskTerminalResult } from "./missionControlTransitions";
export {
  applyCompanionEvent,
  applyImplementerRunResult,
  applyTaskTerminalResult,
  applyUnityVerification,
} from "./missionControlTransitions";
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
      detail: "구현 담당과 검토 담당을 위한 작업 계약을 생성했습니다.",
      status: "done",
    },
    summary: `${input.roleLabel} 작업 분해`,
  });
  plannerEnvelope = patchRunStage(plannerEnvelope, "codex", "done", "기획 정리 완료");
  plannerEnvelope = patchRunStatus(plannerEnvelope, "done");
  plannerEnvelope = withMissionRunSummary(plannerEnvelope, "기획 정리 완료", plannerBriefPath);

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
      detail: "연동 계약과 작업 지시를 확인하세요.",
      cta: "연동 계약 열기",
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
      title: "구현 산출물 대기",
      detail: "터미널/Unity 결과가 들어오면 검토를 진행합니다.",
      status: "blocked",
    },
    summary: "검토 대기",
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
      detail: allowedCommands[0] ? `다음 검증 명령: ${allowedCommands[0]}` : "연동 계약을 확인하세요.",
      cta: "구현 시작",
      status: "ready",
    },
    summary: title,
  });
  parentEnvelope = patchRunStatus(parentEnvelope, "running");
  parentEnvelope.artifacts.push(
    { kind: "snapshot", path: plannerBriefPath },
    { kind: "raw", path: companionContractPath },
    { kind: "raw", path: unityContractPath },
    { kind: "snapshot", path: featureMemoryPath },
    { kind: "snapshot", path: missionSnapshotPath },
  );
  const launchedCoordination = startCoordinationRun(
    readyCoordinationForExecution(createCoordinationState({
      threadId: parentRunId,
      prompt: input.prompt,
      requestedRoleIds: ["planner", "implementer", "reviewer"],
      overrideMode: "team",
      at: missionNowIso(),
    })),
    missionNowIso(),
  );

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
      openRisks: ["Unity 검증 대기"],
    }),
    coordination: launchedCoordination.teamSession,
    bridgePaths: {
      plannerBriefPath,
      companionContractPath,
      unityContractPath,
      featureMemoryPath,
      missionSnapshotPath,
    },
  };
}

export function createMissionControlPreviewState(): MissionControlState {
  const seeded = createMissionControlState({
    cwd: "/workspace",
    sourceTab: "workflow",
    roleId: "client_programmer",
    roleLabel: "클라이언트",
    taskId: "PLAYER-JUMP",
    prompt: "플레이어 점프 동작을 구현하고 Unity에서 확인할 준비를 합니다.",
    allowedCommands: ["dotnet build", "npm run test"],
  });
  const implementerRunId =
    seeded.childEnvelopes.find((row) => row.record.agentRole === "implementer")?.record.runId ?? "";
  const afterImplementer = applyImplementerRunResult(seeded, {
    runId: implementerRunId,
    status: "done",
    artifactPaths: ["/workspace/.rail/studio_runs/PLAYER-JUMP/PlayerController.diff"],
    summary: "플레이어 이동/점프 로직 변경안 준비",
  });
  const preview = applyTaskTerminalResult(afterImplementer, {
    id: "terminal-preview",
    at: missionNowIso(),
    runId: afterImplementer.parentEnvelope.record.runId,
    taskId: afterImplementer.terminalSession.taskId,
    command: afterImplementer.terminalSession.allowedCommands[0] ?? "dotnet build",
    exitCode: 0,
    stdoutTail: "Build succeeded.\n0 Warning(s)\n0 Error(s)",
    stderrTail: "",
    timedOut: false,
    durationMs: 1480,
    artifacts: ["/workspace/.rail/studio_runs/PLAYER-JUMP/terminal-preview.json"],
  });
  return preview;
}
