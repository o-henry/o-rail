import { describe, expect, it, vi } from "vitest";
import {
  bootstrapRoleKnowledgeProfile,
  injectRoleKnowledgePrompt,
  storeRoleKnowledgeProfile,
} from "./roleKnowledgePipeline";
import { buildRoleKnowledgeBootstrapCandidates } from "./roleKnowledgeBootstrapSources";

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
    expect(result.profile.summary).toContain("외부 근거 수집에 실패했습니다");
    expect(result.message).toContain("실패");
  });

  it("marks unauthorized bridge failures clearly in the profile summary", async () => {
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "dashboard_scrapling_bridge_start") {
        return {
          running: false,
          scrapling_ready: false,
          message: "health check failed (401 Unauthorized): {\"ok\": false, \"errorCode\": \"UNAUTHORIZED\", \"error\": \"unauthorized\"}",
        };
      }
      if (command === "dashboard_scrapling_bridge_install") {
        return { installed: true };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await bootstrapRoleKnowledgeProfile({
      cwd: "/tmp/workspace",
      invokeFn,
      roleId: "research_analyst",
      taskId: "TASK-UNAUTHORIZED",
      runId: "role-unauthorized",
      userPrompt: "스팀 장르 시장을 조사해줘",
    });

    expect(result.sourceSuccessCount).toBe(0);
    expect(result.profile.summary).toContain("인증 실패");
    expect(result.profile.keyPoints.some((point) => point.includes("소스 수집 실패"))).toBe(true);
  });

  it("times out stalled bridge startup and falls back without blocking the role run forever", async () => {
    vi.useFakeTimers();
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "dashboard_scrapling_bridge_start") {
        return await new Promise<never>(() => {});
      }
      if (command === "dashboard_scrapling_bridge_install") {
        return { installed: true };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    try {
      const promise = bootstrapRoleKnowledgeProfile({
        cwd: "/tmp/workspace",
        invokeFn,
        roleId: "research_analyst",
        taskId: "TASK-TIMEOUT",
        runId: "role-timeout",
        userPrompt: "스팀 장르 시장을 조사해줘",
      });
      await vi.advanceTimersByTimeAsync(25000);
      const result = await promise;
      expect(result.sourceSuccessCount).toBe(0);
      expect(result.profile.summary).toContain("외부 근거 수집에 실패했습니다");
      expect(result.profile.keyPoints.some((point) => point.includes("timed out"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it("builds search-first bootstrap candidates from the prompt and role profile", () => {
    const urls = buildRoleKnowledgeBootstrapCandidates({
      roleId: "research_analyst",
      userPrompt:
        "스팀, 레딧, 메타크리틱 기준으로 2026년 장르 평가를 조사해줘. https://opencritic.com/ 도 참고해줘.",
    });

    expect(urls.length).toBeGreaterThanOrEqual(4);
    expect(urls.length).toBeLessThanOrEqual(7);
    expect(urls[0]).toBe("https://opencritic.com/");
    expect(urls.some((url) => url.includes("duckduckgo.com/html/?q="))).toBe(true);
    expect(urls.some((url) => url.includes("bing.com/search?q="))).toBe(true);
    expect(urls.some((url) => url.includes("site%3Awww.reddit.com"))).toBe(true);
    expect(urls.some((url) => url.includes("site%3Awww.metacritic.com"))).toBe(true);
  });

  it("keeps bootstrap candidates on public https pages without duplicates", () => {
    const urls = buildRoleKnowledgeBootstrapCandidates({
      roleId: "client_programmer",
      userPrompt: "Unity 입력 시스템과 상태머신 구현 패턴 조사",
    });

    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url.startsWith("https://")).toBe(true);
      expect(url.includes("notion.so/help")).toBe(false);
    }
  });
});
