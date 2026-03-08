import { buildStudioRolePromptEnvelope } from "../../../features/studio/rolePromptGuidance";
import { getRoleResearchProfile } from "../../../features/studio/roleResearchProfiles";
import { STUDIO_ROLE_TEMPLATES } from "../../../features/studio/roleTemplates";
import { STUDIO_ROLE_PROMPTS } from "../../../features/studio/roleUtils";
import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import type { ArtifactType, QualityProfileId } from "../../../features/workflow/domain";
import { defaultNodeConfig, makeNodeId } from "../../../features/workflow/graph-utils/shared";
import type { GraphEdge, GraphNode } from "../../../features/workflow/types";
import { viaNodeLabel, type ViaNodeType } from "../../../features/workflow/viaCatalog";

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

type RoleResearchSourceType = "source.community" | "source.dev" | "source.news";

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

function createViaResearchNode(params: {
  nodeId: string;
  viaNodeType: ViaNodeType;
  x: number;
  y: number;
  roleId: StudioRoleId;
  roleLabel: string;
  templateLabel: string;
}): GraphNode {
  const research = getRoleResearchProfile(params.roleId);
  const isSourceNode = params.viaNodeType.startsWith("source.");
  const roleAwareLabel = (() => {
    if (params.viaNodeType === "trigger.manual") {
      return `${params.roleLabel} 조사 시작`;
    }
    if (params.viaNodeType === "transform.normalize") {
      return `${params.roleLabel} 자료 정리`;
    }
    if (params.viaNodeType === "transform.verify") {
      return `${params.roleLabel} 근거 검증`;
    }
    if (params.viaNodeType === "transform.rank") {
      return `${params.roleLabel} 중요도 정렬`;
    }
    if (params.viaNodeType === "agent.codex") {
      return `${params.roleLabel} 리서치 요약`;
    }
    if (params.viaNodeType === "export.rag") {
      return `${params.roleLabel} 역할 컨텍스트 저장`;
    }
    return `${params.roleLabel} 자료 수집 · ${viaNodeLabel(params.viaNodeType)}`;
  })();
  const roleAwarePrompt = (() => {
    if (params.viaNodeType.startsWith("source.")) {
      return `${params.roleLabel} 역할 수행에 필요한 외부 자료를 수집합니다.`;
    }
    if (params.viaNodeType === "transform.normalize") {
      return `${params.roleLabel}가 읽기 쉬운 공통 형식으로 조사 결과를 정리합니다.`;
    }
    if (params.viaNodeType === "transform.verify") {
      return `${params.roleLabel} 관점에서 근거 신뢰도와 중복 여부를 검증합니다.`;
    }
    if (params.viaNodeType === "transform.rank") {
      return `${params.roleLabel} 의사결정에 중요한 자료를 우선순위화합니다.`;
    }
    if (params.viaNodeType === "agent.codex") {
      return `${params.roleLabel} 역할용 참고자료 브리프를 생성합니다.`;
    }
    if (params.viaNodeType === "export.rag") {
      return `${params.roleLabel} 역할 노드가 바로 사용할 조사 결과를 내보냅니다.`;
    }
    return `${params.roleLabel} 역할용 자동 조사 단계를 실행합니다.`;
  })();
  return {
    id: params.nodeId,
    type: "turn",
    position: { x: params.x, y: params.y },
    config: {
      ...defaultNodeConfig("turn"),
      executor: "via_flow",
      role: roleAwareLabel,
      promptTemplate: roleAwarePrompt,
      qualityProfile: "research_evidence",
      artifactType: "EvidenceArtifact",
      sourceKind: isSourceNode ? "data_research" : "data_pipeline",
      viaFlowId: "1",
      viaNodeType: params.viaNodeType,
      viaNodeLabel: viaNodeLabel(params.viaNodeType),
      viaSourceTypeHint: isSourceNode ? params.viaNodeType : research.sourceType,
      viaTemplateLabel: params.templateLabel,
      viaCustomKeywords: isSourceNode ? research.keywords : "",
      viaCustomCountries: isSourceNode ? research.countries : "",
      viaCustomSites: isSourceNode ? research.sites : "",
      viaCustomMaxItems: isSourceNode ? research.maxItems : 24,
    },
  };
}

