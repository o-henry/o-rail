import { type PresetKind, type TurnConfig } from "../domain";
import type { GraphData, GraphEdge, GraphNode } from "../types";
import {
  DEFAULT_PRESET_TURN_POLICY,
  normalizeQualityThreshold,
  type PresetTurnPolicy,
} from "./shared";
import { PREPROCESS_BRIEF_SCHEMA } from "./schemas";

const PRESET_OUTPUT_SCHEMA_BY_NODE_ID: Readonly<Record<string, string>> = {};

export function resolvePresetTurnPolicy(kind: PresetKind, nodeId: string): PresetTurnPolicy {
  const key = nodeId.toLowerCase();
  if (key.includes("preprocess")) {
    return {
      ...DEFAULT_PRESET_TURN_POLICY,
      profile: "design_planning",
      threshold: 76,
      artifactType: "RequirementArtifact",
    };
  }

  if (kind === "validation") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 68 };
    }
    if (key.includes("search")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "research_evidence",
        threshold: key.includes("-a") ? 80 : 82,
        artifactType: "EvidenceArtifact",
      };
    }
    if (key.includes("judge")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 87 };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 79,
        artifactType: "EvidenceArtifact",
      };
    }
  }

  if (kind === "development") {
    if (key.includes("requirements")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "design_planning",
        threshold: 72,
        artifactType: "RequirementArtifact",
      };
    }
    if (key.includes("architecture")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "design_planning",
        threshold: 79,
        artifactType: "DesignArtifact",
      };
    }
    if (key.includes("implementation")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "code_implementation",
        threshold: 84,
        qualityCommandEnabled: true,
        qualityCommands: "npm run lint\nnpm run build",
        artifactType: "TaskPlanArtifact",
      };
    }
    if (key.includes("evaluator")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 86 };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 82,
        artifactType: "ChangePlanArtifact",
      };
    }
  }

  if (kind === "research") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 70 };
    }
    if (key.includes("collector")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "research_evidence",
        threshold: 80,
        artifactType: "EvidenceArtifact",
      };
    }
    if (key.includes("factcheck")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "research_evidence",
        threshold: 90,
        artifactType: "EvidenceArtifact",
      };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 84,
        artifactType: "EvidenceArtifact",
      };
    }
  }

  if (kind === "expert") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 72 };
    }
    if (key.includes("analysis")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "design_planning",
        threshold: 82,
        artifactType: "DesignArtifact",
      };
    }
    if (key.includes("review")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 86 };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 85,
        artifactType: "ChangePlanArtifact",
      };
    }
  }

  if (kind === "unityCiDoctor") {
    if (key.includes("intake")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "design_planning",
        threshold: 74,
        artifactType: "RequirementArtifact",
      };
    }
    if (key.includes("system")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "research_evidence",
        threshold: 88,
        artifactType: "EvidenceArtifact",
      };
    }
    if (key.includes("qa")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 82,
        artifactType: "TaskPlanArtifact",
      };
    }
    if (key.includes("pm")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "design_planning",
        threshold: 78,
        artifactType: "RequirementArtifact",
      };
    }
    if (key.includes("judge")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "research_evidence",
        threshold: 90,
        artifactType: "EvidenceArtifact",
      };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 84,
        artifactType: "ChangePlanArtifact",
      };
    }
  }

  if (kind === "unityGame") {
    if (key.includes("intake")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "design_planning",
        threshold: 68,
        artifactType: "RequirementArtifact",
      };
    }
    if (key.includes("system")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "design_planning",
        threshold: 81,
        artifactType: "DesignArtifact",
      };
    }
    if (key.includes("implementation")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "code_implementation",
        threshold: 83,
        qualityCommandEnabled: true,
        qualityCommands: "npm run lint\nnpm run typecheck\nnpm run build",
        artifactType: "TaskPlanArtifact",
      };
    }
    if (key.includes("qa")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 88 };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 84,
        artifactType: "TaskPlanArtifact",
      };
    }
  }

  if (kind === "fullstack") {
    if (key.includes("intake")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "design_planning",
        threshold: 72,
        artifactType: "RequirementArtifact",
      };
    }
    if (key.includes("backend")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "code_implementation",
        threshold: 85,
        qualityCommandEnabled: true,
        qualityCommands: "npm run lint\nnpm run test\nnpm run build",
        artifactType: "TaskPlanArtifact",
      };
    }
    if (key.includes("frontend")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "code_implementation",
        threshold: 83,
        qualityCommandEnabled: true,
        qualityCommands: "npm run lint\nnpm run test -- --runInBand\nnpm run build",
        artifactType: "TaskPlanArtifact",
      };
    }
    if (key.includes("ops")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 89 };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 85,
        artifactType: "ChangePlanArtifact",
      };
    }
  }

  if (kind === "creative") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 66 };
    }
    if (key.includes("diverge")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "generic", threshold: 58 };
    }
    if (key.includes("critic")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 80 };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 74,
        artifactType: "TaskPlanArtifact",
      };
    }
  }

  if (kind === "newsTrend") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 70 };
    }
    if (key.includes("scan")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "research_evidence",
        threshold: 80,
        artifactType: "EvidenceArtifact",
      };
    }
    if (key.includes("check")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "research_evidence",
        threshold: 91,
        artifactType: "EvidenceArtifact",
      };
    }
    if (key.includes("final")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "synthesis_final",
        threshold: 84,
        artifactType: "EvidenceArtifact",
      };
    }
  }

  return DEFAULT_PRESET_TURN_POLICY;
}

