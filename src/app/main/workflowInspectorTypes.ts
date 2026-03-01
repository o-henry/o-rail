import type { CostPreset, PresetKind, TurnConfig, TurnExecutor } from "../../features/workflow/domain";
import type { GateConfig, GraphData, GraphNode, KnowledgeConfig, NodeType, TransformConfig } from "../../features/workflow/types";

export type SelectOption = {
  value: string;
  label: string;
};

export type WorkflowInspectorToolsProps = {
  simpleWorkflowUI: boolean;
  addNode: (type: NodeType) => void;
  addCrawlerNode: () => void;
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
};

export type NodeConfigCasts = {
  turn: (node: GraphNode) => TurnConfig;
  transform: (node: GraphNode) => TransformConfig;
  gate: (node: GraphNode) => GateConfig;
};
