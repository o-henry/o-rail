import type { PresetKind } from "../domain";
import type { GraphData, GraphEdge } from "../types";
import { PREPROCESS_NODE_SHIFT_X, PREPROCESS_NODE_X, makePresetNode } from "./shared";

export function presetIntentByKind(kind: PresetKind): string {
  if (kind === "validation") return "검증 가능한 결론 도출";
  if (kind === "development") return "개발 실행 가능한 계획/구현";
  if (kind === "research") return "근거 중심 조사/분석";
  if (kind === "expert") return "전문가 수준 의사결정";
  if (kind === "unityCiDoctor") return "유니티 CI 장애 진단 및 수정 우선순위화";
  if (kind === "unityGame") return "유니티 게임 개발 실행";
  if (kind === "fullstack") return "풀스택 제품 구현";
  if (kind === "creative") return "창의 아이디어를 실행 가능한 제안으로 전환";
  return "뉴스/트렌드 기반 판단";
}

export function buildPreprocessPrompt(kind: PresetKind): string {
  const intent = presetIntentByKind(kind);
  return (
    "당신은 사용자 요구사항 전처리 전담 에이전트다.\n" +
    "목표: 사용자의 모호한 요청을 실행 가능한 브리프로 정제하고, 이후 멀티에이전트가 놓치기 쉬운 필수 요소를 강제한다.\n" +
    "원칙: 원문 의도를 왜곡하지 말고, 필요한 경우 보수적 가정을 명시하라.\n" +
    "반드시 아래 JSON 객체만 출력하라. 코드펜스/서론/부가설명 금지.\n" +
    "{\n" +
    '  "intent": "...",\n' +
    '  "userGoal": "...",\n' +
    `  "templateIntent": "${intent}",\n` +
    '  "requiredOutputs": ["..."],\n' +
    '  "constraints": ["..."],\n' +
    '  "assumptions": ["..."],\n' +
    '  "researchPlan": {\n' +
    '    "webQueries": ["..."],\n' +
    '    "sources": ["뉴스","논문·공식문서","커뮤니티·SNS"],\n' +
    '    "collectionOrder": ["최신성 확인","핵심 근거 수집","반례·리스크 수집"],\n' +
    '    "verificationRules": ["출처 명시","타임스탬프 확인","신뢰도 표기"]\n' +
    "  },\n" +
    '  "acceptanceCriteria": ["..."],\n' +
    '  "riskChecklist": ["..."],\n' +
    '  "selfValidationPlan": ["정확성","완전성","실행가능성","누락여부"]\n' +
    "}\n" +
    "질문: {{input}}"
  );
}

export function prependPreprocessAgent(kind: PresetKind, graphData: GraphData): GraphData {
  const preprocessNodeId = `turn-${kind}-preprocess`;
  if (graphData.nodes.some((node) => node.id === preprocessNodeId)) {
    return graphData;
  }

  const incomingIds = new Set(graphData.edges.map((edge) => edge.to.nodeId));
  let rootNodes = graphData.nodes.filter((node) => !incomingIds.has(node.id));
  if (rootNodes.length === 0 && graphData.nodes.length > 0) {
    rootNodes = [graphData.nodes[0]];
  }

  const avgRootY =
    rootNodes.length > 0
      ? Math.round(rootNodes.reduce((sum, node) => sum + node.position.y, 0) / rootNodes.length)
      : 120;

  const preprocessNode = makePresetNode(preprocessNodeId, "turn", PREPROCESS_NODE_X, avgRootY, {
    model: "GPT-5.3-Codex",
    role: "REQUEST PREPROCESS AGENT",
    cwd: ".",
    promptTemplate: buildPreprocessPrompt(kind),
  });

  const shiftedNodes = graphData.nodes.map((node) => ({
    ...node,
    position: {
      ...node.position,
      x: node.position.x + PREPROCESS_NODE_SHIFT_X,
    },
  }));

  const preprocessEdges: GraphEdge[] = rootNodes.map((node) => ({
    from: { nodeId: preprocessNodeId, port: "out" },
    to: { nodeId: node.id, port: "in" },
  }));

  return {
    ...graphData,
    nodes: [preprocessNode, ...shiftedNodes],
    edges: [...preprocessEdges, ...graphData.edges],
  };
}
