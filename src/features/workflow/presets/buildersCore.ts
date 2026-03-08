import type { GraphData, GraphEdge, GraphNode } from "../types";
import { GRAPH_SCHEMA_VERSION, defaultKnowledgeConfig, makePresetNode } from "./shared";

export function buildValidationPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-intake", "turn", 120, 120, {
      model: "GPT-5.3-Codex-Spark",
      role: "PLANNING AGENT",
      cwd: ".",
      promptTemplate:
        "당신은 검증 설계 에이전트다. 아래 질문을 분석해 검증 계획을 간결한 항목으로 작성하라.\n" +
        "형식:\n" +
        "- question:\n" +
        "- goal:\n" +
        "- checkpoints(3~5개):\n" +
        "- searchQueries(3~5개):\n" +
        "질문: {{input}}",
    }),
    makePresetNode("turn-search-a", "turn", 420, 40, {
      model: "GPT-5.2",
      role: "SEARCH AGENT A",
      cwd: ".",
      promptTemplate:
        "아래 입력에서 주장에 유리한 근거를 구조적으로 정리하라.\n" +
        "각 항목은 claim / evidence / sourceHint / confidence(0~1)를 포함하라.\n" +
        "조건: 근거가 약하면 confidence를 낮게 주고 추정이라고 표시.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-search-b", "turn", 420, 220, {
      model: "GPT-5.2-Codex",
      role: "SEARCH AGENT B",
      cwd: ".",
      promptTemplate:
        "아래 입력에서 반례/한계/위험요인을 구조적으로 정리하라.\n" +
        "각 항목은 point / why / confidence(0~1) / mitigation을 포함하라.\n" +
        "조건: 모호하면 모호하다고 명시.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-judge", "turn", 720, 120, {
      model: "GPT-5.3-Codex",
      role: "EVALUATION AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 종합 평가해 JSON만 출력하라.\n" +
        "출력 형식:\n" +
        '{ "DECISION":"PASS|REJECT", "finalDraft":"...", "why":["...","..."], "gaps":["..."], "confidence":0.0 }\n' +
        "판정 기준: 근거 일관성, 반례 대응 가능성, 불확실성 명시 여부.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("gate-decision", "gate", 1020, 120, {
      decisionPath: "DECISION",
      passNodeId: "transform-validation-brief",
      rejectNodeId: "transform-reject",
      schemaJson: "{\"type\":\"object\",\"required\":[\"DECISION\"]}",
    }),
    makePresetNode("transform-validation-brief", "transform", 1180, 40, {
      mode: "template",
      template:
        "검증 PASS 요약 브리프\n" +
        "- 판정 근거와 핵심 가정만 정리\n" +
        "- 불확실성/누락 항목 분리\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-final", "turn", 1460, 40, {
      model: "GPT-5.3-Codex",
      role: "SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "아래 입력을 바탕으로 최종 답변을 한국어로 작성하라.\n" +
        "규칙:\n" +
        "1) 핵심 결론 먼저\n" +
        "2) 근거 3~5개\n" +
        "3) 한계/불확실성 분리\n" +
        "4) 바로 실행 가능한 다음 단계 제시\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-reject", "transform", 1320, 220, {
      mode: "template",
      template: "검증 결과 REJECT. 추가 조사 필요. 원본: {{input}}",
    }),
  ];

  const edges: GraphEdge[] = [
    { from: { nodeId: "turn-intake", port: "out" }, to: { nodeId: "turn-search-a", port: "in" } },
    { from: { nodeId: "turn-intake", port: "out" }, to: { nodeId: "turn-search-b", port: "in" } },
    { from: { nodeId: "turn-search-a", port: "out" }, to: { nodeId: "turn-judge", port: "in" } },
    { from: { nodeId: "turn-search-b", port: "out" }, to: { nodeId: "turn-judge", port: "in" } },
    { from: { nodeId: "turn-judge", port: "out" }, to: { nodeId: "gate-decision", port: "in" } },
    { from: { nodeId: "gate-decision", port: "out" }, to: { nodeId: "transform-validation-brief", port: "in" } },
    { from: { nodeId: "transform-validation-brief", port: "out" }, to: { nodeId: "turn-final", port: "in" } },
    { from: { nodeId: "gate-decision", port: "out" }, to: { nodeId: "transform-reject", port: "in" } },
  ];

  return { version: GRAPH_SCHEMA_VERSION, nodes, edges, knowledge: defaultKnowledgeConfig() };
}

export function buildDevelopmentPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-requirements", "turn", 120, 120, {
      model: "GPT-5.3-Codex-Spark",
      role: "REQUIREMENTS AGENT",
      cwd: ".",
      promptTemplate:
        "아래 요청을 분석해 요구사항을 구조화하라.\n" +
        "형식: functional / nonFunctional / constraints / priority(P0~P2).\n" +
        "질문: {{input}}",
    }),
    makePresetNode("turn-architecture", "turn", 420, 40, {
      model: "GPT-5.2",
      role: "ARCHITECTURE AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 바탕으로 현실적인 시스템 설계를 제안하라.\n" +
        "형식: architecture / components / tradeoffs / risks / decisionLog.\n" +
        "과설계 금지, MVP 우선.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-implementation", "turn", 420, 220, {
      model: "GPT-5.2-Codex",
      role: "IMPLEMENTATION AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 기반으로 구현 계획을 단계별로 작성하라.\n" +
        "필수: 파일 단위 변경 목록, 테스트 계획, 실패 시 롤백 포인트.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-evaluator", "turn", 720, 120, {
      model: "GPT-5.3-Codex",
      role: "QUALITY AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 리뷰해 품질 판정을 JSON으로 출력하라.\n" +
        '{ "DECISION":"PASS|REJECT", "finalDraft":"...", "risk":["..."], "blockingIssues":["..."] }\n' +
        "입력: {{input}}",
    }),
    makePresetNode("gate-quality", "gate", 1020, 120, {
      decisionPath: "DECISION",
      passNodeId: "transform-dev-brief",
      rejectNodeId: "transform-rework",
      schemaJson: "{\"type\":\"object\",\"required\":[\"DECISION\"]}",
    }),
    makePresetNode("transform-dev-brief", "transform", 1180, 40, {
      mode: "template",
      template:
        "개발 PASS 브리프\n" +
        "- 구현/테스트/운영 관점 핵심 합의점\n" +
        "- 리스크와 차단 이슈 요약\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-final-dev", "turn", 1460, 40, {
      model: "GPT-5.3-Codex",
      role: "DEV SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "아래 입력으로 최종 개발 가이드를 작성하라.\n" +
        "구성: 구현 순서, 코드 품질 기준, 테스트 명세, 배포 체크리스트, 운영 리스크 대응.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-rework", "transform", 1320, 220, {
      mode: "template",
      template: "REJECT - requirements/architecture 재검토 필요. 입력: {{input}}",
    }),
  ];

  const edges: GraphEdge[] = [
    {
      from: { nodeId: "turn-requirements", port: "out" },
      to: { nodeId: "turn-architecture", port: "in" },
    },
    {
      from: { nodeId: "turn-requirements", port: "out" },
      to: { nodeId: "turn-implementation", port: "in" },
    },
    {
      from: { nodeId: "turn-architecture", port: "out" },
      to: { nodeId: "turn-evaluator", port: "in" },
    },
    {
      from: { nodeId: "turn-implementation", port: "out" },
      to: { nodeId: "turn-evaluator", port: "in" },
    },
    {
      from: { nodeId: "turn-evaluator", port: "out" },
      to: { nodeId: "gate-quality", port: "in" },
    },
    {
      from: { nodeId: "gate-quality", port: "out" },
      to: { nodeId: "transform-dev-brief", port: "in" },
    },
    {
      from: { nodeId: "transform-dev-brief", port: "out" },
      to: { nodeId: "turn-final-dev", port: "in" },
    },
    {
      from: { nodeId: "gate-quality", port: "out" },
      to: { nodeId: "transform-rework", port: "in" },
    },
  ];

  return { version: GRAPH_SCHEMA_VERSION, nodes, edges, knowledge: defaultKnowledgeConfig() };
}

export function buildResearchPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-research-intake", "turn", 120, 120, {
      model: "GPT-5.3-Codex-Spark",
      role: "RESEARCH PLANNING AGENT",
      cwd: ".",
      promptTemplate:
        "질문을 조사 계획으로 분해하라.\n" +
        "형식: researchGoal / questions / evidenceCriteria / riskChecks.\n" +
        "질문: {{input}}",
    }),
    makePresetNode("turn-research-collector", "turn", 420, 120, {
      model: "GPT-5.2",
      role: "SOURCE COLLECTION AGENT",
      cwd: ".",
      promptTemplate:
        "입력 기준으로 핵심 근거 후보를 수집해 정리하라.\n" +
        "각 항목은 id / statement / whyRelevant / confidence(0~1)를 포함하라.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-research-factcheck", "turn", 720, 120, {
      model: "GPT-5.2-Codex",
      role: "FACT CHECK AGENT",
      cwd: ".",
      promptTemplate:
        "수집 근거를 검증해 정리하라.\n" +
        "형식: verified / contested / missing / notes.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-research-brief", "transform", 1020, 120, {
      mode: "template",
      template:
        "자료조사 요약\n- 핵심 사실: {{input}}\n- 검증 포인트: 신뢰도, 최신성, 반례 존재 여부\n- 최종 답변 작성 전 누락 항목 점검",
    }),
    makePresetNode("turn-research-final", "turn", 1320, 120, {
      model: "GPT-5.3-Codex",
      role: "RESEARCH SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "근거 중심 최종 답변을 한국어로 작성하라.\n" +
        "규칙: 주장 옆에 근거 ID(E1, E2) 표시, 불확실성 분리, 과장 금지.\n" +
        "입력: {{input}}",
    }),
  ];

  const edges: GraphEdge[] = [
    {
      from: { nodeId: "turn-research-intake", port: "out" },
      to: { nodeId: "turn-research-collector", port: "in" },
    },
    {
      from: { nodeId: "turn-research-collector", port: "out" },
      to: { nodeId: "turn-research-factcheck", port: "in" },
    },
    {
      from: { nodeId: "turn-research-factcheck", port: "out" },
      to: { nodeId: "transform-research-brief", port: "in" },
    },
    {
      from: { nodeId: "transform-research-brief", port: "out" },
      to: { nodeId: "turn-research-final", port: "in" },
    },
  ];

  return { version: GRAPH_SCHEMA_VERSION, nodes, edges, knowledge: defaultKnowledgeConfig() };
}

