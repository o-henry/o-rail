import type { TurnExecutor } from "../../features/workflow/domain";
import type { RuntimeModelOption } from "../../features/workflow/runtimeModelOptions";
import type {
  DashboardTopicId,
  DashboardTopicRunState,
  DashboardTopicSnapshot,
} from "../../features/dashboard/intelligence";
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
  topicSnapshots: Partial<Record<DashboardTopicId, DashboardTopicSnapshot>>;
  codexMultiAgentMode: CodexMultiAgentMode;
  runStateByTopic: Record<DashboardTopicId, DashboardTopicRunState>;
  onRunDataTopic: (topic: DashboardTopicId, followupInstruction?: string) => void;
  launchRequest: AgentWorkspaceLaunchRequest | null;
  onOpenDataTab: () => void;
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
