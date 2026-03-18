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
});
