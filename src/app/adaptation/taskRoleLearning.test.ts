import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskRoleLearningPromptContext,
  clearTaskRoleLearningDataForTest,
  loadTaskRoleLearningData,
  recordTaskRoleLearningOutcome,
  summarizeTaskRoleLearningByRole,
} from "./taskRoleLearning";

describe("taskRoleLearning", () => {
  beforeEach(() => {
    clearTaskRoleLearningDataForTest();
  });

  it("records outcomes and reuses similar success/failure hints in later prompts", async () => {
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "run-success",
      roleId: "research_analyst",
      prompt: "스팀 메타크리틱 커뮤니티 장르 조사",
      summary: "Steam, Metacritic, 커뮤니티 비교 축을 먼저 정리하고 장르별 대표작을 분리했다.",
      artifactPaths: ["a.md", "b.json"],
      runStatus: "done",
    });
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "run-failure",
      roleId: "research_analyst",
      prompt: "스팀 메타크리틱 커뮤니티 장르 조사",
      summary: "",
      artifactPaths: [],
      runStatus: "error",
      failureReason: "ROLE_KB_BOOTSTRAP 실패 (0/7)",
    });

    const context = buildTaskRoleLearningPromptContext({
      cwd: "/tmp/rail-docs",
      roleId: "research_analyst",
      prompt: "스팀 메타크리틱 장르 조사와 대표작 비교",
    });

    expect(context).toContain("TASK LEARNING MEMORY");
    expect(context).toContain("비슷한 성공 패턴");
    expect(context).toContain("반복 금지");
    expect(context).toContain("외부 근거 수집 실패");
  });

  it("persists task role learning to workspace storage without failing local cache updates", async () => {
    const invokeFn = (vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "workspace_write_text") {
        return String(args?.name ?? "");
      }
      if (command === "workspace_read_text") {
        return JSON.stringify({
          version: 1,
          workspace: "/tmp/rail-docs",
          updatedAt: "2026-03-21T00:00:00.000Z",
          runs: [
            {
              id: "seed:research_analyst",
              runId: "seed",
              roleId: "research_analyst",
              status: "done",
              promptExcerpt: "seed prompt",
              promptTerms: ["seed", "prompt"],
              summaryExcerpt: "seed summary",
              artifactCount: 1,
              createdAt: "2026-03-21T00:00:00.000Z",
            },
          ],
        });
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const loaded = await loadTaskRoleLearningData("/tmp/rail-docs", invokeFn);
    expect(loaded.runs).toHaveLength(1);

    const next = await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      invokeFn,
      runId: "run-success",
      roleId: "research_analyst",
      prompt: "새로운 프롬프트",
      summary: "새로운 성공 요약",
      artifactPaths: ["a.md"],
      runStatus: "done",
    });

    expect(next.runs[0]?.runId).toBe("run-success");
    expect(invokeFn).toHaveBeenCalledWith("workspace_write_text", expect.objectContaining({
      name: "task_role_learning.json",
    }));
  });

  it("summarizes recent success/failure totals by role", async () => {
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "run-1",
      roleId: "research_analyst",
      prompt: "시장 조사",
      summary: "성공",
      artifactPaths: ["a.md"],
      runStatus: "done",
    });
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "run-2",
      roleId: "research_analyst",
      prompt: "시장 조사",
      summary: "",
      artifactPaths: [],
      runStatus: "error",
      failureReason: "role execution timed out after 300000ms",
    });

    expect(summarizeTaskRoleLearningByRole("/tmp/rail-docs")).toEqual([
      expect.objectContaining({
        roleId: "research_analyst",
        successCount: 1,
        failureCount: 1,
        lastFailureReason: "role execution timed out after 300000ms",
      }),
    ]);
  });
});
