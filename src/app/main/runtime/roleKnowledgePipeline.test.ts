import { describe, expect, it, vi } from "vitest";
import {
  bootstrapRoleKnowledgeProfile,
  injectRoleKnowledgePrompt,
  storeRoleKnowledgeProfile,
} from "./roleKnowledgePipeline";

describe("roleKnowledgePipeline", () => {
  it("builds bootstrap profile even when source fetch fails", async () => {
    const invokeFn = vi.fn(async () => {
      throw new Error("network blocked");
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await bootstrapRoleKnowledgeProfile({
      cwd: "/tmp/workspace",
      invokeFn,
      roleId: "pm_planner",
      taskId: "TASK-001",
      runId: "role-1",
      userPrompt: "로그라이트 게임 아이디어 필요",
    });

    expect(result.profile.roleId).toBe("pm_planner");
    expect(result.sourceCount).toBeGreaterThan(0);
    expect(result.sourceSuccessCount).toBe(0);
    expect(result.profile.keyPoints.length).toBeGreaterThan(0);
  });

  it("stores and injects role knowledge block into prompt", async () => {
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "workspace_write_text") {
        return `/tmp/${String(args?.name ?? "unknown")}`;
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const bootstrapped = await bootstrapRoleKnowledgeProfile({
      cwd: "/tmp/workspace",
      invokeFn: vi.fn(async () => ({
        url: "https://docs.unity3d.com/Manual/index.html",
        fetched_at: "2026-03-04T00:00:00Z",
        summary: "Unity manual summary",
        content: "content",
        markdown_path: "/tmp/raw.md",
        json_path: "/tmp/raw.json",
      })) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      roleId: "client_programmer",
      taskId: "TASK-002",
      runId: "role-2",
      userPrompt: "플레이어 이동 시스템 설계",
    });

    const stored = await storeRoleKnowledgeProfile({
      cwd: "/tmp/workspace",
      invokeFn,
      profile: bootstrapped.profile,
    });
    const injected = await injectRoleKnowledgePrompt({
      roleId: "client_programmer",
      prompt: "이동 시스템을 구현해줘",
      profile: stored.profile,
    });

    expect(stored.artifactPaths.some((path) => path.endsWith(".md"))).toBe(true);
    expect(injected.usedProfile).toBe(true);
    expect(injected.prompt).toContain("[ROLE_KB_INJECT]");
    expect(injected.prompt).toContain("이동 시스템을 구현해줘");
  });
});

