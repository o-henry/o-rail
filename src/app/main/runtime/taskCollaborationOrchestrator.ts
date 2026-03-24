import {
  getTaskAgentOrchestrationProfile,
  getTaskAgentPresetIdByStudioRoleId,
  getTaskAgentStudioRoleId,
  resolveTaskAgentPresetId,
} from "../../../pages/tasks/taskAgentPresets";

type AdaptiveTaskOrchestrationPlan = {
  participantRoleIds: string[];
  primaryRoleId: string;
  criticRoleId?: string;
  rolePrompts: Record<string, string>;
  orchestrationSummary: string;
  collectExternalWebResearch: boolean;
  externalWebResearchFocus: string;
};

function clip(value: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalizeJsonBlock(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function canonicalTaskRoleId(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  return (
    resolveTaskAgentPresetId(normalized)
    ?? getTaskAgentPresetIdByStudioRoleId(normalized)
    ?? ""
  );
}

function buildAllowedRoleMaps(allowedRoleIds: string[]): {
  canonicalToOriginal: Map<string, string>;
  originalToCanonical: Map<string, string>;
} {
  const canonicalToOriginal = new Map<string, string>();
  const originalToCanonical = new Map<string, string>();
  for (const roleId of allowedRoleIds) {
    const original = String(roleId ?? "").trim();
    if (!original) {
      continue;
    }
    const canonical = canonicalTaskRoleId(original) || original;
    if (!canonicalToOriginal.has(canonical)) {
      canonicalToOriginal.set(canonical, original);
    }
    originalToCanonical.set(original, canonical);
  }
  return {
    canonicalToOriginal,
    originalToCanonical,
  };
}

function resolveAllowedRoleId(
  value: unknown,
  maps: {
    canonicalToOriginal: Map<string, string>;
    originalToCanonical: Map<string, string>;
  },
): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (maps.originalToCanonical.has(normalized)) {
    return normalized;
  }
  const canonical = canonicalTaskRoleId(normalized) || normalized;
  return maps.canonicalToOriginal.get(canonical) ?? "";
}

function normalizeRoleIds(
  roleIds: unknown,
  allowedRoleIds: string[],
  maxParticipants: number,
): string[] {
  if (!Array.isArray(roleIds)) {
    return [];
  }
  const maps = buildAllowedRoleMaps(allowedRoleIds);
  const normalized: string[] = [];
  for (const item of roleIds) {
    const roleId = resolveAllowedRoleId(item, maps);
    if (!roleId || normalized.includes(roleId)) {
      continue;
    }
    normalized.push(roleId);
    if (normalized.length >= maxParticipants) {
      break;
    }
  }
  return normalized;
}

export function buildAdaptiveOrchestrationPrompt(params: {
  prompt: string;
  intent: string;
  contextSummary: string;
  requestedRoleIds: string[];
  candidateRoleIds: string[];
  candidateRolePrompts: Record<string, string>;
  maxParticipants: number;
  heuristicPrimaryRoleId: string;
  heuristicParticipantRoleIds: string[];
}): string {
  const roleBlocks = params.candidateRoleIds.flatMap((roleId) => {
    const profile = getTaskAgentOrchestrationProfile(roleId);
    if (!profile) {
      return [];
    }
    const baselineAssignment =
      clip(
        String(
          params.candidateRolePrompts[roleId]
          ?? params.candidateRolePrompts[profile.roleId]
          ?? params.candidateRolePrompts[getTaskAgentStudioRoleId(profile.roleId) ?? ""]
          ?? "",
        ).trim(),
        700,
      ) || "없음";
    return [[
    `- role_id: ${profile.roleId}`,
    `  label: ${profile.label}`,
    `  summary: ${clip(profile.summary, 220)}`,
    `  strengths: ${profile.strengths.join(" / ")}`,
    `  limits: ${profile.limits.join(" / ")}`,
    `  use_when: ${profile.useWhen.join(" / ")}`,
    `  baseline_assignment: ${baselineAssignment}`,
  ].join("\n")];
  });
  return [
    "# 작업 모드",
    "메인 오케스트레이터",
    "",
    "# 목표",
    "사용자 요청을 가장 잘 해결하기 위한 서브워커 조합과 역할별 지시를 재배정한다.",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 의도 추정",
    params.intent,
    "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    "# 사용자 멘션 힌트",
    params.requestedRoleIds.length > 0 ? params.requestedRoleIds.join(", ") : "없음",
    "",
    "# 사용 가능한 전체 서브워커 목록",
    roleBlocks.join("\n"),
    "",
    "# 규칙 기반 fallback 초안",
    `- primary_role_id: ${params.heuristicPrimaryRoleId}`,
    `- participant_role_ids: ${params.heuristicParticipantRoleIds.join(", ") || "없음"}`,
    "",
    "# 오케스트레이션 규칙",
    "- 먼저 전체 서브워커 목록과 각 역할의 강점/한계/사용 상황을 보고 독립적으로 배치 결정을 내린다.",
    "- 아래 규칙 기반 초안은 오케스트레이션 판단이 애매하거나 실패할 때만 fallback 참고용으로 쓴다.",
    `- 참여 역할은 1명 이상 ${params.maxParticipants}명 이하로 고른다.`,
    "- 멘션은 힌트일 뿐이며, 사용자 의도에 더 맞는 역할 조합이 있으면 재배치한다.",
    "- 역할 수는 최소화하되 답의 질이 떨어지지 않게 한다.",
    "- ideation이면 game_designer를 기본 주역으로 보고, researcher는 근거/클리셰/시장 신호 보조에 집중시킨다.",
    "- researcher 단독 조사 요청이면 researcher만 유지한다.",
    "- unity_architect는 현실성/기술 리스크/범위 검토를 맡기고, 아이디어 발산의 주역으로 쓰지 않는다.",
    "- 각 역할 지시는 서로 겹치지 않게 구체적으로 나눈다.",
    "- 외부 웹 조사/커뮤니티 반응/시장 근거/레퍼런스 수집이 답의 품질에 실질적으로 중요하면 collect_external_web_research를 true로 설정한다.",
    "- collect_external_web_research가 true면 external_web_research_focus에 무엇을 조사해야 하는지 한 줄로 적는다. 필요 없으면 빈 문자열로 둔다.",
    "",
    "# 출력 형식",
    "반드시 아래 JSON 객체만 출력한다. 설명 문장이나 코드펜스는 금지한다.",
    `{"participant_role_ids":["role_a"],"primary_role_id":"role_a","critic_role_id":"role_b 또는 빈 문자열","collect_external_web_research":true,"external_web_research_focus":"조사 포커스 또는 빈 문자열","orchestration_summary":"한 줄 요약","role_assignments":{"role_a":"역할별 지시","role_b":"역할별 지시"}}`,
  ].join("\n");
}

export function parseAdaptiveOrchestrationPlan(params: {
  text: string;
  allowedRoleIds: string[];
  maxParticipants: number;
  fallbackPrimaryRoleId: string;
  fallbackCriticRoleId?: string;
  fallbackRolePrompts: Record<string, string>;
}): AdaptiveTaskOrchestrationPlan | null {
  const payload = normalizeJsonBlock(params.text);
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const allowedMaps = buildAllowedRoleMaps(params.allowedRoleIds);
    const participantRoleIds = normalizeRoleIds(
      parsed.participant_role_ids,
      params.allowedRoleIds,
      params.maxParticipants,
    );
    if (participantRoleIds.length === 0) {
      return null;
    }
    const primaryCandidate = resolveAllowedRoleId(parsed.primary_role_id, allowedMaps);
    const primaryRoleId = participantRoleIds.includes(primaryCandidate)
      ? primaryCandidate
      : (participantRoleIds.includes(params.fallbackPrimaryRoleId) ? params.fallbackPrimaryRoleId : participantRoleIds[0]);
    const criticCandidate = resolveAllowedRoleId(parsed.critic_role_id, allowedMaps);
    const criticRoleId = criticCandidate && criticCandidate !== primaryRoleId && participantRoleIds.includes(criticCandidate)
      ? criticCandidate
      : (params.fallbackCriticRoleId && params.fallbackCriticRoleId !== primaryRoleId && participantRoleIds.includes(params.fallbackCriticRoleId)
        ? params.fallbackCriticRoleId
        : undefined);
    const rawAssignments = parsed.role_assignments && typeof parsed.role_assignments === "object"
      ? (parsed.role_assignments as Record<string, unknown>)
      : {};
    const rolePrompts = Object.fromEntries(
      participantRoleIds.map((roleId) => {
        const canonicalRoleId = allowedMaps.originalToCanonical.get(roleId) ?? roleId;
        const studioRoleId = getTaskAgentStudioRoleId(canonicalRoleId) ?? "";
        const assignment = clip(
          String(
            rawAssignments[roleId]
            ?? rawAssignments[canonicalRoleId]
            ?? rawAssignments[studioRoleId]
            ?? "",
          ).trim(),
          1200,
        );
        return [
          roleId,
          assignment
          || params.fallbackRolePrompts[roleId]
          || params.fallbackRolePrompts[canonicalRoleId]
          || params.fallbackRolePrompts[studioRoleId]
          || "",
        ];
      }),
    ) as Record<string, string>;
    const orchestrationSummary = clip(String(parsed.orchestration_summary ?? "").trim(), 280)
      || `메인 오케스트레이터가 ${participantRoleIds.join(", ")} 조합으로 재배치했습니다.`;
    const collectExternalWebResearch = Boolean(parsed.collect_external_web_research);
    const externalWebResearchFocus = clip(String(parsed.external_web_research_focus ?? "").trim(), 240);
    return {
      participantRoleIds: [
        primaryRoleId,
        ...participantRoleIds.filter((roleId) => roleId !== primaryRoleId),
      ],
      primaryRoleId,
      criticRoleId,
      rolePrompts,
      orchestrationSummary,
      collectExternalWebResearch,
      externalWebResearchFocus,
    };
  } catch {
    return null;
  }
}
