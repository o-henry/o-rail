import type { StudioRoleId } from "./handoffTypes";
import { STUDIO_ROLE_TEMPLATES } from "./roleTemplates";

type RolePromptShape = {
  roleId?: StudioRoleId | string;
  roleLabel?: string;
  goal?: string;
  taskId?: string;
  request: string;
  starterPrompt?: string;
  extraGuidance?: string[];
  contextBlocks?: string[];
};

type RolePromptSpec = {
  focus: string[];
  deliverables: string[];
};

const GENERIC_ROLE_SPEC: RolePromptSpec = {
  focus: [
    "요청을 바로 실행 가능한 작업 단위로 재정리합니다.",
    "불확실한 부분은 추측하지 말고 가정 또는 추가 확인 포인트로 분리합니다.",
  ],
  deliverables: [
    "## 결론",
    "## 실행안 또는 산출물",
    "## 리스크/열린 질문",
  ],
};

const ROLE_PROMPT_SPECS: Record<StudioRoleId, RolePromptSpec> = {
  pm_planner: {
    focus: ["범위, 우선순위, 수용 기준을 먼저 고정합니다.", "역할 간 handoff가 가능한 작업 순서와 완료 조건을 만듭니다."],
    deliverables: ["## 요구사항 요약", "## 우선순위와 완료 기준", "## 다음 handoff"],
  },
  pm_creative_director: {
    focus: [
      "익숙한 패턴 재진술 대신 새로운 조합, 반전, 장르 혼합, 감정적 훅을 우선 탐색합니다.",
      "창의적인 아이디어라도 왜 이 프로젝트 제약 안에서 성립 가능한지 최소 구현 가설까지 같이 제시합니다.",
    ],
    deliverables: ["## 창의적 코어 제안", "## 차별화 포인트", "## 빠른 검증 실험", "## 다음 handoff"],
  },
  pm_feasibility_critic: {
    focus: [
      "좋아 보이는 설명보다 실패 가능성, 숨겨진 비용, 일정 지연 요인을 먼저 적발합니다.",
      "평가는 정성 문구로 흐리지 말고 0-10 점수와 근거를 함께 제시합니다.",
    ],
    deliverables: ["## 총평", "## 현실성 평가표", "## 치명 리스크", "## 조건부 진행안"],
  },
  research_analyst: {
    focus: [
      "수집된 dataset, 무료 공식 API/피드, 공식 문서, 공개 웹 자료를 구분해서 사용하고 먼저 사실과 출처를 정리합니다.",
      "질문의 도메인에 맞는 근거를 선택하고, 무료 공식 API나 공개 JSON/RSS가 있으면 HTML 스크래핑보다 우선 사용합니다.",
    ],
    deliverables: ["## 조사 결론", "## 핵심 근거", "## 시사점", "## 추가 수집 포인트"],
  },
  client_programmer: {
    focus: ["게임플레이와 UX 동작을 코드/입력/상태 기준으로 쪼갭니다.", "기존 네이밍과 구조를 유지하면서 최소 수정으로 제안합니다."],
    deliverables: ["## 구현 방향", "## 수정 대상", "## 확인해야 할 플레이 포인트"],
  },
  system_programmer: {
    focus: ["아키텍처, 데이터 흐름, 성능/안정성 리스크를 먼저 봅니다.", "확장성보다 현재 문제를 가장 작은 변경으로 해결하는 쪽을 우선합니다."],
    deliverables: ["## 구조 판단", "## 핵심 리스크", "## 안전한 수정 순서"],
  },
  tooling_engineer: {
    focus: ["반복 작업을 줄이는 스크립트/에디터 유틸/자동화를 우선합니다.", "사람이 다시 실행하기 쉬운 명령과 검증 루프를 남깁니다."],
    deliverables: ["## 자동화 제안", "## 실행 명령", "## 유지보수 메모"],
  },
  art_pipeline: {
    focus: ["리소스 임포트, 포맷, 용량, 성능 영향 기준으로 판단합니다.", "아티스트/개발자가 바로 이어서 작업할 수 있게 경로와 규칙을 남깁니다."],
    deliverables: ["## 파이프라인 판단", "## 리소스 체크포인트", "## 후속 처리"],
  },
  qa_engineer: {
    focus: ["재현 경로, 기대 결과, 실제 결과, 회귀 범위를 분리합니다.", "버그를 닫는 것이 아니라 다시 검증 가능한 조건을 명확히 합니다."],
    deliverables: ["## 재현/검증 포인트", "## 회귀 위험", "## 추가 확인 항목"],
  },
  build_release: {
    focus: ["빌드, 배포, 버전, 릴리즈 차단 요소를 우선 식별합니다.", "체크리스트와 실패 시 되돌림 포인트를 함께 남깁니다."],
    deliverables: ["## 릴리즈 체크리스트", "## 차단 요소", "## 배포 전 확인"],
  },
  technical_writer: {
    focus: ["핸드오프와 운영 문서가 빠르게 읽히도록 구조화합니다.", "의사결정 이유와 실행 절차를 분리해서 적습니다."],
    deliverables: ["## 문서 요약", "## 절차/근거", "## 운영 메모"],
  },
};

