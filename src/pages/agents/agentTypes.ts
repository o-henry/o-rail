import type { TurnExecutor } from "../../features/workflow/domain";
import type { RuntimeModelOption } from "../../features/workflow/runtimeModelOptions";
import type {
  DashboardTopicId,
  DashboardTopicRunState,
  DashboardTopicSnapshot,
} from "../../features/dashboard/intelligence";
import type { MissionControlState } from "../../features/orchestration/agentic/missionControl";
import type { CompanionEventType } from "../../features/orchestration/types";
import type { CodexMultiAgentMode } from "./agentPrompt";
import type { AgentSetOptionLike, AgentThreadPreset } from "./agentSetPresets";

export type AgentQuickActionRequest = {
  prompt: string;
  modelValue: string;
  modelLabel: string;
  executor: TurnExecutor;
  turnModel?: string;
  selectedDataSourceIds?: string[];
  selectedDataSourceDetails?: string[];
};

export type AgentsPageProps = {
  onQuickAction: (request: AgentQuickActionRequest) => void;
  onRunRole?: (params: { roleId: string; taskId: string; prompt?: string; runId?: string }) => void;
  topicSnapshots: Partial<Record<DashboardTopicId, DashboardTopicSnapshot>>;
  codexMultiAgentMode: CodexMultiAgentMode;
  runStateByTopic: Record<DashboardTopicId, DashboardTopicRunState>;
  onRunDataTopic: (topic: DashboardTopicId, followupInstruction?: string) => void;
  launchRequest: AgentWorkspaceLaunchRequest | null;
  onOpenDataTab: () => void;
  missionControl: {
    activeMission: MissionControlState | null;
    clearMission: () => void;
    executeTaskCommand: (command: string) => void;
    launchMission: (params: {
      roleId: string;
      roleLabel: string;
      taskId: string;
      prompt: string;
      allowedCommands?: string[];
    }) => { parentRunId: string; implementerRunId: string };
    recordCompanionEvent: (type: Exclude<CompanionEventType, "unity_verification_completed">, message?: string) => void;
    recordUnityVerification: (success: boolean, message: string) => void;
  };
};

export type AgentWorkspaceLaunchRequest = {
  id: number;
  setId: string;
  draft?: string;
};

export type AgentThread = AgentThreadPreset & {
  status: "preset" | "custom";
};

export type AttachedFile = {
  id: string;
  name: string;
};

export type AgentSetOption = AgentSetOptionLike;

export type AgentSetState = {
  setMission: string;
  threads: AgentThread[];
  activeThreadId: string;
  draft: string;
  attachedFiles: AttachedFile[];
  dashboardInsights: string[];
  enabledAttachedFileNames: string[];
  enabledDataSourceIds: string[];
  requestHistory: AgentRequestHistoryItem[];
};

export type AgentSetPresetSnapshot = {
  mission: string;
  defaultDraft: string;
  threads: AgentThread[];
};

export type AgentModelOption = RuntimeModelOption;

export type AgentSetGroup = {
  id: string;
  title: string;
  items: AgentSetOption[];
};

export type AgentDataSourceItem = {
  id: string;
  label: string;
  detail: string;
  topic: DashboardTopicId;
  runId: string;
  snapshotAt: string;
};

export type AgentRequestHistoryItem = {
  id: string;
  threadId: string;
  threadName: string;
  prompt: string;
  createdAt: string;
};
