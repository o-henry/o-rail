export type TaskAgentMetadata = {
  taskAgentId?: string;
  taskAgentLabel?: string;
  studioRoleLabel?: string;
  orchestratorAgentId?: string;
  orchestratorAgentLabel?: string;
};

const TASK_AGENT_BY_STUDIO_ROLE: Record<string, { id: string; label: string }> = {
  pm_planner: { id: "game_designer", label: "GAME DESIGNER" },
  pm_creative_director: { id: "level_designer", label: "LEVEL DESIGNER" },
  research_analyst: { id: "researcher", label: "RESEARCHER" },
  system_programmer: { id: "unity_architect", label: "UNITY ARCHITECT" },
  client_programmer: { id: "unity_implementer", label: "UNITY IMPLEMENTER" },
  art_pipeline: { id: "technical_artist", label: "TECHNICAL ARTIST" },
  tooling_engineer: { id: "unity_editor_tools", label: "UNITY EDITOR TOOLS" },
  qa_engineer: { id: "qa_playtester", label: "QA PLAYTESTER" },
  build_release: { id: "release_steward", label: "RELEASE STEWARD" },
  technical_writer: { id: "handoff_writer", label: "HANDOFF WRITER" },
};

const STUDIO_ROLE_LABEL_BY_ID: Record<string, string> = {
  pm_planner: "기획(PM)",
  pm_creative_director: "기획(PM) · 창의 확장",
  research_analyst: "리서처",
  system_programmer: "시스템",
  client_programmer: "클라이언트",
  art_pipeline: "아트 파이프라인",
  tooling_engineer: "툴링",
  qa_engineer: "QA",
  build_release: "빌드·릴리즈",
  technical_writer: "문서화",
};

export function resolveTaskAgentMetadata(studioRoleId: string | null | undefined, internal = false): TaskAgentMetadata {
  const normalizedRoleId = String(studioRoleId ?? "").trim();
  const taskAgent = TASK_AGENT_BY_STUDIO_ROLE[normalizedRoleId];
  const studioRoleLabel = STUDIO_ROLE_LABEL_BY_ID[normalizedRoleId];
  return {
    taskAgentId: taskAgent?.id,
    taskAgentLabel: taskAgent?.label,
    studioRoleLabel,
    orchestratorAgentId: internal ? undefined : taskAgent?.id,
    orchestratorAgentLabel: internal ? undefined : taskAgent?.label,
  };
}
