import type { GraphData, GraphEdge, GraphNode } from "../types";
import { GRAPH_SCHEMA_VERSION, defaultKnowledgeConfig, makePresetNode } from "./shared";

function finalize(nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  return { version: GRAPH_SCHEMA_VERSION, nodes, edges, knowledge: defaultKnowledgeConfig() };
}

export function buildUnityTestsmithPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-unity-test-intake", "turn", 120, 180, {
      model: "GPT-5.4",
      role: "UNITY TEST INTAKE AGENT",
      cwd: ".",
      promptTemplate:
        "당신은 Unity Testsmith의 테스트 접수 담당이다.\n" +
        "사용자 요청, 실패 사례, 대상 스크립트/시스템을 읽고 테스트 생성 브리프로 정리하라.\n" +
        "형식: targetArea / currentBehavior / expectedBehavior / criticalScenarios / missingInputs / testGoal.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-test-design", "turn", 440, 40, {
      model: "GPT-5.4",
      role: "UNITY TEST DESIGN AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 바탕으로 Unity 테스트 설계를 작성하라.\n" +
        "필수: testMatrix / mocksOrFixtures / fragilePoints / falsePositiveRisks.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-test-editmode", "turn", 440, 180, {
      model: "GPT-5.4",
      role: "UNITY EDITMODE TEST AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 바탕으로 EditMode 테스트 초안과 실행 전략을 작성하라.\n" +
        "필수: candidateTests / setup / assertions / cliCommand.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-test-playmode", "turn", 440, 320, {
      model: "GPT-5.4",
      role: "UNITY PLAYMODE TEST AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 바탕으로 PlayMode 테스트 초안과 실행 전략을 작성하라.\n" +
        "필수: candidateTests / sceneRequirements / assertions / cliCommand.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-test-qa", "turn", 800, 180, {
      model: "GPT-5.4",
      role: "UNITY TEST QA AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 종합해 JSON만 출력하라.\n" +
        '{ "DECISION":"PASS|REJECT", "finalDraft":"...", "coverageGaps":["..."], "nextAction":"...", "confidence":0.0 }\n' +
        "판정 기준: 재현력, 회귀 위험 포착, 실행 가능성.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("gate-unity-test", "gate", 1100, 180, {
      decisionPath: "DECISION",
      passNodeId: "transform-unity-test-brief",
      rejectNodeId: "transform-unity-test-reject",
      schemaJson: "{\"type\":\"object\",\"required\":[\"DECISION\"]}",
    }),
    makePresetNode("transform-unity-test-brief", "transform", 1280, 80, {
      mode: "template",
      template: "Unity Testsmith 브리프\n- 테스트 전략과 우선순위만 정리\n- 다음 행동은 1개로 압축\n입력: {{input}}",
    }),
    makePresetNode("turn-unity-test-final", "turn", 1560, 80, {
      model: "GPT-5.4",
      role: "UNITY TEST SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "최종 Unity 테스트 실행 가이드를 작성하라.\n" +
        "구성: 핵심 테스트 목록 / 먼저 돌릴 명령 / 실패 시 추적 포인트 / 다음 행동.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-unity-test-reject", "transform", 1420, 280, {
      mode: "template",
      template: "테스트 설계 보류\n- 입력이 부족하거나 커버리지가 불충분함\n- 추가로 필요한 정보와 실패 로그를 먼저 수집\n원본: {{input}}",
    }),
  ];
  const edges: GraphEdge[] = [
    { from: { nodeId: "turn-unity-test-intake", port: "out" }, to: { nodeId: "turn-unity-test-design", port: "in" } },
    { from: { nodeId: "turn-unity-test-intake", port: "out" }, to: { nodeId: "turn-unity-test-editmode", port: "in" } },
    { from: { nodeId: "turn-unity-test-intake", port: "out" }, to: { nodeId: "turn-unity-test-playmode", port: "in" } },
    { from: { nodeId: "turn-unity-test-design", port: "out" }, to: { nodeId: "turn-unity-test-qa", port: "in" } },
    { from: { nodeId: "turn-unity-test-editmode", port: "out" }, to: { nodeId: "turn-unity-test-qa", port: "in" } },
    { from: { nodeId: "turn-unity-test-playmode", port: "out" }, to: { nodeId: "turn-unity-test-qa", port: "in" } },
    { from: { nodeId: "turn-unity-test-qa", port: "out" }, to: { nodeId: "gate-unity-test", port: "in" } },
    { from: { nodeId: "gate-unity-test", port: "out" }, to: { nodeId: "transform-unity-test-brief", port: "in" } },
    { from: { nodeId: "transform-unity-test-brief", port: "out" }, to: { nodeId: "turn-unity-test-final", port: "in" } },
    { from: { nodeId: "gate-unity-test", port: "out" }, to: { nodeId: "transform-unity-test-reject", port: "in" } },
  ];
  return finalize(nodes, edges);
}

export function buildUnityBuildWatcherPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-unity-build-intake", "turn", 120, 180, {
      model: "GPT-5.4",
      role: "UNITY BUILD WATCHER INTAKE AGENT",
      cwd: ".",
      promptTemplate:
        "빌드/사이즈 감시 요청을 브리프로 구조화하라.\n" +
        "형식: targetPlatform / currentBuild / comparisonBase / expectedBudget / missingInputs.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-build-report", "turn", 440, 60, {
      model: "GPT-5.4",
      role: "UNITY BUILD REPORT AGENT",
      cwd: ".",
      promptTemplate:
        "BuildReport/로그 관점에서 입력을 분석하라.\n" +
        "필수: buildTimeDelta / failureSignals / suspiciousStages / evidenceByClaim.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-size-regression", "turn", 440, 220, {
      model: "GPT-5.4",
      role: "UNITY SIZE REGRESSION AGENT",
      cwd: ".",
      promptTemplate:
        "사이즈 회귀 관점에서 입력을 분석하라.\n" +
        "필수: sizeDelta / largestArtifacts / probableCauses / rollbackCandidates.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-build-risk", "turn", 800, 180, {
      model: "GPT-5.4",
      role: "UNITY BUILD RISK AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 종합해 JSON만 출력하라.\n" +
        '{ "DECISION":"PASS|REJECT", "finalDraft":"...", "watchItems":["..."], "nextAction":"...", "confidence":0.0 }\n' +
        "판정 기준: 빌드 회귀의 신뢰도, 원인 설명력, 추적 우선순위.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("gate-unity-build", "gate", 1100, 180, {
      decisionPath: "DECISION",
      passNodeId: "transform-unity-build-brief",
      rejectNodeId: "transform-unity-build-reject",
      schemaJson: "{\"type\":\"object\",\"required\":[\"DECISION\"]}",
    }),
    makePresetNode("transform-unity-build-brief", "transform", 1280, 80, {
      mode: "template",
      template: "Build/Size Watcher 브리프\n- 시간/용량 회귀와 우선순위만 정리\n- 다음 행동은 1개로 압축\n입력: {{input}}",
    }),
    makePresetNode("turn-unity-build-final", "turn", 1560, 80, {
      model: "GPT-5.4",
      role: "UNITY BUILD SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "최종 빌드/사이즈 회귀 보고서를 작성하라.\n" +
        "구성: 요약 / 회귀 원인 후보 / 가장 무거운 항목 / 지금 할 일.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-unity-build-reject", "transform", 1420, 280, {
      mode: "template",
      template: "회귀 판정 보류\n- 비교 기준 또는 리포트가 부족함\n- BuildReport/build layout 추가 수집 필요\n원본: {{input}}",
    }),
  ];
  const edges: GraphEdge[] = [
    { from: { nodeId: "turn-unity-build-intake", port: "out" }, to: { nodeId: "turn-unity-build-report", port: "in" } },
    { from: { nodeId: "turn-unity-build-intake", port: "out" }, to: { nodeId: "turn-unity-size-regression", port: "in" } },
    { from: { nodeId: "turn-unity-build-report", port: "out" }, to: { nodeId: "turn-unity-build-risk", port: "in" } },
    { from: { nodeId: "turn-unity-size-regression", port: "out" }, to: { nodeId: "turn-unity-build-risk", port: "in" } },
    { from: { nodeId: "turn-unity-build-risk", port: "out" }, to: { nodeId: "gate-unity-build", port: "in" } },
    { from: { nodeId: "gate-unity-build", port: "out" }, to: { nodeId: "transform-unity-build-brief", port: "in" } },
    { from: { nodeId: "transform-unity-build-brief", port: "out" }, to: { nodeId: "turn-unity-build-final", port: "in" } },
    { from: { nodeId: "gate-unity-build", port: "out" }, to: { nodeId: "transform-unity-build-reject", port: "in" } },
  ];
  return finalize(nodes, edges);
}

export function buildUnityLocalizationQaPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-unity-loc-intake", "turn", 120, 180, {
      model: "GPT-5.4",
      role: "UNITY LOCALIZATION INTAKE AGENT",
      cwd: ".",
      promptTemplate:
        "Localization QA 요청을 브리프로 구조화하라.\n" +
        "형식: locales / sourceTables / knownIssues / targetChecks / missingInputs.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-loc-keys", "turn", 440, 40, {
      model: "GPT-5.4",
      role: "UNITY STRING TABLE QA AGENT",
      cwd: ".",
      promptTemplate:
        "String Table 기준으로 입력을 검사하라.\n" +
        "필수: missingKeys / orphanKeys / inconsistentValues / evidenceByClaim.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-loc-placeholders", "turn", 440, 180, {
      model: "GPT-5.4",
      role: "UNITY PLACEHOLDER QA AGENT",
      cwd: ".",
      promptTemplate:
        "플레이스홀더와 포맷 문자열 관점에서 입력을 검사하라.\n" +
        "필수: placeholderMismatches / formattingRisks / crashRisks / fixHints.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-loc-terms", "turn", 440, 320, {
      model: "GPT-5.4",
      role: "UNITY TERMINOLOGY QA AGENT",
      cwd: ".",
      promptTemplate:
        "용어 일관성과 UI 길이 관점에서 입력을 검사하라.\n" +
        "필수: termInconsistencies / overlongStrings / contextualRisks / fixHints.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-loc-judge", "turn", 800, 180, {
      model: "GPT-5.4",
      role: "UNITY LOCALIZATION JUDGE AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 종합해 JSON만 출력하라.\n" +
        '{ "DECISION":"PASS|REJECT", "finalDraft":"...", "blockingIssues":["..."], "nextAction":"...", "confidence":0.0 }\n' +
        "판정 기준: 사용자 노출 위험, 크래시 가능성, 수정 우선순위 명확성.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("gate-unity-loc", "gate", 1100, 180, {
      decisionPath: "DECISION",
      passNodeId: "transform-unity-loc-brief",
      rejectNodeId: "transform-unity-loc-reject",
      schemaJson: "{\"type\":\"object\",\"required\":[\"DECISION\"]}",
    }),
    makePresetNode("transform-unity-loc-brief", "transform", 1280, 80, {
      mode: "template",
      template: "Localization QA 브리프\n- 번역 누락/불일치/위험만 정리\n- 다음 행동은 1개로 압축\n입력: {{input}}",
    }),
    makePresetNode("turn-unity-loc-final", "turn", 1560, 80, {
      model: "GPT-5.4",
      role: "UNITY LOCALIZATION SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "최종 Localization QA 보고서를 작성하라.\n" +
        "구성: 핵심 문제 / 영향 언어 / 즉시 고칠 항목 / 재검증 체크리스트.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-unity-loc-reject", "transform", 1420, 280, {
      mode: "template",
      template: "Localization QA 보류\n- 테이블 데이터가 부족하거나 검사 범위가 모호함\n- 테이블/스크린샷/문맥 추가 필요\n원본: {{input}}",
    }),
  ];
  const edges: GraphEdge[] = [
    { from: { nodeId: "turn-unity-loc-intake", port: "out" }, to: { nodeId: "turn-unity-loc-keys", port: "in" } },
    { from: { nodeId: "turn-unity-loc-intake", port: "out" }, to: { nodeId: "turn-unity-loc-placeholders", port: "in" } },
    { from: { nodeId: "turn-unity-loc-intake", port: "out" }, to: { nodeId: "turn-unity-loc-terms", port: "in" } },
    { from: { nodeId: "turn-unity-loc-keys", port: "out" }, to: { nodeId: "turn-unity-loc-judge", port: "in" } },
    { from: { nodeId: "turn-unity-loc-placeholders", port: "out" }, to: { nodeId: "turn-unity-loc-judge", port: "in" } },
    { from: { nodeId: "turn-unity-loc-terms", port: "out" }, to: { nodeId: "turn-unity-loc-judge", port: "in" } },
    { from: { nodeId: "turn-unity-loc-judge", port: "out" }, to: { nodeId: "gate-unity-loc", port: "in" } },
    { from: { nodeId: "gate-unity-loc", port: "out" }, to: { nodeId: "transform-unity-loc-brief", port: "in" } },
    { from: { nodeId: "transform-unity-loc-brief", port: "out" }, to: { nodeId: "turn-unity-loc-final", port: "in" } },
    { from: { nodeId: "gate-unity-loc", port: "out" }, to: { nodeId: "transform-unity-loc-reject", port: "in" } },
  ];
  return finalize(nodes, edges);
}

export function buildUnityAddressablesDietPreset(): GraphData {
  const nodes: GraphNode[] = [
    makePresetNode("turn-unity-addr-intake", "turn", 120, 180, {
      model: "GPT-5.4",
      role: "UNITY ADDRESSABLES INTAKE AGENT",
      cwd: ".",
      promptTemplate:
        "Addressables/Asset Diet 요청을 브리프로 구조화하라.\n" +
        "형식: targetBuild / layoutSource / biggestPain / expectedBudget / missingInputs.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-addr-layout", "turn", 440, 40, {
      model: "GPT-5.4",
      role: "UNITY BUILD LAYOUT AGENT",
      cwd: ".",
      promptTemplate:
        "build layout 관점에서 입력을 분석하라.\n" +
        "필수: largestBundles / largestAssets / loadRisks / evidenceByClaim.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-addr-dup", "turn", 440, 180, {
      model: "GPT-5.4",
      role: "UNITY DUPLICATE DEPENDENCY AGENT",
      cwd: ".",
      promptTemplate:
        "중복 의존성과 불필요한 번들 분리를 분석하라.\n" +
        "필수: duplicateDependencies / sharedBundleRisks / probableFixes.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-addr-load", "turn", 440, 320, {
      model: "GPT-5.4",
      role: "UNITY LOAD COST AGENT",
      cwd: ".",
      promptTemplate:
        "로드 비용/메모리 위험 관점에서 입력을 분석하라.\n" +
        "필수: loadHotspots / memoryRisks / runtimeSymptoms / fixOrder.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("turn-unity-addr-judge", "turn", 800, 180, {
      model: "GPT-5.4",
      role: "UNITY ADDRESSABLES JUDGE AGENT",
      cwd: ".",
      promptTemplate:
        "입력을 종합해 JSON만 출력하라.\n" +
        '{ "DECISION":"PASS|REJECT", "finalDraft":"...", "blockingIssues":["..."], "nextAction":"...", "confidence":0.0 }\n' +
        "판정 기준: 실제 최적화 가치, 원인 추적 가능성, 안전한 수정 우선순위.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("gate-unity-addr", "gate", 1100, 180, {
      decisionPath: "DECISION",
      passNodeId: "transform-unity-addr-brief",
      rejectNodeId: "transform-unity-addr-reject",
      schemaJson: "{\"type\":\"object\",\"required\":[\"DECISION\"]}",
    }),
    makePresetNode("transform-unity-addr-brief", "transform", 1280, 80, {
      mode: "template",
      template: "Addressables / Asset Diet 브리프\n- 큰 번들/중복 의존성/로드 위험만 정리\n- 다음 행동은 1개로 압축\n입력: {{input}}",
    }),
    makePresetNode("turn-unity-addr-final", "turn", 1560, 80, {
      model: "GPT-5.4",
      role: "UNITY ADDRESSABLES SYNTHESIS AGENT",
      cwd: ".",
      promptTemplate:
        "최종 Addressables 최적화 보고서를 작성하라.\n" +
        "구성: 핵심 병목 / 의심 번들 / 안전한 수정 순서 / 재측정 체크리스트.\n" +
        "입력: {{input}}",
    }),
    makePresetNode("transform-unity-addr-reject", "transform", 1420, 280, {
      mode: "template",
      template: "Addressables 분석 보류\n- build layout 또는 의존성 정보가 부족함\n- 추가 리포트를 먼저 수집\n원본: {{input}}",
    }),
  ];
  const edges: GraphEdge[] = [
    { from: { nodeId: "turn-unity-addr-intake", port: "out" }, to: { nodeId: "turn-unity-addr-layout", port: "in" } },
    { from: { nodeId: "turn-unity-addr-intake", port: "out" }, to: { nodeId: "turn-unity-addr-dup", port: "in" } },
    { from: { nodeId: "turn-unity-addr-intake", port: "out" }, to: { nodeId: "turn-unity-addr-load", port: "in" } },
    { from: { nodeId: "turn-unity-addr-layout", port: "out" }, to: { nodeId: "turn-unity-addr-judge", port: "in" } },
    { from: { nodeId: "turn-unity-addr-dup", port: "out" }, to: { nodeId: "turn-unity-addr-judge", port: "in" } },
    { from: { nodeId: "turn-unity-addr-load", port: "out" }, to: { nodeId: "turn-unity-addr-judge", port: "in" } },
    { from: { nodeId: "turn-unity-addr-judge", port: "out" }, to: { nodeId: "gate-unity-addr", port: "in" } },
    { from: { nodeId: "gate-unity-addr", port: "out" }, to: { nodeId: "transform-unity-addr-brief", port: "in" } },
    { from: { nodeId: "transform-unity-addr-brief", port: "out" }, to: { nodeId: "turn-unity-addr-final", port: "in" } },
    { from: { nodeId: "gate-unity-addr", port: "out" }, to: { nodeId: "transform-unity-addr-reject", port: "in" } },
  ];
  return finalize(nodes, edges);
}
