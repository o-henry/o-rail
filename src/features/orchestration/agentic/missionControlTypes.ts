import type { AgenticFeatureMemory, CompanionEvent, TaskTerminalResult, TaskTerminalSession } from "../types";
import type { TeamRuntimeSession } from "./coordinationTypes";
import type { AgenticRunEnvelope, AgenticRunSourceTab } from "./runContract";

export type MissionControlState = {
  parentEnvelope: AgenticRunEnvelope;
  childEnvelopes: AgenticRunEnvelope[];
  primaryRoleId: string;
  primaryRoleLabel: string;
  prompt: string;
  title: string;
  bridgeEvents: CompanionEvent[];
  terminalSession: TaskTerminalSession;
  terminalResults: TaskTerminalResult[];
  featureMemory: AgenticFeatureMemory;
  coordination?: TeamRuntimeSession | null;
  bridgePaths: {
    plannerBriefPath: string;
    companionContractPath: string;
    unityContractPath: string;
    featureMemoryPath: string;
    missionSnapshotPath: string;
  };
};

export type MissionControlLaunchInput = {
  cwd: string;
  sourceTab: AgenticRunSourceTab;
  roleId: string;
  roleLabel: string;
  taskId: string;
  prompt: string;
  allowedCommands?: string[];
};
