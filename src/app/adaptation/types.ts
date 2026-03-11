import type { PresetKind, ArtifactType, TurnExecutor } from "../../features/workflow/domain";
import type { TurnContextBudget } from "../../features/workflow/turnExecutionTuning";
import type { GraphData } from "../../features/workflow/types";
import type { StudioRoleId } from "../../features/studio/handoffTypes";

export type AdaptiveLearningState = "active" | "frozen";

export type AdaptiveFamilyKey =
  | `preset:${PresetKind}`
  | `role:${StudioRoleId}`
  | `custom:${string}`;

export type AdaptiveRubricDimension =
  | "goalFit"
  | "feasibility"
  | "constraintFit"
  | "groundedness"
  | "differentiation";

export type AdaptiveRubricScore = {
  goalFit: number;
  feasibility: number;
  constraintFit: number;
  groundedness: number;
  differentiation: number;
};

export type AdaptiveRecipeTurnNode = {
  id: string;
  type: "turn" | "transform" | "gate";
  role?: string;
  handoffRoleId?: StudioRoleId;
  roleMode?: string;
  sourceKind?: string;
  internalNodeKind?: string;
  artifactType?: ArtifactType;
  promptTemplate?: string;
  temperature?: number;
  contextBudget?: TurnContextBudget;
  maxInputChars?: number;
  executor?: TurnExecutor;
};

export type AdaptiveRecipeSnapshot = {
  id: string;
  workspace: string;
  family: AdaptiveFamilyKey;
  familyBucket: "creative" | "research" | "development" | "validation" | "fullstack" | "unityGame";
  graphShapeHash: string;
  promptPackHash: string;
  tuningBundleHash: string;
  presetKind?: PresetKind;
  primaryRoleIds: StudioRoleId[];
  artifactTypes: ArtifactType[];
  graphSummary: string;
  promptSummary: string;
  tuningSummary: string;
  candidateKind: "current" | "prompt_tuning_shadow" | "topology_shadow";
  topologyVariantId?: string;
  promptVariantId?: string;
  tuningVariantId?: string;
  createdAt: string;
  turnNodes: AdaptiveRecipeTurnNode[];
  graphTemplate?: GraphData;
  templateRoleNodeId?: string;
};

export type AdaptiveComparisonRecord = {
  id: string;
  workspace: string;
  family: AdaptiveFamilyKey;
  candidate: AdaptiveRecipeSnapshot;
  champion: AdaptiveRecipeSnapshot | null;
  scores: {
    candidate: AdaptiveRubricScore;
    champion: AdaptiveRubricScore | null;
  };
  weightedTotal: {
    candidate: number;
    champion: number | null;
  };
  floorFailures: {
    candidate: AdaptiveRubricDimension[];
    champion: AdaptiveRubricDimension[] | null;
  };
  winner: "candidate" | "champion" | "seed";
  eligible: boolean;
  promoted: boolean;
  diff: {
    graph: string[];
    prompt: string[];
    tuning: string[];
  };
  createdAt: string;
};

export type AdaptiveChampionRecord = {
  workspace: string;
  family: AdaptiveFamilyKey;
  recipe: AdaptiveRecipeSnapshot;
  score: AdaptiveRubricScore;
  weightedTotal: number;
  updatedAt: string;
  promotedAt?: string;
  seededAt?: string;
};

export type AdaptiveWorkspaceProfile = {
  version: 1;
  workspace: string;
  learningState: AdaptiveLearningState;
  updatedAt: string;
};

export type AdaptiveEvaluationInput = {
  question: string;
  finalAnswer: string;
  evidenceCount: number;
  knowledgeTraceCount: number;
  internalMemoryTraceCount: number;
  runMemoryCount: number;
  qualityPassRate: number;
  qualityAvgScore: number;
  totalNodeCount: number;
  failedNodeCount: number;
  userMemory: string[];
  artifactTypeCount: number;
};

export type AdaptiveWorkspaceData = {
  profile: AdaptiveWorkspaceProfile;
  champions: AdaptiveChampionRecord[];
  comparisons: AdaptiveComparisonRecord[];
  candidates: AdaptiveRecipeSnapshot[];
};
