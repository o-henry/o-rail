import { buildStudioRolePromptEnvelope } from "../../../features/studio/rolePromptGuidance";
import {
  getRoleResearchProfile,
  type RoleResearchLaneBlueprint,
} from "../../../features/studio/roleResearchProfiles";
import { STUDIO_ROLE_TEMPLATES } from "../../../features/studio/roleTemplates";
import { STUDIO_ROLE_PROMPTS } from "../../../features/studio/roleUtils";
import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import type {
  ArtifactType,
  QualityProfileId,
  TurnExecutor,
} from "../../../features/workflow/domain";
import { defaultNodeConfig, makeNodeId } from "../../../features/workflow/graph-utils/shared";
import type { GraphEdge, GraphNode } from "../../../features/workflow/types";

type RoleNodeScaffoldParams = {
  roleId: StudioRoleId;
  anchorX: number;
  anchorY: number;
  includeResearch: boolean;
};

type RoleNodeScaffoldResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  roleNodeId: string;
  researchNodeIds: string[];
};

function edge(fromNodeId: string, toNodeId: string): GraphEdge {
  return {
    from: { nodeId: fromNodeId, port: "out" },
    to: { nodeId: toNodeId, port: "in" },
  };
}

function roleQualityProfile(roleId: StudioRoleId): QualityProfileId {
  if (roleId === "client_programmer" || roleId === "system_programmer" || roleId === "tooling_engineer") {
    return "code_implementation";
  }
  if (roleId === "qa_engineer" || roleId === "build_release") {
    return "research_evidence";
  }
  return "design_planning";
}

function roleArtifactType(roleId: StudioRoleId): ArtifactType {
  if (roleId === "pm_planner") {
    return "TaskPlanArtifact";
  }
  if (roleId === "technical_writer") {
    return "DesignArtifact";
  }
  if (roleId === "qa_engineer" || roleId === "build_release") {
    return "EvidenceArtifact";
  }
  return "ChangePlanArtifact";
}

function rolePromptTemplate(roleId: StudioRoleId): string {
  const template = STUDIO_ROLE_TEMPLATES.find((row) => row.id === roleId);
  return buildStudioRolePromptEnvelope({
    roleId,
    roleLabel: template?.label,
    goal: template?.goal,
    taskId: template?.defaultTaskId,
    request: STUDIO_ROLE_PROMPTS[roleId],
    extraGuidance: [
      "연결된 조사 결과와 이전 노드 출력을 먼저 근거로 정리합니다.",
      "외부 근거가 부족하면 필요한 추가 조사 키워드/사이트를 마지막에 짧게 제안합니다.",
      "자료를 읽지 않은 상태로 전문가처럼 추측하지 않습니다.",
    ],
  });
}

function createRoleResearchNode(params: {
  nodeId: string;
  x: number;
  y: number;
  roleId: StudioRoleId;
  roleLabel: string;
  lane: RoleResearchLaneBlueprint;
}): GraphNode {
  const baseConfig = {
    ...defaultNodeConfig("turn"),
    executor: params.lane.executor,
    role: `${params.roleLabel} 조사 · ${params.lane.label}`,
    handoffRoleId: params.roleId,
    promptTemplate: params.lane.prompt,
    qualityProfile: "research_evidence" as const,
    artifactType: "EvidenceArtifact" as const,
    sourceKind: "data_research" as const,
  };
  const isWebLane = params.lane.executor.startsWith("web_");
  return {
    id: params.nodeId,
    type: "turn",
    position: { x: params.x, y: params.y },
    config: {
      ...baseConfig,
      promptTemplate: [
        params.lane.prompt,
        params.lane.sites ? `우선 참고 사이트: ${params.lane.sites}` : "",
        params.lane.countries ? `대상 지역: ${params.lane.countries}` : "",
        "응답은 핵심 사실, 근거, 바로 쓸 시사점, 남는 리스크 순으로 짧게 정리합니다.",
      ]
        .filter(Boolean)
        .join("\n"),
      ...(isWebLane
        ? {
            webResultMode: "bridgeAssisted" as const,
            webTimeoutMs: 180_000,
            viaTemplateLabel: params.lane.label,
            viaCustomKeywords: params.lane.keywords,
            viaCustomCountries: params.lane.countries,
            viaCustomSites: params.lane.sites,
            viaCustomMaxItems: params.lane.maxItems,
          }
        : {
            knowledgeEnabled: true,
          }),
    },
  };
}