export function applyPresetTurnPolicies(kind: PresetKind, nodes: GraphNode[]): GraphNode[] {
  return nodes.map((node) => {
    if (node.type !== "turn") {
      return node;
    }
    const policy = resolvePresetTurnPolicy(kind, node.id);
    const current = node.config as TurnConfig;
    return {
      ...node,
      config: {
        ...current,
        qualityProfile: policy.profile,
        qualityThreshold: normalizeQualityThreshold(policy.threshold),
        qualityCommandEnabled: policy.qualityCommandEnabled,
        qualityCommands: policy.qualityCommands,
        artifactType: policy.artifactType,
      },
    };
  });
}

export function applyPresetOutputSchemaPolicies(graphData: GraphData): GraphData {
  return {
    ...graphData,
    nodes: graphData.nodes.map((node) => {
      if (node.type !== "turn") {
        return node;
      }
      const outputSchemaJson = PRESET_OUTPUT_SCHEMA_BY_NODE_ID[node.id] ?? (node.id.includes("preprocess") ? PREPROCESS_BRIEF_SCHEMA : undefined);
      if (!outputSchemaJson) {
        return node;
      }
      return {
        ...node,
        config: {
          ...(node.config as TurnConfig),
          outputSchemaJson,
        },
      };
    }),
  };
}

export function simplifyPresetForSimpleWorkflow(graphData: GraphData, simpleWorkflowUi: boolean): GraphData {
  if (!simpleWorkflowUi) {
    return graphData;
  }

  const turnNodes = graphData.nodes.filter((node) => node.type === "turn");
  const nodeMap = new Map(graphData.nodes.map((node) => [node.id, node] as const));
  const outgoingMap = new Map<string, string[]>();

  for (const edge of graphData.edges) {
    const fromId = edge.from.nodeId;
    const toId = edge.to.nodeId;
    const rows = outgoingMap.get(fromId) ?? [];
    rows.push(toId);
    outgoingMap.set(fromId, rows);
  }

  const edgeSet = new Set<string>();
  const nextEdges: GraphEdge[] = [];
  const pushEdge = (fromId: string, toId: string) => {
    if (fromId === toId) {
      return;
    }
    const key = `${fromId}->${toId}`;
    if (edgeSet.has(key)) {
      return;
    }
    edgeSet.add(key);
    nextEdges.push({
      from: { nodeId: fromId, port: "out" },
      to: { nodeId: toId, port: "in" },
    });
  };

  for (const source of turnNodes) {
    const queue = [...(outgoingMap.get(source.id) ?? [])];
    const visitedInternal = new Set<string>();
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || currentId === source.id) {
        continue;
      }
      const currentNode = nodeMap.get(currentId);
      if (!currentNode) {
        continue;
      }
      if (currentNode.type === "turn") {
        pushEdge(source.id, currentId);
        continue;
      }
      if (visitedInternal.has(currentId)) {
        continue;
      }
      visitedInternal.add(currentId);
      for (const nextId of outgoingMap.get(currentId) ?? []) {
        queue.push(nextId);
      }
    }
  }

  return {
    ...graphData,
    nodes: turnNodes,
    edges: nextEdges,
  };
}
