import { describe, expect, it, vi } from "vitest";
import { runTaskRoleWithCodex } from "./runTaskRoleWithCodex";

describe("runTaskRoleWithCodex", () => {
  it("uses the task prompt pack and writes role artifacts for thread runs", async () => {
    const invokeFn = (vi.fn(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "task_agent_pack_read":
          return {
            id: "unity_implementer",
            label: "UNITY IMPLEMENTER",
            studioRoleId: "client_programmer",
            model: "gpt-5.4-mini",
            modelReasoningEffort: "medium",
            sandboxMode: "workspace-write",
            outputArtifactName: "implementation_report.md",
            promptDocFile: "unity_implementer.md",
            developerInstructions: "구현하고 수정 파일을 한국어로 요약하라.",
          };
        case "thread_load":
          return {
            thread: { model: "GPT-5.4", reasoning: "중간" },
            task: { projectPath: "/tmp/mockking", workspacePath: "/tmp/mockking", worktreePath: null },
          };
        case "thread_start":
          return { threadId: "thread-codex-1" };
        case "turn_start_blocking":
          return {
            status: "completed",
            output_text: "PlayerController.cs를 수정했고 점프 속도를 7로 올렸습니다.",
            usage: { input_tokens: 12, output_tokens: 24, total_tokens: 36 },
          };
        case "workspace_write_text":
          return `${String(args?.cwd)}/${String(args?.name)}`;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-1",
      studioRoleId: "client_programmer",
      prompt: "PlayerController.cs의 점프 속도를 올려줘",
      sourceTab: "tasks-thread",
      runId: "role-run-1",
    });

    expect(result.summary).toContain("점프 속도");
    expect(result.artifactPaths).toEqual([
      "/tmp/rail-storage/.rail/tasks/thread-1/codex_runs/role-run-1/prompt.md",
      "/tmp/rail-storage/.rail/tasks/thread-1/codex_runs/role-run-1/implementation_report.md",
      "/tmp/rail-storage/.rail/tasks/thread-1/codex_runs/role-run-1/response.json",
    ]);
    expect(invokeFn).toHaveBeenCalledWith("thread_start", expect.objectContaining({
      model: "gpt-5.4-mini",
      cwd: "/tmp/mockking",
      sandboxMode: "workspace-write",
    }));
    expect(invokeFn).toHaveBeenCalledWith("turn_start_blocking", expect.objectContaining({
      sandboxMode: "workspace-write",
      reasoningEffort: "medium",
    }));
  });

  it("allows collaboration runs to override the artifact file name", async () => {
    const invokeFn = (vi.fn(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "task_agent_pack_read":
          return {
            id: "unity_architect",
            label: "UNITY ARCHITECT",
            studioRoleId: "system_programmer",
            model: "gpt-5.4",
            modelReasoningEffort: "medium",
            sandboxMode: "workspace-write",
            outputArtifactName: "architecture_review.md",
            promptDocFile: "unity_architect.md",
            developerInstructions: "검토하라.",
          };
        case "thread_load":
          return {
            thread: { model: "GPT-5.4", reasoning: "중간" },
            task: { workspacePath: "/tmp/mockking" },
          };
        case "thread_start":
          return { threadId: "thread-codex-2" };
        case "turn_start_blocking":
          return {
            status: "completed",
            output_text: "충돌 포인트를 정리했습니다.",
          };
        case "workspace_write_text":
          return `${String(args?.cwd)}/${String(args?.name)}`;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-2",
      studioRoleId: "system_programmer",
      prompt: "충돌만 검토해줘",
      outputArtifactName: "discussion_critique.md",
      sourceTab: "tasks-thread",
      runId: "role-run-2",
    });

    expect(result.artifactPaths[1]).toBe("/tmp/rail-storage/.rail/tasks/thread-2/codex_runs/role-run-2/discussion_critique.md");
  });

  it("lets researcher roles pre-run the collection pipeline and inject the dataset into the prompt", async () => {
    const capturedPrompts: string[] = [];
    const invokeSpy = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "task_agent_pack_read":
          return {
            id: "researcher",
            label: "RESEARCHER",
            studioRoleId: "research_analyst",
            model: "gpt-5.4",
            modelReasoningEffort: "medium",
            sandboxMode: "workspace-write",
            outputArtifactName: "research_findings.md",
            promptDocFile: "researcher.md",
            developerInstructions: "자료 조사와 웹 리서치를 수행하라.",
          };
        case "thread_load":
          return {
            thread: { model: "GPT-5.4", reasoning: "중간" },
            task: { workspacePath: "/tmp/mockking" },
          };
        case "research_storage_plan_agent_job":
          capturedPrompts.push(String(args?.prompt ?? ""));
          return {
            job: {
              jobId: "collect-1",
              label: "Researcher · 스팀 리뷰 조사",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: ["스팀 게임 최근 리뷰", "steam recent reviews"],
              domains: ["store.steampowered.com", "steamcommunity.com"],
              planner: {
                analysisMode: "genre_ranking",
                aggregationUnit: "genre",
                dataScope: "steam_market",
                metricFocus: ["popularity", "quality", "representatives"],
                instructions: ["Aggregate evidence at the genre level before recommending winners."],
              },
            },
          };
        case "research_storage_execute_job":
          return {
            job: { jobId: "collect-1" },
            execution: { jobRunId: "jobrun-1" },
            via: { run_id: "via-1" },
          };
        case "research_storage_collection_metrics":
          return {
            totals: { items: 12, sources: 4, verified: 8, warnings: 4, conflicted: 0, avgScore: 61 },
            bySourceType: [{ sourceType: "source.community", itemCount: 7 }],
            byVerificationStatus: [{ verificationStatus: "verified", itemCount: 8 }],
            timeline: [{ bucketDate: "2026-03-19", itemCount: 12 }],
            topSources: [{ sourceName: "steamcommunity.com", itemCount: 5 }],
          };
        case "research_storage_collection_genre_rankings":
          return {
            popular: [
              {
                genreKey: "deckbuilder",
                genreLabel: "Deckbuilder",
                rank: 1,
                evidenceCount: 6,
                avgScore: 72,
                popularityScore: 84,
                qualityScore: 78,
                representativeTitles: ["Slay the Spire", "Monster Train"],
              },
            ],
            quality: [
              {
                genreKey: "roguelite",
                genreLabel: "Roguelite",
                rank: 1,
                evidenceCount: 5,
                avgScore: 81,
                popularityScore: 70,
                qualityScore: 88,
                representativeTitles: ["Hades", "Dead Cells"],
              },
            ],
          };
        case "research_storage_list_collection_items":
          return {
            items: [
              {
                title: "Deckbuilder fans praise replayability",
                sourceName: "steamcommunity.com",
                verificationStatus: "verified",
                score: 72,
                url: "https://steamcommunity.com/app/123/reviews",
                summary: "Players mention strong replayability and run variety.",
              },
            ],
          };
        case "thread_start":
          return { threadId: "thread-codex-3" };
        case "turn_start_blocking":
          return {
            status: "completed",
            output_text: "수집된 데이터를 바탕으로 최근 평가 흐름을 정리했습니다.",
          };
        case "workspace_write_text":
          return `${String(args?.cwd)}/${String(args?.name)}`;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    });
    const invokeFn = (invokeSpy as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-3",
      studioRoleId: "research_analyst",
      prompt: "@researcher 스팀 게임 최근 리뷰와 장르별 평가를 조사해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-3",
    });

    expect(result.artifactPaths).toContain("/tmp/rail-storage/.rail/tasks/thread-3/codex_runs/role-run-3/research_collection.md");
    expect(result.artifactPaths).toContain("/tmp/rail-storage/.rail/tasks/thread-3/codex_runs/role-run-3/research_collection.json");
    expect(invokeFn).toHaveBeenCalledWith("research_storage_plan_agent_job", expect.objectContaining({
      cwd: "/tmp/rail-storage",
    }));
    expect(capturedPrompts[0]).toBe("스팀 게임 최근 리뷰와 장르별 평가를 조사해줘");
    expect(invokeFn).toHaveBeenCalledWith("turn_start_blocking", expect.objectContaining({
      text: expect.stringContaining("# 사전 수집 데이터셋"),
    }));
    expect(invokeFn).toHaveBeenCalledWith("turn_start_blocking", expect.objectContaining({
      text: expect.stringContaining("분석 모드: genre_ranking"),
    }));
    expect(invokeFn).toHaveBeenCalledWith("research_storage_collection_genre_rankings", expect.objectContaining({
      cwd: "/tmp/rail-storage",
      jobId: "collect-1",
    }));
    const collectionJsonCall = invokeSpy.mock.calls.find(
      ([command, args]) => command === "workspace_write_text" && args && (args as Record<string, unknown>).name === "research_collection.json",
    );
    expect(collectionJsonCall).toBeTruthy();
    expect(String((collectionJsonCall?.[1] as Record<string, unknown>).content ?? "")).toContain("\"questionType\": \"genre_ranking\"");
  });

  it("strips role-formatted wrappers before planning researcher collection jobs", async () => {
    const capturedPrompts: string[] = [];
    const invokeFn = (vi.fn(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "task_agent_pack_read":
          return {
            id: "researcher",
            label: "RESEARCHER",
            studioRoleId: "research_analyst",
            model: "gpt-5.4",
            modelReasoningEffort: "medium",
            sandboxMode: "workspace-write",
            outputArtifactName: "research_findings.md",
            promptDocFile: "researcher.md",
            developerInstructions: "자료 조사와 웹 리서치를 수행하라.",
          };
        case "thread_load":
          return {
            thread: { model: "GPT-5.4", reasoning: "중간" },
            task: { workspacePath: "/tmp/mockking" },
          };
        case "research_storage_plan_agent_job":
          capturedPrompts.push(String(args?.prompt ?? ""));
          return {
            job: {
              jobId: "collect-2",
              label: "Researcher · 스팀 장르 조사",
              resolvedSourceType: "community",
              collectorStrategy: "mixed_browser",
              keywords: ["steam genre review volume"],
              domains: ["store.steampowered.com", "steamcommunity.com"],
              planner: {
                analysisMode: "genre_ranking",
                aggregationUnit: "genre",
                dataScope: "steam_market",
                metricFocus: ["popularity", "quality", "representatives"],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-2" } };
        case "research_storage_collection_metrics":
          return {
            totals: { items: 0, sources: 0, verified: 0, warnings: 0, conflicted: 0, avgScore: 0 },
            bySourceType: [],
            byVerificationStatus: [],
            timeline: [],
            topSources: [],
          };
        case "research_storage_list_collection_items":
          return { items: [] };
        case "research_storage_collection_genre_rankings":
          return { popular: [], quality: [] };
        case "thread_start":
          return { threadId: "thread-codex-4" };
        case "turn_start_blocking":
          return { status: "completed", output_text: "조사 결과를 정리했습니다." };
        case "workspace_write_text":
          return `${String(args?.cwd)}/${String(args?.name)}`;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-4",
      studioRoleId: "research_analyst",
      prompt: [
        "Formatting re-enabled",
        "",
        "<role_profile>",
        "role_name: 리서처",
        "</role_profile>",
        "",
        "<task_request>",
        "스팀 장르 인기 순위와 고평가 장르, 대표 게임 리스트를 조사해줘",
        "</task_request>",
      ].join("\n"),
      sourceTab: "tasks-thread",
      runId: "role-run-4",
    });

    expect(capturedPrompts[0]).toBe("스팀 장르 인기 순위와 고평가 장르, 대표 게임 리스트를 조사해줘");
  });
});