const REVIEW_STYLE_ROLE_IDS = new Set<StudioRoleId>([
  "pm_feasibility_critic",
  "system_programmer",
  "art_pipeline",
  "qa_engineer",
  "build_release",
]);

function cleanLine(value: unknown): string {
  return String(value ?? "").trim();
}

function uniqueLines(lines: string[]): string[] {
  return [...new Set(lines.map((line) => cleanLine(line)).filter(Boolean))];
}

function wrapSection(tag: string, lines: string[]): string {
  return [`<${tag}>`, ...lines, `</${tag}>`].join("\n");
}

function resolveRoleSpec(roleId?: StudioRoleId | string): RolePromptSpec {
  if (!roleId) {
    return GENERIC_ROLE_SPEC;
  }
  return ROLE_PROMPT_SPECS[roleId as StudioRoleId] ?? GENERIC_ROLE_SPEC;
}

function resolveRoleLabel(roleId?: StudioRoleId | string, roleLabel?: string): string {
  const provided = cleanLine(roleLabel);
  if (provided) {
    return provided;
  }
  const matched = STUDIO_ROLE_TEMPLATES.find((role) => role.id === roleId);
  const fallback = cleanLine(roleId);
  return matched?.label ?? (fallback || "에이전트");
}

function resolveRoleGoal(roleId?: StudioRoleId | string, goal?: string): string {
  const provided = cleanLine(goal);
  if (provided) {
    return provided;
  }
  const matched = STUDIO_ROLE_TEMPLATES.find((role) => role.id === roleId);
  return matched?.goal ?? "주어진 작업을 정확하고 실행 가능하게 처리";
}

export function buildStudioRolePromptEnvelope(input: RolePromptShape): string {
  const roleLabel = resolveRoleLabel(input.roleId, input.roleLabel);
  const roleGoal = resolveRoleGoal(input.roleId, input.goal);
  const roleSpec = resolveRoleSpec(input.roleId);
  const taskId = cleanLine(input.taskId) || "TASK-UNSPECIFIED";
  const request = cleanLine(input.request);
  const starterPrompt = cleanLine(input.starterPrompt);
  const extraGuidance = uniqueLines(input.extraGuidance ?? []);
  const contextBlocks = uniqueLines(input.contextBlocks ?? []);

  const roleProfileBlock = wrapSection("role_profile", [
    `role_name: ${roleLabel}`,
    `task_id: ${taskId}`,
    `mission: ${roleGoal}`,
  ]);

  const operatingRulesBlock = wrapSection("operating_rules", [
    "- 지시는 짧고 직접적으로 해석하고, 목표 달성에 필요한 핵심 단계만 유지합니다.",
    "- 숨겨진 추론 과정은 노출하지 말고 결론, 짧은 근거, 다음 행동만 제시합니다.",
    "- 정보가 부족하면 추측하지 말고 필요한 가정 또는 확인 포인트를 분리합니다.",
    "- 예시는 요청에 포함된 경우만 사용하고, 불필요한 few-shot 패턴을 임의로 만들지 않습니다.",
    "- 섹션 경계를 유지하고 각 블록의 목적을 섞지 않습니다.",
    ...(input.roleId === "pm_feasibility_critic"
      ? ["- 현실성 평가는 항목별 점수(0-10), 총점, 한 줄 근거를 함께 남깁니다."]
      : []),
    ...(input.roleId && REVIEW_STYLE_ROLE_IDS.has(input.roleId as StudioRoleId)
      ? [
          "- 여러 제안안을 비교할 때는 창의성을 곧바로 허황됨으로 치부하지 말고 제약과 실행 가설 기준으로 판단합니다.",
          "- 다수결처럼 평균내지 말고 공통 장점, 치명 리스크, 충돌 지점을 분리합니다.",
        ]
      : []),
  ]);

  const roleFocusBlock = wrapSection("role_focus", [
    ...roleSpec.focus.map((line) => `- ${line}`),
    ...extraGuidance.map((line) => `- ${line}`),
  ]);

  const responseContractBlock = wrapSection("response_contract", [
    "- Markdown으로 작성합니다.",
    "- 아래 섹션 이름을 그대로 사용합니다.",
    ...roleSpec.deliverables.map((line) => `- ${line}`),
    "- 각 섹션은 bullet 또는 짧은 문단으로만 작성합니다.",
    ...(input.roleId && REVIEW_STYLE_ROLE_IDS.has(input.roleId as StudioRoleId)
      ? [
          "- 각 제안안마다 `keep`, `revise`, `drop` 중 하나를 명시합니다.",
          "- 장점 2개, 치명 단점 2개, 수정 제안 2개 이하로 제한합니다.",
        ]
      : []),
  ]);

  const starterBlock = starterPrompt
    ? wrapSection("starter_context", [starterPrompt])
    : "";

  const taskRequestBlock = wrapSection("task_request", [request]);

  return [
    "Formatting re-enabled",
    roleProfileBlock,
    operatingRulesBlock,
    roleFocusBlock,
    responseContractBlock,
    starterBlock,
    ...contextBlocks,
    taskRequestBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}
