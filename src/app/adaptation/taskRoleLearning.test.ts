import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskRoleLearningPromptContext,
  clearTaskRoleLearningDataForTest,
  loadTaskRoleLearningData,
  recordTaskRoleLearningOutcome,
  retrieveTaskRoleLearningMemoryModules,
  summarizeTaskRoleLearningImprovementByRole,
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
    expect(context).toContain("회피 전략");
    expect(context.length).toBeLessThanOrEqual(440);
  });

  it("retrieves memory modules instead of expanding raw prompt text indefinitely", async () => {
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

    const modules = retrieveTaskRoleLearningMemoryModules({
      cwd: "/tmp/rail-docs",
      roleId: "research_analyst",
      prompt: "스팀 메타크리틱 장르 조사와 대표작 비교",
    });

    expect(modules.map((module) => module.kind)).toEqual([
      "success_pattern",
      "failure_signature",
      "failure_avoidance",
      "working_rule",
    ]);
    expect(modules[0]?.title).toBe("비슷한 성공 패턴");
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
        lastFailureKind: "timeout",
      }),
    ]);
  });

  it("classifies auth and source sparsity failures separately", async () => {
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "run-auth",
      roleId: "research_analyst",
      prompt: "공개 커뮤니티 조사",
      summary: "",
      artifactPaths: [],
      runStatus: "error",
      failureReason: "401 Unauthorized from public source fetch",
    });
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "run-sparse",
      roleId: "research_analyst",
      prompt: "유럽 커뮤니티 조사",
      summary: "근거 0개, 상위 소스 0개",
      artifactPaths: [],
      runStatus: "error",
      failureReason: "insufficient sources after public web search",
    });

    const summaries = summarizeTaskRoleLearningByRole("/tmp/rail-docs");
    expect(summaries[0]).toEqual(expect.objectContaining({
      roleId: "research_analyst",
    }));

    const sparseContext = buildTaskRoleLearningPromptContext({
      cwd: "/tmp/rail-docs",
      roleId: "research_analyst",
      prompt: "유럽 공개 커뮤니티 조사",
    });
    expect(sparseContext).toContain("근거 희소/출처 부족");
    expect(sparseContext).toContain("동의어·영문명·지역명으로 질의를 넓히고");

    const authContext = buildTaskRoleLearningPromptContext({
      cwd: "/tmp/rail-docs",
      roleId: "research_analyst",
      prompt: "공개 커뮤니티 권한 실패 조사",
    });
    expect(authContext).toContain("인증/권한 실패");
  });

  it("summarizes recent success-rate improvement by role", async () => {
    const runs: Array<{ id: string; status: "done" | "error" }> = [
      { id: "r7", status: "error" },
      { id: "r8", status: "error" },
      { id: "r9", status: "done" },
      { id: "r10", status: "error" },
      { id: "r11", status: "error" },
      { id: "r12", status: "error" },
      { id: "r1", status: "done" },
      { id: "r2", status: "done" },
      { id: "r3", status: "done" },
      { id: "r4", status: "done" },
      { id: "r5", status: "error" },
      { id: "r6", status: "done" },
    ];
    for (const row of runs) {
      await recordTaskRoleLearningOutcome({
        cwd: "/tmp/rail-docs",
        runId: row.id,
        roleId: "research_analyst",
        prompt: "시장 조사",
        summary: row.status === "done" ? "성공" : "",
        artifactPaths: row.status === "done" ? ["a.md"] : [],
        runStatus: row.status,
        failureReason: row.status === "error" ? "role execution timed out after 300000ms" : "",
      });
    }

    expect(summarizeTaskRoleLearningImprovementByRole("/tmp/rail-docs")).toEqual([
      expect.objectContaining({
        roleId: "research_analyst",
        currentSuccessRate: 5 / 6,
        previousSuccessRate: 1 / 6,
        successRateDelta: 0.6666666666666667,
        recentSampleSize: 6,
        previousSampleSize: 6,
      }),
    ]);
  });

  it("drops stale failures when a newer success already supersedes them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "old-failure",
      roleId: "research_analyst",
      prompt: "스팀 장르 조사",
      summary: "",
      artifactPaths: [],
      runStatus: "error",
      failureReason: "ROLE_KB_BOOTSTRAP 실패 (0/7)",
    });
    vi.setSystemTime(new Date("2026-03-12T00:00:00.000Z"));
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "new-success",
      roleId: "research_analyst",
      prompt: "스팀 장르 조사",
      summary: "공식 통계와 커뮤니티 축을 나눠 정리했다.",
      artifactPaths: ["a.md"],
      runStatus: "done",
    });
    vi.setSystemTime(new Date("2026-03-21T00:00:00.000Z"));

    const context = buildTaskRoleLearningPromptContext({
      cwd: "/tmp/rail-docs",
      roleId: "research_analyst",
      prompt: "스팀 장르 조사",
    });

    expect(context).toContain("비슷한 성공 패턴");
    expect(context).not.toContain("외부 근거 수집 실패");
    vi.useRealTimers();
  });

  it("expires learning memory that is too old for the role budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-docs",
      runId: "expired-success",
      roleId: "research_analyst",
      prompt: "시장 조사",
      summary: "오래된 성공",
      artifactPaths: ["a.md"],
      runStatus: "done",
    });
    vi.setSystemTime(new Date("2026-03-21T00:00:00.000Z"));

    const context = buildTaskRoleLearningPromptContext({
      cwd: "/tmp/rail-docs",
      roleId: "research_analyst",
      prompt: "시장 조사",
    });

    expect(context).toBe("");
    vi.useRealTimers();
  });
});