function createResearchPipelineNode(params: {
  nodeId: string;
  x: number;
  y: number;
  roleId: StudioRoleId;
  role: string;
  promptTemplate: string;
  executor?: TurnExecutor;
}): GraphNode {
  return {
    id: params.nodeId,
    type: "turn",
    position: { x: params.x, y: params.y },
    config: {
      ...defaultNodeConfig("turn"),
      executor: params.executor ?? "codex",
      role: params.role,
      handoffRoleId: params.roleId,
      promptTemplate: params.promptTemplate,
      qualityProfile: "research_evidence",
      artifactType: "EvidenceArtifact",
      sourceKind: "data_pipeline",
      knowledgeEnabled: true,
    },
  };
}

export function buildRoleNodeScaffold(params: RoleNodeScaffoldParams): RoleNodeScaffoldResult {
  const template = STUDIO_ROLE_TEMPLATES.find((row) => row.id === params.roleId);
  const roleLabel = template?.label ?? params.roleId;
  const research = getRoleResearchProfile(params.roleId);
  const roleNodeId = makeNodeId("turn");
  const roleNode: GraphNode = {
    id: roleNodeId,
    type: "turn",
    position: { x: params.anchorX, y: params.anchorY },
    config: {
      ...defaultNodeConfig("turn"),
      role: `${roleLabel} AGENT`,
      promptTemplate: rolePromptTemplate(params.roleId),
      qualityProfile: roleQualityProfile(params.roleId),
      artifactType: roleArtifactType(params.roleId),
      taskId: template?.defaultTaskId ?? "TASK-001",
      sourceKind: "handoff",
      handoffRoleId: params.roleId,
      handoffToRoleId: params.roleId,
      handoffChecklist: "근거, 결정 이유, 후속 작업을 함께 남깁니다.",
      roleResearchEnabled: params.includeResearch,
    },
  };

  if (!params.includeResearch) {
    return {
      nodes: [roleNode],
      edges: [],
      roleNodeId,
      researchNodeIds: [],
    };
  }

  const researchLanes = research.lanes;
  const researchNodeIds: string[] = [];
  const synthesisNodeId = makeNodeId("turn");
  const verificationNodeId = makeNodeId("turn");
  const sourceNodes = researchLanes.map((lane, index) => {
    const nodeId = makeNodeId("turn");
    researchNodeIds.push(nodeId);
    return createRoleResearchNode({
      nodeId,
      roleId: params.roleId,
      roleLabel,
      lane,
      x: Math.max(40, params.anchorX - 620),
      y: params.anchorY + (index - 1) * 150,
    });
  });

  const synthesisNode = createResearchPipelineNode({
    nodeId: synthesisNodeId,
    x: Math.max(40, params.anchorX - 210),
    y: params.anchorY - 72,
    roleId: params.roleId,
    role: `${roleLabel} 조사 종합`,
    promptTemplate: research.synthesisPrompt,
  });
  researchNodeIds.push(synthesisNodeId);
  const verificationNode = createResearchPipelineNode({
    nodeId: verificationNodeId,
    x: Math.max(40, params.anchorX - 210),
    y: params.anchorY + 76,
    roleId: params.roleId,
    role: `${roleLabel} 조사 검증`,
    promptTemplate: research.verificationPrompt,
  });
  researchNodeIds.push(verificationNodeId);

  const researchNodes = [
    ...sourceNodes,
    synthesisNode,
    verificationNode,
  ];

  const researchEdges = sourceNodes.map((sourceNode) => edge(sourceNode.id, synthesisNodeId));
  researchEdges.push(edge(synthesisNodeId, verificationNodeId));
  researchEdges.push(edge(verificationNodeId, roleNodeId));

  return {
    nodes: [...researchNodes, roleNode],
    edges: researchEdges,
    roleNodeId,
    researchNodeIds,
  };
}
