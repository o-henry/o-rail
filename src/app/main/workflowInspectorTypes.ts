import type { CostPreset, PresetKind, TurnConfig, TurnExecutor } from "../../features/workflow/domain";
import type { TurnReasoningLevelLabel } from "../../features/workflow/reasoningLevels";
import type { GateConfig, GraphData, GraphNode, KnowledgeConfig, NodeType, TransformConfig } from "../../features/workflow/types";
import type { HandoffRecord, StudioRoleId } from "../../features/studio/handoffTypes";
import type { WorkflowGraphViewMode } from "../../features/workflow/viaGraph";

export type SelectOption = {
  value: string;
  label: string;
};

export type WorkflowInspectorToolsProps = {
  cwd: string;
  simpleWorkflowUI: boolean;
  addNode: (type: NodeType) => void;
  addRoleNode: (roleId: StudioRoleId, includeResearch: boolean) => void;
  addCrawlerNode: () => void;
  graphViewMode: WorkflowGraphViewMode;
  onSetGraphViewMode: (mode: WorkflowGraphViewMode) => void;
  applyPreset: (preset: PresetKind) => void;
  applyCostPreset: (preset: CostPreset) => void;
  isPresetKind: (value: string) => value is PresetKind;
  isCostPreset: (value: string) => value is CostPreset;
  costPreset: CostPreset;
  costPresetOptions: SelectOption[];
  presetTemplateOptions: SelectOption[];
  graphFiles: string[];
  selectedGraphFileName: string;
  setSelectedGraphFileName: (value: string) => void;
  setGraphFileName: (value: string) => void;
  loadGraph: (value: string) => void;
  saveGraph: () => void;
  onOpenRenameGraph: () => void;
  deleteGraph: () => void;
  refreshGraphFiles: () => void;
  graphRenameOpen: boolean;
  setGraphRenameDraft: (value: string) => void;
  renameGraph: () => Promise<void>;
  onCloseRenameGraph: () => void;
  graphRenameDraft: string;
  onOpenKnowledgeFilePicker: () => void;
  graphKnowledge: KnowledgeConfig;
  onToggleKnowledgeFileEnabled: (id: string) => void;
  onRemoveKnowledgeFile: (id: string) => void;
  applyGraphChange: (updater: (prev: GraphData) => GraphData) => void;
  defaultKnowledgeConfig: () => KnowledgeConfig;
  knowledgeDefaultTopK: number;
  knowledgeDefaultMaxChars: number;
  knowledgeTopKOptions: SelectOption[];
  knowledgeMaxCharsOptions: SelectOption[];
  selectedKnowledgeMaxCharsOption: string;
  handoffRecords: HandoffRecord[];
  selectedHandoffId: string;
  handoffRoleOptions: SelectOption[];
  handoffFromRole: StudioRoleId;
  handoffTaskId: string;
  handoffRequestText: string;
  setSelectedHandoffId: (id: string) => void;
  setHandoffFromRole: (value: StudioRoleId) => void;
  setHandoffTaskId: (value: string) => void;
  setHandoffRequestText: (value: string) => void;
  createHandoff: () => void;
  updateHandoffStatus: (status: HandoffRecord["status"], rejectReason?: string) => void;
  consumeHandoff: () => void;
};

export type WorkflowUnityAutomationProps = {
  cwd: string;
  applyPreset: (preset: PresetKind) => void;
  isPresetKind: (value: string) => value is PresetKind;
  presetTemplateOptions: SelectOption[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

export type WorkflowInspectorNodeProps = {
  nodeSettingsTitle: string;
  simpleWorkflowUI: boolean;
  selectedNode: GraphNode | null;
  selectedTurnExecutor: TurnExecutor;
  updateSelectedNodeConfig: (key: string, value: unknown) => void;
  turnExecutorOptions: TurnExecutor[];
  turnExecutorLabel: (value: TurnExecutor) => string;
  turnModelOptions: string[];
  turnReasoningLevelOptions: TurnReasoningLevelLabel[];
  model: string;
  cwd: string;
  selectedTurnConfig: TurnConfig | null;
  selectedQualityProfile: string;
  qualityProfileOptions: SelectOption[];
  selectedQualityThresholdOption: string;
  qualityThresholdOptions: SelectOption[];
  normalizeQualityThreshold: (value: string | number | null | undefined) => number;
  artifactTypeOptions: SelectOption[];
  selectedArtifactType: string;
  outgoingNodeOptions: SelectOption[];
  roleInternalExpanded: boolean;
  toggleRoleInternalExpanded: () => void;
  addRolePerspectivePass: () => void;
  addRoleReviewPass: () => void;
};

export type NodeConfigCasts = {
  turn: (node: GraphNode) => TurnConfig;
  transform: (node: GraphNode) => TransformConfig;
  gate: (node: GraphNode) => GateConfig;
};
