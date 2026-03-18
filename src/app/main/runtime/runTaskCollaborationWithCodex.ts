type CollaborationRoleRunResult = {
  roleId: string;
  runId: string;
  summary: string;
  artifactPaths: string[];
};

type ExecuteRoleRun = (params: {
  roleId: string;
  prompt: string;
  promptMode: "brief" | "critique" | "final";
  internal: boolean;
  model?: string;
  reasoning?: string;
  outputArtifactName?: string;
  includeRoleKnowledge?: boolean;
}) => Promise<CollaborationRoleRunResult>;

type CollaborationProgress = {
  roleId?: string;
  stage: "codex" | "critic" | "save";
  message: string;
};

export type TaskCollaborationResult = {
  participantResults: CollaborationRoleRunResult[];
  criticResult?: CollaborationRoleRunResult;
  finalResult: CollaborationRoleRunResult;
};

function clip(value: string, maxChars: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function renderRoleSummary(result: CollaborationRoleRunResult): string {
  return `## ${result.roleId}\n${clip(result.summary, 900)}`;
}

function buildBriefPrompt(params: {
  prompt: string;
  contextSummary: string;
  participantRoleIds: string[];
  cappedParticipantCount: boolean;
}): string {
  return [
    "# 작업 모드",
    "내부 멀티에이전트 1차 브리프",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    "# 협업 규칙",
    `- 참여 에이전트 수: ${params.participantRoleIds.length}${params.cappedParticipantCount ? " (상한 적용)" : ""}`,
    "- 최종 답변을 쓰지 말고, 자기 전문영역 기준 핵심 사실/리스크/권장 접근만 짧게 정리한다.",
    "- 불필요한 서론 없이 6개 이하 bullet로 답한다.",
    "- 추정과 사실을 구분한다.",
  ].join("\n");
}

function buildCritiquePrompt(params: {
  prompt: string;
  contextSummary: string;
  roleSummaries: CollaborationRoleRunResult[];
}): string {
  return [
    "# 작업 모드",
    "내부 멀티에이전트 충돌/누락 검토",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    "# 역할별 1차 브리프",
    params.roleSummaries.map(renderRoleSummary).join("\n\n"),
    "",
    "# 출력 규칙",
    "- 서로 충돌하는 주장, 빠진 확인 포인트, 구현/테스트 리스크만 6개 이하 bullet로 적는다.",
    "- 최종 답변 문체 금지.",
    "- 이미 같은 내용은 반복하지 않는다.",
  ].join("\n");
}

function buildFinalPrompt(params: {
  prompt: string;
  contextSummary: string;
  roleSummaries: CollaborationRoleRunResult[];
  criticSummary?: string;
}): string {
  return [
    "# 작업 모드",
    "최종 합성 답변",
    "",
    "# 사용자 요청",
    params.prompt.trim(),
    "",
    "# 압축된 스레드 컨텍스트",
    params.contextSummary.trim() || "없음",
    "",
    "# 참여 에이전트 브리프",
    params.roleSummaries.map(renderRoleSummary).join("\n\n"),
    params.criticSummary
      ? ["", "# 충돌/누락 검토", clip(params.criticSummary, 800)].join("\n")
      : "",
    "",
    "# 출력 규칙",
    "- 한국어로 최종 답변을 작성한다.",
    "- 필요한 경우 수정 후보 파일, 확인해야 할 리스크, 다음 행동을 짧게 정리한다.",
    "- 역할별 원문을 나열하지 말고 하나의 응답으로 합친다.",
  ].filter(Boolean).join("\n");
}

export async function runTaskCollaborationWithCodex(params: {
  prompt: string;
  contextSummary: string;
  participantRoleIds: string[];
  synthesisRoleId: string;
  criticRoleId?: string;
  cappedParticipantCount: boolean;
  executeRoleRun: ExecuteRoleRun;
  onProgress?: (progress: CollaborationProgress) => void;
}): Promise<TaskCollaborationResult> {
  const participantResults: CollaborationRoleRunResult[] = [];
  const briefPrompt = buildBriefPrompt({
    prompt: params.prompt,
    contextSummary: params.contextSummary,
    participantRoleIds: params.participantRoleIds,
    cappedParticipantCount: params.cappedParticipantCount,
  });

  for (const roleId of params.participantRoleIds) {
    params.onProgress?.({
      roleId,
      stage: "codex",
      message: `${roleId} 브리프 생성`,
    });
    try {
      participantResults.push(await params.executeRoleRun({
        roleId,
        prompt: briefPrompt,
        promptMode: "brief",
        internal: true,
        model: "GPT-5.4-Mini",
        reasoning: "낮음",
        outputArtifactName: "discussion_brief.md",
        includeRoleKnowledge: false,
      }));
    } catch (error) {
      params.onProgress?.({
        roleId,
        stage: "codex",
        message: `${roleId} 브리프 실패: ${String(error ?? "unknown error")}`,
      });
    }
  }

  let criticResult: CollaborationRoleRunResult | undefined;
  if (params.criticRoleId && params.criticRoleId !== params.synthesisRoleId && participantResults.length > 1) {
    params.onProgress?.({
      roleId: params.criticRoleId,
      stage: "critic",
      message: `${params.criticRoleId} 충돌/누락 검토`,
    });
    try {
      criticResult = await params.executeRoleRun({
        roleId: params.criticRoleId,
        prompt: buildCritiquePrompt({
          prompt: params.prompt,
          contextSummary: params.contextSummary,
          roleSummaries: participantResults,
        }),
        promptMode: "critique",
        internal: true,
        model: "GPT-5.4-Mini",
        reasoning: "낮음",
        outputArtifactName: "discussion_critique.md",
        includeRoleKnowledge: false,
      });
    } catch (error) {
      params.onProgress?.({
        roleId: params.criticRoleId,
        stage: "critic",
        message: `${params.criticRoleId} 검토 실패: ${String(error ?? "unknown error")}`,
      });
    }
  }

  params.onProgress?.({
    roleId: params.synthesisRoleId,
    stage: "save",
    message: `${params.synthesisRoleId} 최종 합성`,
  });
  if (participantResults.length === 0) {
    throw new Error("모든 내부 브리프가 실패해 최종 합성을 진행할 수 없습니다.");
  }
  const finalResult = await params.executeRoleRun({
    roleId: params.synthesisRoleId,
    prompt: buildFinalPrompt({
      prompt: params.prompt,
      contextSummary: params.contextSummary,
      roleSummaries: participantResults,
      criticSummary: criticResult?.summary,
    }),
    promptMode: "final",
    internal: false,
    model: "GPT-5.4",
    reasoning: "중간",
    outputArtifactName: "final_response.md",
    includeRoleKnowledge: true,
  });

  return {
    participantResults,
    criticResult,
    finalResult,
  };
}