export function buildExpertPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-expert-intake", "turn", 120, 120, {
      model: "GPT-5.3-Codex-Spark",
      role: "DOMAIN INTAKE AGENT",
      cwd: ".",
      promptTemplate:
        "질문을 전문가 분석용 브리프로 구조화하라.\n" +
        "형식: domain / objective / constraints / successCriteria.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-expert-analysis", "turn", 420, 40, {
      model: "GPT-5.2-Codex",
      role: "DOMAIN EXPERT AGENT",
      cwd: ".",
      promptTemplate:
        "도메인 전문가 관점의 해결 전략을 작성하라.\n" +
        "필수: 핵심 원리, 실제 적용 절차, 실패 조건, 대안 전략.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-expert-review", "turn", 420, 220, {
      model: "GPT-5.2",
      role: "PEER REVIEW AGENT",
      cwd: ".",
      promptTemplate:
        "전략의 취약점과 반례를 엄격히 리뷰해 JSON으로 출력하라.\n" +
        '{ "DECISION":"PASS|REJECT", "criticalIssues":["..."], "improvements":["..."] }\n' +
        "입력: {{input}}",
    }),
    makePresetNode("gate-expert", "gate", 720, 120, {
      decisionPath: "DECISION",
      passNodeId: "transform-expert-brief",
      rejectNodeId: "transform-expert-rework",
      schemaJson: "{\"type\":\"object\",\"required\":[\"DECISION\"]}",
    }),
    makePresetNode("transform-expert-brief", "transform", 900, 40, {
      mode: "template",
      template:
        "전문가 PASS 브리프\n" +
        "- 적용 가능한 전략 요지\n" +
        "- 취약점/보완 포인트 요약\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-expert-final", "turn", 1180, 40, {
      model: "GPT-5.3-Codex",
      role: "EXPERT SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "최종 전문가 답변을 작성하라.\n" +
        "구성: 핵심 결론, 단계별 실행안, 검증 체크리스트, 실패 시 대체안.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-expert-rework", "transform", 1020, 220, {
      mode: "template",
      template: "REJECT. 전문가 전략을 보완해야 합니다. 보완 항목 목록을 작성하세요. 원문: {{input}}",
    }),
  ];

  const edges: GraphEdge[] = [
    { from: { nodeId: "turn-expert-intake", port: "out" }, to: { nodeId: "turn-expert-analysis", port: "in" } },
    { from: { nodeId: "turn-expert-intake", port: "out" }, to: { nodeId: "turn-expert-review", port: "in" } },
    { from: { nodeId: "turn-expert-analysis", port: "out" }, to: { nodeId: "gate-expert", port: "in" } },
    { from: { nodeId: "turn-expert-review", port: "out" }, to: { nodeId: "gate-expert", port: "in" } },
    { from: { nodeId: "gate-expert", port: "out" }, to: { nodeId: "transform-expert-brief", port: "in" } },
    { from: { nodeId: "transform-expert-brief", port: "out" }, to: { nodeId: "turn-expert-final", port: "in" } },
    { from: { nodeId: "gate-expert", port: "out" }, to: { nodeId: "transform-expert-rework", port: "in" } },
  ];

  return { version: GRAPH_SCHEMA_VERSION, nodes, edges, knowledge: defaultKnowledgeConfig() };
}

