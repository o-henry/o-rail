import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTaskRoleWithCodex } from "./runTaskRoleWithCodex";
import { clearTaskRoleLearningDataForTest, recordTaskRoleLearningOutcome } from "../../adaptation/taskRoleLearning";

describe("runTaskRoleWithCodex", () => {
  beforeEach(() => {
    clearTaskRoleLearningDataForTest();
  });

  it("uses the task prompt pack and writes role artifacts for thread runs", async () => {
    const writtenArtifacts = ["prompt.md", "implementation_report.md", "response.json"];
    let artifactIndex = 0;
    const invokeFn = (vi.fn(async (command: string) => {
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
          return `/tmp/rail-storage/.rail/tasks/thread-1/codex_runs/role-run-1/${writtenArtifacts[artifactIndex++]}`;
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
      model: "gpt-5.4",
      cwd: "/tmp/mockking",
      sandboxMode: "workspace-write",
    }));
    expect(invokeFn).toHaveBeenCalledWith("turn_start_blocking", expect.objectContaining({
      sandboxMode: "workspace-write",
      reasoningEffort: "medium",
    }));
  });

  it("reports the codex thread id as soon as the runtime session starts", async () => {
    const onRuntimeSession = vi.fn();
    const invokeFn = (vi.fn(async (command: string) => {
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
            task: { workspacePath: "/tmp/mockking", worktreePath: null },
          };
        case "thread_start":
          return { threadId: "thread-codex-early" };
        case "turn_start_blocking":
          return {
            status: "completed",
            output_text: "초기 세션 정보가 있습니다.",
          };
        case "workspace_write_text":
          return `/tmp/out/${Math.random().toString(36).slice(2)}.json`;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-early",
      studioRoleId: "client_programmer",
      prompt: "중간에 stop 가능해야 해",
      sourceTab: "tasks-thread",
      runId: "role-run-early",
      onRuntimeSession,
    });

    expect(onRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({
      codexThreadId: "thread-codex-early",
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

  it("routes task role execution through web providers when the thread model is web-backed", async () => {
    const onRuntimeSession = vi.fn();
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
            thread: { model: "GPT-Web", reasoning: "중간" },
            task: { workspacePath: "/tmp/mockking" },
          };
        case "research_storage_plan_agent_job":
          return { job: { jobId: "collect-web", planner: { instructions: [] } } };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-web" } };
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
        case "web_provider_run":
          return {
            ok: true,
            text: "웹 GPT가 조사 결과를 요약했습니다.",
            raw: { provider: "gpt", response: "웹 GPT가 조사 결과를 요약했습니다." },
            meta: { provider: "gpt" },
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
      taskId: "thread-web",
      studioRoleId: "research_analyst",
      prompt: "웹에서 반응을 조사해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-web",
      onRuntimeSession,
    });

    expect(result.summary).toContain("웹 GPT");
    expect(result.codexThreadId).toBeUndefined();
    expect(invokeFn).toHaveBeenCalledWith("web_provider_run", expect.objectContaining({
      provider: "gpt",
      mode: "bridgeAssisted",
      cwd: "/tmp/mockking",
    }));
    expect(onRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gpt",
    }));
    expect(invokeFn).not.toHaveBeenCalledWith("thread_start", expect.anything());
    expect(result.artifactPaths).toContain("/tmp/rail-storage/.rail/tasks/thread-web/codex_runs/role-run-web/research_findings.md");
  });

  it("prefers final agentMessage text when Codex returns structured items", async () => {
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
          return {
            job: {
              jobId: "collect-structured",
              label: "Researcher · structured",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: [],
              domains: [],
              planner: {
                analysisMode: "topic_research",
                aggregationUnit: "evidence",
                dataScope: "cross_source_topic",
                metricFocus: [],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-structured" } };
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
          return { threadId: "thread-codex-structured" };
        case "turn_start_blocking":
          return {
            id: "turn-structured",
            status: "completed",
            items: [
              {
                id: "item-1",
                type: "userMessage",
                content: [{ type: "text", text: "# ROLE\nRESEARCHER\n..." }],
              },
              {
                id: "item-2",
                type: "agentMessage",
                phase: "final_answer",
                text: "## 조사 결론\n- 구조화된 최종 답변을 회수했습니다.",
              },
            ],
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
      taskId: "thread-structured",
      studioRoleId: "research_analyst",
      prompt: "@researcher 상태를 정리해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-structured",
    });

    expect(result.summary).toContain("구조화된 최종 답변");
    expect(result.summary).not.toContain("# 리서치 수집 결과");
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

  it("injects recent task learning hints into later role prompts", async () => {
    await recordTaskRoleLearningOutcome({
      cwd: "/tmp/rail-storage",
      runId: "seed-run",
      roleId: "research_analyst",
      prompt: "스팀 메타크리틱 장르 조사",
      summary: "Steam과 Metacritic 비교 축으로 정리하고 장르별 대표작을 먼저 분리했다.",
      artifactPaths: ["a.md"],
      runStatus: "done",
    });

    const writtenArtifacts = new Map<string, string>();
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
          return {
            job: {
              jobId: "collect-learning",
              label: "Researcher · learning",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: [],
              domains: [],
              planner: {
                analysisMode: "topic_research",
                aggregationUnit: "evidence",
                dataScope: "cross_source_topic",
                metricFocus: [],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-learning" } };
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
          return { threadId: "thread-codex-learning" };
        case "turn_start_blocking":
          return {
            id: "turn-learning",
            status: "completed",
            output_text: "## 조사 결론\n- 학습 메모리가 포함된 실행입니다.",
          };
        case "workspace_write_text": {
          const path = `${String(args?.cwd)}/${String(args?.name)}`;
          writtenArtifacts.set(String(args?.name), String(args?.content ?? ""));
          return path;
        }
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-learning",
      studioRoleId: "research_analyst",
      prompt: "스팀 메타크리틱 장르 조사와 대표작 비교",
      sourceTab: "tasks-thread",
      runId: "role-run-learning",
    });

    expect(writtenArtifacts.get("prompt.md")).toContain("TASK LEARNING MEMORY");
    expect(writtenArtifacts.get("prompt.md")).toContain("비슷한 성공 패턴");
  });

  it("backfills collection artifacts when the pre-run collection pipeline fails but the role still succeeds", async () => {
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
          throw new Error("bootstrap unavailable");
        case "thread_start":
          return { threadId: "thread-codex-fallback" };
        case "turn_start_blocking":
          return {
            status: "completed",
            output_text: "## 조사 결론\n- 인기 장르 1위는 `슈터/FPS`입니다.\n\n## 핵심 근거\n- Steam 공식 통계는 [Steam Stats](https://store.steampowered.com/stats/stats/)에서 확인됩니다.",
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
      taskId: "thread-fallback",
      studioRoleId: "research_analyst",
      prompt: "@researcher 조사해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-fallback",
    });

    expect(result.artifactPaths).toContain("/tmp/rail-storage/.rail/tasks/thread-fallback/codex_runs/role-run-fallback/research_collection.md");
    expect(result.artifactPaths).toContain("/tmp/rail-storage/.rail/tasks/thread-fallback/codex_runs/role-run-fallback/research_collection.json");
    const collectionJsonCall = invokeSpy.mock.calls.find(
      ([command, callArgs]) => command === "workspace_write_text" && callArgs && (callArgs as Record<string, unknown>).name === "research_collection.json",
    );
    expect(String((collectionJsonCall?.[1] as Record<string, unknown>).content ?? "")).toContain("Steam Stats");
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

  it("extracts markdown user-request sections before planning researcher collection jobs", async () => {
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
              jobId: "collect-markdown-request",
              label: "Researcher · markdown request",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: ["steam community trends"],
              domains: ["steamcommunity.com"],
              planner: {
                analysisMode: "topic_research",
                aggregationUnit: "evidence",
                dataScope: "cross_source_topic",
                metricFocus: [],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-markdown-request" } };
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
          return { threadId: "thread-codex-md-request" };
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
      taskId: "thread-md-request",
      studioRoleId: "research_analyst",
      prompt: [
        "# 작업 모드",
        "내부 멀티에이전트 1차 브리프",
        "",
        "# 사용자 요청",
        "2026년 기준 스팀 커뮤니티 반응을 바탕으로 인디게임 장르 트렌드를 조사해줘",
        "",
        "# 역할별 배정",
        "- researcher: 자료 조사",
        "- game_designer: 발산",
      ].join("\n"),
      sourceTab: "tasks-thread",
      runId: "role-run-md-request",
    });

    expect(capturedPrompts[0]).toBe("2026년 기준 스팀 커뮤니티 반응을 바탕으로 인디게임 장르 트렌드를 조사해줘");
  });

  it("injects explicit empty-evidence guidance when researcher collection returns zero items", async () => {
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
          return {
            job: {
              jobId: "collect-empty",
              label: "Researcher · empty",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: ["steam community sentiment"],
              domains: ["steamcommunity.com"],
              planner: {
                analysisMode: "topic_research",
                aggregationUnit: "evidence",
                dataScope: "cross_source_topic",
                metricFocus: [],
                queryPlan: [{ query: "steam community sentiment", axis: "primary", language: "auto", intent: "topic_research" }],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-empty" } };
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
          return { threadId: "thread-codex-empty-collection" };
        case "turn_start_blocking":
          capturedPrompts.push(String(args?.text ?? ""));
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
      taskId: "thread-empty-collection",
      studioRoleId: "research_analyst",
      prompt: "@researcher 스팀 커뮤니티 반응을 조사해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-empty-collection",
    });

    expect(capturedPrompts[0]).toContain("이번 자동 수집에서는 공개 근거를 확보하지 못했습니다.");
    expect(capturedPrompts[0]).toContain("추측을 사실처럼 단정하지 마세요.");
  });

  it("fails researcher runs without a readable final answer even if collection artifacts exist", async () => {
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
          return {
            job: {
              jobId: "collect-fallback",
              label: "Researcher · fallback",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
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
          return { job: { jobId: "collect-fallback" } };
        case "research_storage_collection_metrics":
          return {
            totals: { items: 1, sources: 1, verified: 1, warnings: 0, conflicted: 0, avgScore: 72 },
            bySourceType: [{ sourceType: "source.community", itemCount: 1 }],
            byVerificationStatus: [{ verificationStatus: "verified", itemCount: 1 }],
            timeline: [{ bucketDate: "2026-03-19", itemCount: 1 }],
            topSources: [{ sourceName: "steamcommunity.com", itemCount: 1 }],
          };
        case "research_storage_list_collection_items":
          return {
            items: [
              {
                title: "대표 근거",
                sourceName: "steamcommunity.com",
                verificationStatus: "verified",
                score: 72,
                url: "https://steamcommunity.com/app/123/reviews",
                summary: "대표 스팀 근거입니다.",
              },
            ],
          };
        case "research_storage_collection_genre_rankings":
          return { popular: [], quality: [] };
        case "thread_start":
          return { threadId: "thread-codex-fallback" };
        case "turn_start_blocking":
          return { status: "completed", output: [] };
        case "workspace_write_text":
          return `${String(args?.cwd)}/${String(args?.name)}`;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await expect(runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-fallback",
      studioRoleId: "research_analyst",
      prompt: "@researcher 스팀 장르 평가를 조사해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-fallback",
    })).rejects.toThrow("without a readable response");
    expect(invokeFn).toHaveBeenCalledWith("workspace_write_text", expect.objectContaining({
      name: "research_collection.md",
    }));
  });

  it("fails non-research roles that complete without any readable response body", async () => {
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
          return { threadId: "thread-codex-empty-architect" };
        case "turn_start_blocking":
          return {
            status: "completed",
            output: [{ kind: "status", value: "done" }],
          };
        case "workspace_write_text":
          return `${String(args?.cwd)}/${String(args?.name)}`;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await expect(runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-empty-architect",
      studioRoleId: "system_programmer",
      prompt: "구조 리스크를 검토해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-empty-architect",
    })).rejects.toThrow("without a readable response");
  });

  it("waits for codex_thread_read when Codex starts in progress and later completes", async () => {
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
          return {
            job: {
              jobId: "collect-pending",
              label: "Researcher · pending",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: [],
              domains: [],
              planner: {
                analysisMode: "genre_ranking",
                aggregationUnit: "genre",
                dataScope: "steam_market",
                metricFocus: [],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-pending" } };
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
          return { threadId: "thread-codex-pending" };
        case "turn_start_blocking":
          return {
            turn: {
              id: "turn-pending",
              items: [],
              status: "inProgress",
            },
          };
        case "codex_thread_read":
          return {
            thread: { status: "completed" },
            turns: [
              {
                id: "turn-pending",
                status: "completed",
                output_text: "수집된 자료를 기준으로 장르별 흐름을 정리했습니다.",
              },
            ],
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
      taskId: "thread-pending",
      studioRoleId: "research_analyst",
      prompt: "스팀 장르 평가를 조사해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-pending",
    });

    expect(result.summary).toContain("장르별 흐름");
    expect(invokeFn).toHaveBeenCalledWith("codex_thread_read", {
      threadId: "thread-codex-pending",
      includeTurns: true,
    });
  });

  it("retries codex_thread_read when the thread is not materialized yet", async () => {
    let readAttempts = 0;
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
          return {
            job: {
              jobId: "collect-pending",
              label: "Researcher · pending",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: [],
              domains: [],
              planner: {
                analysisMode: "genre_ranking",
                aggregationUnit: "genre",
                dataScope: "steam_market",
                metricFocus: [],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-pending" } };
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
          return { threadId: "thread-codex-materializing" };
        case "turn_start_blocking":
          return {
            turn: {
              id: "turn-pending",
              items: [],
              status: "inProgress",
            },
          };
        case "codex_thread_read":
          readAttempts += 1;
          if (readAttempts < 3) {
            throw new Error("rpc error -32600: thread 019d0bf2-ca61-7fd1-b911-f04b9a736eb9 is not materialized yet; includeTurns is unavailable before first user message");
          }
          return {
            thread: { status: "completed" },
            turns: [
              {
                id: "turn-pending",
                status: "completed",
                output_text: "자료 수집이 완료되어 장르별 인기 흐름을 정리했습니다.",
              },
            ],
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
      taskId: "thread-pending",
      studioRoleId: "research_analyst",
      prompt: "스팀 장르 평가를 조사해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-materializing",
    });

    expect(result.summary).toContain("장르별 인기 흐름");
    expect(readAttempts).toBe(3);
  });

  it("recovers from empty session file turn-start races by reading the thread state", async () => {
    let readAttempts = 0;
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
          return {
            job: {
              jobId: "collect-empty-rollout",
              label: "Researcher · empty-rollout",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: [],
              domains: [],
              planner: {
                analysisMode: "genre_ranking",
                aggregationUnit: "genre",
                dataScope: "steam_market",
                metricFocus: [],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-empty-rollout" } };
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
          return { threadId: "thread-codex-empty-rollout" };
        case "turn_start_blocking":
          throw new Error("rpc error -32603: failed to load rollout `/tmp/rollout.jsonl` for thread 019d0c20-f3c0-7800-8f63-7f6d99c2b1a0: empty session file");
        case "codex_thread_read":
          readAttempts += 1;
          if (readAttempts < 2) {
            throw new Error("rpc error -32603: failed to load rollout `/tmp/rollout.jsonl` for thread 019d0c20-f3c0-7800-8f63-7f6d99c2b1a0: empty session file");
          }
          return {
            thread: { status: "completed" },
            turns: [
              {
                id: "turn-empty-rollout",
                status: "completed",
                output_text: "빈 세션 파일 race를 넘기고 결과를 정상 회수했습니다.",
              },
            ],
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
      taskId: "thread-empty-rollout",
      studioRoleId: "research_analyst",
      prompt: "스팀 장르 평가를 조사해줘",
      sourceTab: "tasks-thread",
      runId: "role-run-empty-rollout",
    });

    expect(result.summary).toContain("정상 회수");
    expect(readAttempts).toBe(2);
  });

  it("does not mark a failed researcher turn as successful just because collection artifacts exist", async () => {
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
          return {
            job: {
              jobId: "collect-failed-turn",
              label: "Researcher · failed-turn",
              resolvedSourceType: "community",
              collectorStrategy: "dynamic_search",
              keywords: [],
              domains: [],
              planner: {
                analysisMode: "topic_research",
                aggregationUnit: "evidence",
                dataScope: "cross_source_topic",
                metricFocus: [],
                instructions: [],
              },
            },
          };
        case "research_storage_execute_job":
          return { job: { jobId: "collect-failed-turn" } };
        case "research_storage_collection_metrics":
          return {
            totals: { items: 2, sources: 1, verified: 2, warnings: 0, conflicted: 0, avgScore: 74 },
            bySourceType: [],
            byVerificationStatus: [],
            timeline: [],
            topSources: [],
          };
        case "research_storage_list_collection_items":
          return { items: [] };
        case "thread_start":
          return { threadId: "thread-codex-failed" };
        case "turn_start_blocking":
          return {
            id: "turn-failed",
            status: "failed",
            error: "upstream failed",
          };
        case "workspace_write_text":
          return `${String(args?.cwd)}/${String(args?.name)}`;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await expect(runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-failed-turn",
      studioRoleId: "research_analyst",
      prompt: "실패를 숨기지 말아줘",
      sourceTab: "tasks-thread",
      runId: "role-run-failed-turn",
    })).rejects.toThrow("Codex turn failed");
  });

  it("fails completed runs that still do not contain a readable final answer", async () => {
    const invokeFn = (vi.fn(async (command: string) => {
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
          return { threadId: "thread-codex-empty" };
        case "turn_start_blocking":
          return {
            id: "turn-empty",
            status: "completed",
            items: [{ id: "meta", type: "event", content: [] }],
          };
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    await expect(runTaskRoleWithCodex({
      invokeFn,
      storageCwd: "/tmp/rail-storage",
      taskId: "thread-empty",
      studioRoleId: "system_programmer",
      prompt: "본문 없는 완료 응답",
      sourceTab: "tasks-thread",
      runId: "role-run-empty",
    })).rejects.toThrow("without a readable response");
  });

  it("extracts final answer text from nested item content arrays", async () => {
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
          return { threadId: "thread-codex-content-array" };
        case "turn_start_blocking":
          return {
            id: "turn-content-array",
            status: "completed",
            items: [
              {
                id: "item-final",
                type: "agentMessage",
                phase: "final_answer",
                content: [
                  { type: "output_text", text: "## 최종 정리\n- nested content에서도 최종 답변을 읽었습니다." },
                ],
              },
            ],
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
      taskId: "thread-content-array",
      studioRoleId: "system_programmer",
      prompt: "nested content를 읽어줘",
      sourceTab: "tasks-thread",
      runId: "role-run-content-array",
    });

    expect(result.summary).toContain("nested content에서도 최종 답변");
  });

  it("fails fast when thread_start never resolves", async () => {
    vi.useFakeTimers();
    const invokeFn = (vi.fn(async (command: string) => {
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
          return await new Promise<never>(() => {});
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    try {
      const promise = runTaskRoleWithCodex({
        invokeFn,
        storageCwd: "/tmp/rail-storage",
        taskId: "thread-timeout-start",
        studioRoleId: "system_programmer",
        prompt: "thread_start hang",
        sourceTab: "tasks-thread",
        runId: "role-run-timeout-start",
      });
      const guarded = promise.catch((error) => error);
      await vi.advanceTimersByTimeAsync(60000);
      await expect(guarded).resolves.toBeInstanceOf(Error);
      await expect(guarded).resolves.toMatchObject({ message: expect.stringContaining("thread_start timed out") });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast when turn_start_blocking never resolves", async () => {
    vi.useFakeTimers();
    const invokeFn = (vi.fn(async (command: string) => {
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
          return { threadId: "thread-timeout-turn" };
        case "turn_start_blocking":
          return await new Promise<never>(() => {});
        case "codex_thread_read":
          throw new Error("rpc error -32600: thread not materialized yet");
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    try {
      const promise = runTaskRoleWithCodex({
        invokeFn,
        storageCwd: "/tmp/rail-storage",
        taskId: "thread-timeout-turn",
        studioRoleId: "system_programmer",
        prompt: "turn_start hang",
        sourceTab: "tasks-thread",
        runId: "role-run-timeout-turn",
      });
      const guarded = promise.catch((error) => error);
      await vi.advanceTimersByTimeAsync(110000);
      await expect(guarded).resolves.toBeInstanceOf(Error);
      await expect(guarded).resolves.toMatchObject({ message: expect.stringContaining("turn_start_blocking timed out") });
    } finally {
      vi.useRealTimers();
    }
  });

});