function orderedResearchSources(primary: RoleResearchSourceType): RoleResearchSourceType[] {
  const sourceTypes: RoleResearchSourceType[] = ["source.community", "source.dev", "source.news"];
  return [primary, ...sourceTypes.filter((value) => value !== primary)];
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

  const sourceTypes = orderedResearchSources(research.sourceType as RoleResearchSourceType);
  const researchNodeIds: string[] = [];
  const triggerNodeId = makeNodeId("turn");
  const normalizeNodeId = makeNodeId("turn");
  const verifyNodeId = makeNodeId("turn");
  const rankNodeId = makeNodeId("turn");
  const agentNodeId = makeNodeId("turn");
  const exportNodeId = makeNodeId("turn");

  const triggerNode = createViaResearchNode({
    nodeId: triggerNodeId,
    viaNodeType: "trigger.manual",
    roleId: params.roleId,
    roleLabel,
    templateLabel: research.focusLabel,
    x: Math.max(40, params.anchorX - 990),
    y: params.anchorY,
  });
  researchNodeIds.push(triggerNodeId);

  const sourceNodes = sourceTypes.map((sourceType, index) => {
    const nodeId = makeNodeId("turn");
    researchNodeIds.push(nodeId);
    return createViaResearchNode({
      nodeId,
      viaNodeType: sourceType,
      roleId: params.roleId,
      roleLabel,
      templateLabel: research.focusLabel,
      x: Math.max(40, params.anchorX - 780),
      y: params.anchorY + (index - 1) * 150,
    });
  });

  const normalizeNode = createViaResearchNode({
    nodeId: normalizeNodeId,
    viaNodeType: "transform.normalize",
    roleId: params.roleId,
    roleLabel,
    templateLabel: research.focusLabel,
    x: Math.max(40, params.anchorX - 530),
    y: params.anchorY,
  });
  researchNodeIds.push(normalizeNodeId);

  const verifyNode = createViaResearchNode({
    nodeId: verifyNodeId,
    viaNodeType: "transform.verify",
    roleId: params.roleId,
    roleLabel,
    templateLabel: research.focusLabel,
    x: Math.max(40, params.anchorX - 345),
    y: params.anchorY,
  });
  researchNodeIds.push(verifyNodeId);

  const rankNode = createViaResearchNode({
    nodeId: rankNodeId,
    viaNodeType: "transform.rank",
    roleId: params.roleId,
    roleLabel,
    templateLabel: research.focusLabel,
    x: Math.max(40, params.anchorX - 180),
    y: params.anchorY,
  });
  researchNodeIds.push(rankNodeId);

  const agentNode = createViaResearchNode({
    nodeId: agentNodeId,
    viaNodeType: "agent.codex",
    roleId: params.roleId,
    roleLabel,
    templateLabel: research.focusLabel,
    x: Math.max(40, params.anchorX - 15),
    y: params.anchorY,
  });
  researchNodeIds.push(agentNodeId);

  const exportNode = createViaResearchNode({
    nodeId: exportNodeId,
    viaNodeType: "export.rag",
    roleId: params.roleId,
    roleLabel,
    templateLabel: research.focusLabel,
    x: Math.max(40, params.anchorX + 150),
    y: params.anchorY,
  });
  researchNodeIds.push(exportNodeId);

  const researchNodes = [
    triggerNode,
    ...sourceNodes,
    normalizeNode,
    verifyNode,
    rankNode,
    agentNode,
    exportNode,
  ];

  const researchEdges = sourceNodes.flatMap((sourceNode) => [
    edge(triggerNodeId, sourceNode.id),
    edge(sourceNode.id, normalizeNodeId),
  ]);
  researchEdges.push(edge(normalizeNodeId, verifyNodeId));
  researchEdges.push(edge(verifyNodeId, rankNodeId));
  researchEdges.push(edge(rankNodeId, agentNodeId));
  researchEdges.push(edge(agentNodeId, exportNodeId));
  researchEdges.push(edge(exportNodeId, roleNodeId));

  return {
    nodes: [...researchNodes, roleNode],
    edges: researchEdges,
    roleNodeId,
    researchNodeIds,
  };
}