export function buildUnityCiDoctorPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-unity-ci-intake", "turn", 120, 180, {
      model: "GPT-5.4",
      role: "UNITY CI INTAKE AGENT",
      cwd: ".",
      promptTemplate:
        "당신은 Unity CI 닥터의 사고 접수 담당이다.\n" +
        "사용자 입력, 에러 로그, 테스트/빌드 실패 맥락을 읽고 실행 가능한 진단 브리프로 정리하라.\n" +
        "형식:\n" +
        "- incidentSummary:\n" +
        "- failureType:\n" +
        "- likelySubsystems(1~4개):\n" +
        "- knownSignals(로그/오류/스택트레이스):\n" +
        "- missingInputs:\n" +
        "- diagnosisGoal:\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-ci-system", "turn", 460, 40, {
      model: "GPT-5.4",
      role: "UNITY SYSTEM DIAGNOSIS AGENT",
      cwd: ".",
      promptTemplate:
        "Unity 기술 진단 관점에서 입력을 분석하라.\n" +
        "필수:\n" +
        "- probableRootCauses(확률 높은 순서 1~3개)\n" +
        "- suspectedFilesOrModules\n" +
        "- packageOrDependencyRisks\n" +
        "- smallestSafeFix\n" +
        "- evidenceByClaim\n" +
        "추측과 확인된 사실을 분리하라.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-ci-qa", "turn", 460, 180, {
      model: "GPT-5.4",
      role: "UNITY QA TRIAGE AGENT",
      cwd: ".",
      promptTemplate:
        "QA/재현 관점에서 입력을 분석하라.\n" +
        "필수:\n" +
        "- reproSteps\n" +
        "- affectedSurface\n" +
        "- regressionRisks\n" +
        "- mustRerunChecks(EditMode/PlayMode/Build)\n" +
        "- failFastVerification\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-ci-pm", "turn", 460, 320, {
      model: "GPT-5.4",
      role: "UNITY PM IMPACT AGENT",
      cwd: ".",
      promptTemplate:
        "기획/프로덕트 영향 관점에서 입력을 평가하라.\n" +
        "필수:\n" +
        "- playerImpact\n" +
        "- productionPriority(P0~P2)\n" +
        "- canShipOrBlock\n" +
        "- communicationNotes\n" +
        "- recommendedNextOwner\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-ci-judge", "turn", 820, 180, {
      model: "GPT-5.4",
      role: "UNITY CI JUDGE AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 종합해 JSON만 출력하라.\n" +
        "판정 기준: 원인 후보의 타당성, 로그/근거 연결, 재현 가능성, 다음 행동의 구체성.\n" +
        '{ "DECISION":"PASS|REJECT", "finalDraft":"...", "why":["..."], "missingInputs":["..."], "nextAction":"...", "confidence":0.0 }\n' +
        "근거가 약하거나 로그가 부족하면 REJECT.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("gate-unity-ci", "gate", 1120, 180, {
      decisionPath: "DECISION",
      passNodeId: "transform-unity-ci-brief",
      rejectNodeId: "transform-unity-ci-reject",
      schemaJson: "{\"type\":\"object\",\"required\":[\"DECISION\"]}",
    }),
    makePresetNode("transform-unity-ci-brief", "transform", 1300, 80, {
      mode: "template",
      template:
        "Unity CI 닥터 브리프\n" +
        "- 사건 요약: {{input}}\n" +
        "- 반드시 고쳐야 하는 원인 후보와 검증 포인트만 남긴다\n" +
        "- 다음 행동은 1개로 압축한다",
    }),
    makePresetNode("turn-unity-ci-final", "turn", 1580, 80, {
      model: "GPT-5.4",
      role: "UNITY CI SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "최종 Unity CI 진단 보고서를 한국어로 작성하라.\n" +
        "구성:\n" +
        "1) 한 줄 장애 요약\n" +
        "2) 가장 가능성 높은 원인 1~3개\n" +
        "3) 의심 파일/모듈\n" +
        "4) 즉시 할 다음 행동 1개\n" +
        "5) 수정 후 다시 확인할 체크리스트\n" +
        "과장 금지, 모르면 모른다고 명시.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-unity-ci-reject", "transform", 1420, 280, {
      mode: "template",
      template:
        "진단 보류\n" +
        "- 현재 입력만으로는 근거가 부족합니다\n" +
        "- 추가로 필요한 로그/재현 정보/빌드 결과를 수집하세요\n" +
        "원본: {{input}}",
    }),
  ];

  const edges: GraphEdge[] = [
    {
      from: { nodeId: "turn-unity-ci-intake", port: "out" },
      to: { nodeId: "turn-unity-ci-system", port: "in" },
    },
    {
      from: { nodeId: "turn-unity-ci-intake", port: "out" },
      to: { nodeId: "turn-unity-ci-qa", port: "in" },
    },
    {
      from: { nodeId: "turn-unity-ci-intake", port: "out" },
      to: { nodeId: "turn-unity-ci-pm", port: "in" },
    },
    {
      from: { nodeId: "turn-unity-ci-system", port: "out" },
      to: { nodeId: "turn-unity-ci-judge", port: "in" },
    },
    {
      from: { nodeId: "turn-unity-ci-qa", port: "out" },
      to: { nodeId: "turn-unity-ci-judge", port: "in" },
    },
    {
      from: { nodeId: "turn-unity-ci-pm", port: "out" },
      to: { nodeId: "turn-unity-ci-judge", port: "in" },
    },
    {
      from: { nodeId: "turn-unity-ci-judge", port: "out" },
      to: { nodeId: "gate-unity-ci", port: "in" },
    },
    {
      from: { nodeId: "gate-unity-ci", port: "out" },
      to: { nodeId: "transform-unity-ci-brief", port: "in" },
    },
    {
      from: { nodeId: "transform-unity-ci-brief", port: "out" },
      to: { nodeId: "turn-unity-ci-final", port: "in" },
    },
    {
      from: { nodeId: "gate-unity-ci", port: "out" },
      to: { nodeId: "transform-unity-ci-reject", port: "in" },
    },
  ];

  return { version: GRAPH_SCHEMA_VERSION, nodes, edges, knowledge: defaultKnowledgeConfig() };
}
