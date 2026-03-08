import { buildStudioRolePromptEnvelope } from "../../../features/studio/rolePromptGuidance";
import { getRoleResearchProfile } from "../../../features/studio/roleResearchProfiles";
import { STUDIO_ROLE_TEMPLATES } from "../../../features/studio/roleTemplates";
import { STUDIO_ROLE_PROMPTS } from "../../../features/studio/roleUtils";
import type { StudioRoleId } from "../../../features/studio/handoffTypes";
import type { ArtifactType, QualityProfileId } from "../../../features/workflow/domain";
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

type ResearchLane = {
  label: string;
  prompt: string;
};

function buildRoleResearchLanes(roleId: StudioRoleId, roleLabel: string, keywords: string, sites: string): ResearchLane[] {
  if (roleId === "pm_planner") {
    return [
      {
        label: "시장/레퍼런스 조사",
        prompt: `${roleLabel} 관점에서 현재 게임 시장, 레퍼런스 작품, 플레이어 판타지를 조사합니다. 키워드: ${keywords}. 우선 참고: ${sites}.`,
      },
      {
        label: "코어 루프/동기 분석",
        prompt: `${roleLabel}가 설계 판단에 쓸 수 있게 코어 루프, 리텐션 동기, 진행 구조 사례를 조사합니다. 키워드: ${keywords}.`,
      },
      {
        label: "리스크/차별화 조사",
        prompt: `${roleLabel}가 피해야 할 기획 리스크와 차별화 포인트를 조사합니다. 키워드: ${keywords}.`,
      },
    ];
  }

  if (roleId === "system_programmer" || roleId === "tooling_engineer") {
    return [
      {
        label: "공식 문서 조사",
        prompt: `${roleLabel} 역할을 위해 공식 문서와 레퍼런스 구현을 조사합니다. 키워드: ${keywords}. 우선 참고: ${sites}.`,
      },
      {
        label: "구조/패턴 조사",
        prompt: `${roleLabel}가 참고할 아키텍처 패턴, 데이터 흐름, 유지보수 전략을 조사합니다. 키워드: ${keywords}.`,
      },
      {
        label: "실패 사례/주의점 조사",
        prompt: `${roleLabel} 관점에서 흔한 실패 사례, 병목, 회귀 포인트를 조사합니다. 키워드: ${keywords}.`,
      },
    ];
  }

  if (roleId === "qa_engineer" || roleId === "build_release") {
    return [
      {
        label: "체크리스트 조사",
        prompt: `${roleLabel}가 바로 활용할 체크리스트와 표준 절차를 조사합니다. 키워드: ${keywords}. 우선 참고: ${sites}.`,
      },
      {
        label: "장애/회귀 사례 조사",
        prompt: `${roleLabel} 관점에서 자주 발생하는 장애, 회귀 패턴, 실패 케이스를 조사합니다. 키워드: ${keywords}.`,
      },
      {
        label: "검증 포인트 조사",
        prompt: `${roleLabel}가 실행 전에 확인해야 할 검증 포인트와 신호를 조사합니다. 키워드: ${keywords}.`,
      },
    ];
  }

  return [
    {
      label: "역할 참고 조사",
      prompt: `${roleLabel} 역할 수행에 필요한 기본 참고자료를 조사합니다. 키워드: ${keywords}. 우선 참고: ${sites}.`,
    },
    {
      label: "실전 사례 조사",
      prompt: `${roleLabel}가 바로 적용할 수 있는 사례, 구현 예시, 실전 팁을 조사합니다. 키워드: ${keywords}.`,
    },
    {
      label: "리스크 조사",
      prompt: `${roleLabel} 관점에서 자주 놓치는 문제, 품질 리스크, 후속 이슈를 조사합니다. 키워드: ${keywords}.`,
    },
  ];
}

function createRoleResearchNode(params: {
  nodeId: string;
  x: number;
  y: number;
  roleId: StudioRoleId;
  roleLabel: string;
  lane: ResearchLane;
  sites: string;
  countries: string;
  maxItems: number;
}): GraphNode {
  return {
    id: params.nodeId,
    type: "turn",
    position: { x: params.x, y: params.y },
    config: {
      ...defaultNodeConfig("turn"),
      executor: "web_grok",
      role: `${params.roleLabel} 조사 · ${params.lane.label}`,
      handoffRoleId: params.roleId,
      promptTemplate: `${params.lane.prompt}\n참고 우선순위 사이트: ${params.sites}\n대상 지역: ${params.countries}\n응답은 핵심 근거, 시사점, 후속 조사 포인트를 짧게 정리합니다.`,
      qualityProfile: "research_evidence",
      artifactType: "EvidenceArtifact",
      sourceKind: "data_research",
      webResultMode: "bridgeAssisted",
      webTimeoutMs: 180_000,
      viaTemplateLabel: params.lane.label,
      viaCustomCountries: params.countries,
      viaCustomSites: params.sites,
      viaCustomMaxItems: params.maxItems,
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

  const researchLanes = buildRoleResearchLanes(params.roleId, roleLabel, research.keywords, research.sites);
  const researchNodeIds: string[] = [];
  const synthesisNodeId = makeNodeId("turn");
  const sourceNodes = researchLanes.map((lane, index) => {
    const nodeId = makeNodeId("turn");
    researchNodeIds.push(nodeId);
    return createRoleResearchNode({
      nodeId,
      roleId: params.roleId,
      roleLabel,
      lane,
      sites: research.sites,
      countries: research.countries,
      maxItems: research.maxItems,
      x: Math.max(40, params.anchorX - 620),
      y: params.anchorY + (index - 1) * 150,
    });
  });

  const synthesisNode: GraphNode = {
    id: synthesisNodeId,
    type: "turn",
    position: { x: Math.max(40, params.anchorX - 210), y: params.anchorY },
    config: {
      ...defaultNodeConfig("turn"),
      executor: "codex",
      role: `${roleLabel} 조사 종합`,
      handoffRoleId: params.roleId,
      promptTemplate: `${roleLabel} 역할을 위해 병렬 조사 결과를 종합합니다. 서로 겹치는 내용은 합치고, 믿을 만한 근거와 실제 적용 포인트만 짧게 정리합니다.`,
      qualityProfile: "research_evidence",
      artifactType: "EvidenceArtifact",
      sourceKind: "data_pipeline",
    },
  };
  researchNodeIds.push(synthesisNodeId);

  const researchNodes = [
    ...sourceNodes,
    synthesisNode,
  ];

  const researchEdges = sourceNodes.map((sourceNode) => edge(sourceNode.id, synthesisNodeId));
  researchEdges.push(edge(synthesisNodeId, roleNodeId));

  return {
    nodes: [...researchNodes, roleNode],
    edges: researchEdges,
    roleNodeId,
    researchNodeIds,
  };
}
