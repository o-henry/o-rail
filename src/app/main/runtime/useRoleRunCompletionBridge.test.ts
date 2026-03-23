import { describe, expect, it } from "vitest";
import { buildKnowledgeEntriesFromRoleRunCompletion } from "./useRoleRunCompletionBridge";

describe("buildKnowledgeEntriesFromRoleRunCompletion", () => {
  it("keeps generated markdown/json artifacts visible even when the role run failed", () => {
    const entries = buildKnowledgeEntriesFromRoleRunCompletion({
      cwd: "/tmp/workspace",
      payload: {
        roleId: "pm_planner",
        runId: "role-123",
        taskId: "thread-123",
        prompt: "아이디어 5개를 정리해줘",
        internal: false,
        artifactPaths: [
          "/tmp/workspace/.rail/studio_runs/role-123/artifacts/final_response.md",
          "/tmp/workspace/.rail/studio_runs/role-123/artifacts/response.json",
        ],
      },
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      runId: "role-123",
      taskId: "thread-123",
      markdownPath: "/tmp/workspace/.rail/studio_runs/role-123/artifacts/final_response.md",
    });
    expect(entries[1]).toMatchObject({
      runId: "role-123",
      taskId: "thread-123",
      jsonPath: "/tmp/workspace/.rail/studio_runs/role-123/artifacts/response.json",
    });
  });

  it("maps internal collaboration roles to task agent metadata for stored artifacts", () => {
    const entries = buildKnowledgeEntriesFromRoleRunCompletion({
      cwd: "/tmp/workspace",
      payload: {
        roleId: "research_analyst",
        runId: "role-456",
        taskId: "thread-456",
        prompt: "시장성 리스크를 검토해줘",
        internal: true,
        artifactPaths: [
          "/tmp/workspace/.rail/studio_runs/role-456/artifacts/discussion_brief.md",
        ],
      },
    });

    expect(entries[0]).toMatchObject({
      taskAgentId: "researcher",
      taskAgentLabel: "RESEARCHER",
      studioRoleLabel: "리서처",
      markdownPath: "/tmp/workspace/.rail/studio_runs/role-456/artifacts/discussion_brief.md",
    });
  });

  it("stores a clean user request summary instead of orchestration scaffolding", () => {
    const entries = buildKnowledgeEntriesFromRoleRunCompletion({
      cwd: "/tmp/workspace",
      payload: {
        roleId: "pm_planner",
        runId: "role-789",
        taskId: "thread-789",
        prompt: [
          "# ROLE",
          "GAME DESIGNER",
          "",
          "# USER REQUEST",
          "[첨부 참고자료]",
          "- foo.md",
          "[/첨부 참고자료]",
          "<task_request>",
          "리텐션 높은 1인 인디게임 아이디어를 다시 제안해줘",
          "</task_request>",
          "",
          "[ROLE_KB_INJECT]",
          "- ROLE: GAME DESIGNER",
          "[/ROLE_KB_INJECT]",
          "",
          "# OUTPUT RULES",
          "- 한국어로만 답변한다.",
        ].join("\n"),
        internal: false,
        artifactPaths: ["/tmp/workspace/.rail/studio_runs/role-789/artifacts/final_response.md"],
      },
    });

    expect(entries[0]?.summary).toBe("리텐션 높은 1인 인디게임 아이디어를 다시 제안해줘");
  });

  it("prefers the original request prompt for knowledge grouping over role-specific prompts", () => {
    const entries = buildKnowledgeEntriesFromRoleRunCompletion({
      cwd: "/tmp/workspace",
      payload: {
        roleId: "research_analyst",
        runId: "role-999",
        taskId: "thread-999",
        prompt: [
          "# 작업 모드",
          "내부 멀티에이전트 1차 브리프",
          "",
          "# 사용자 요청",
          "시장성과 리텐션 포인트를 분석해줘",
        ].join("\n"),
        requestPrompt: "1인 인디게임 창의적 아이디어 3개만 추려줘",
        internal: true,
        artifactPaths: ["/tmp/workspace/.rail/studio_runs/role-999/artifacts/discussion_brief.md"],
      },
    });

    expect(entries[0]?.requestLabel).toBe("1인 인디게임 창의적 아이디어 3개만 추려줘");
    expect(entries[0]?.summary).toBe("1인 인디게임 창의적 아이디어 3개만 추려줘");
  });

  it("classifies shared web-ai response artifacts as ai knowledge entries", () => {
    const entries = buildKnowledgeEntriesFromRoleRunCompletion({
      cwd: "/tmp/workspace",
      payload: {
        roleId: "pm_planner",
        runId: "role-web-123",
        taskId: "thread-web-123",
        prompt: "외부 웹 AI 관점을 모아줘",
        internal: true,
        artifactPaths: [
          "/tmp/workspace/.rail/studio_runs/role-web-123/artifacts/shared_web_perspective.md",
          "/tmp/workspace/.rail/studio_runs/role-web-123/artifacts/web_grok_response.md",
          "/tmp/workspace/.rail/studio_runs/role-web-123/artifacts/response.json",
        ],
      },
    });

    expect(entries.map((entry) => entry.sourceKind)).toEqual(["ai", "ai", "ai"]);
  });
});
