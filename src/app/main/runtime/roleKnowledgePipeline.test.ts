import { describe, expect, it, vi } from "vitest";
import {
  ROLE_KB_ALLOWLIST,
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
      if (command === "dashboard_scrapling_bridge_start") {
        return {
          running: true,
          scrapling_ready: true,
          message: "ready",
        };
      }
      if (command === "dashboard_scrapling_bridge_install") {
        return {
          installed: true,
        };
      }
      if (command === "dashboard_scrapling_fetch_url") {
        return {
          url: "https://docs.unity3d.com/Manual/index.html",
          fetched_at: "2026-03-04T00:00:00Z",
          summary: "Unity manual summary",
          content: "content",
          markdown_path: "/tmp/raw.md",
          json_path: "/tmp/raw.json",
        };
      }
      if (command === "workspace_write_text") {
        return `/tmp/${String(args?.name ?? "unknown")}`;
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const bootstrapped = await bootstrapRoleKnowledgeProfile({
      cwd: "/tmp/workspace",
      invokeFn,
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

    expect(stored.artifactPaths.some((path) => path.endsWith(".json"))).toBe(true);
    expect(stored.profile.markdownPath).toBeUndefined();
    expect(bootstrapped.sourceSuccessCount).toBeGreaterThan(0);
    expect(injected.usedProfile).toBe(true);
    expect(injected.prompt).toContain("Formatting re-enabled");
    expect(injected.prompt).toContain("<role_profile>");
    expect(injected.prompt).toContain("[ROLE_KB_INJECT]");
    expect(injected.prompt).toContain("<task_request>");
    expect(injected.prompt).toContain("이동 시스템을 구현해줘");
  });

  it("keeps role allowlist sources relevant and secure", () => {
    for (const [roleId, urls] of Object.entries(ROLE_KB_ALLOWLIST)) {
      expect(urls.length).toBeGreaterThanOrEqual(3);
      const unique = new Set(urls);
      expect(unique.size).toBe(urls.length);
      for (const url of urls) {
        expect(url.startsWith("https://")).toBe(true);
        expect(url.includes("notion.so/help")).toBe(false);
      }
      if (roleId === "pm_planner") {
        expect(urls.some((url) => url.includes("gamedeveloper.com/design"))).toBe(true);
        expect(urls.some((url) => url.includes("gdcvault.com/free"))).toBe(true);
      }
    }
  });
});
