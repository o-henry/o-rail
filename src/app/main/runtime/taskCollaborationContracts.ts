export type TaskCollaborationContract = {
  mode: "ideation" | "delivery";
  responseShape: "numbered_ideas" | "cohesive_answer";
  successCriteria: string[];
  guardrails: string[];
};

export function buildTaskCollaborationContract(params: {
  intent?: string;
  creativeMode?: boolean;
}): TaskCollaborationContract {
  const isIdeation = String(params.intent ?? "").trim().toLowerCase() === "ideation";
  const creativeMode = Boolean(params.creativeMode) && isIdeation;

  if (isIdeation) {
    return {
      mode: "ideation",
      responseShape: "numbered_ideas",
      successCriteria: [
        "사용자 요청에 바로 전달할 수 있는 아이디어 결과를 남긴다.",
        "아이디어마다 훅, 핵심 루프, 차별화 포인트를 포함한다.",
        "무난한 평균 답이나 상투적 조합을 우선 탈락시킨다.",
      ],
      guardrails: [
        "내부 handoff, 기준 확정, 파일 수정 보고로 답변을 대체하지 않는다.",
        creativeMode
          ? "Creative Mode가 켜져 있으므로, 설명만 화려한 후보보다 기억에 남는 후보를 우선한다."
          : "상투적 표현과 장르 태그 나열만으로 답하지 않는다.",
      ],
    };
  }

  return {
    mode: "delivery",
    responseShape: "cohesive_answer",
    successCriteria: [
      "사용자 요청을 직접 해결하는 하나의 답변으로 합친다.",
      "핵심 사실, 구현 포인트, 리스크를 구분해 전달한다.",
      "필요한 경우에만 다음 행동과 확인 포인트를 짧게 남긴다.",
    ],
    guardrails: [
      "역할별 원문, 내부 handoff, 메타데이터를 그대로 노출하지 않는다.",
      "다음 단계 제안만 남기고 끝내지 않는다.",
    ],
  };
}

export function renderTaskCollaborationContract(contract: TaskCollaborationContract): string {
  return [
    "# 작업 계약",
    `- 모드: ${contract.mode}`,
    `- 응답 형식: ${contract.responseShape}`,
    ...contract.successCriteria.map((criterion) => `- 성공 조건: ${criterion}`),
    ...contract.guardrails.map((guardrail) => `- 가드레일: ${guardrail}`),
  ].join("\n");
}
