import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapRoleKnowledgeProfile,
  injectRoleKnowledgePrompt,
  storeRoleKnowledgeProfile,
} from "./roleKnowledgePipeline";
import { buildRoleKnowledgeBootstrapCandidates } from "./roleKnowledgeBootstrapSources";
import { resetRoleKnowledgeProviderRuntimeForTests } from "./roleKnowledgeProviders";

describe("roleKnowledgePipeline", () => {
  beforeEach(() => {
    resetRoleKnowledgeProviderRuntimeForTests();
  });

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
      if (command === "dashboard_crawl_provider_health") {
        return {
          provider: "scrapling",
          available: true,
          installable: true,
          ready: false,
          message: "health check failed (401 Unauthorized): {\"ok\": false, \"errorCode\": \"UNAUTHORIZED\", \"error\": \"unauthorized\"}",
        };
      }
      if (command === "dashboard_crawl_provider_install") {
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
    const invokeFn = vi.fn(async (command: string) => {
      if (command === "dashboard_crawl_provider_health") {
        throw new Error("dashboard_crawl_provider_health timed out after 28000ms");
      }
      if (command === "dashboard_crawl_provider_install") {
        return { installed: true };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await bootstrapRoleKnowledgeProfile({
      cwd: "/tmp/workspace",
      invokeFn,
      roleId: "pm_planner",
      taskId: "TASK-TIMEOUT",
      runId: "role-timeout",
      userPrompt: "스팀 장르 시장을 조사해줘",
    });
    expect(result.sourceSuccessCount).toBe(0);
    expect(result.profile.summary).toContain("외부 근거 수집에 실패했습니다");
    expect(result.profile.keyPoints.some((point) => point.includes("timed out"))).toBe(true);
  }, 15000);

  it("stores and injects role knowledge block into prompt", async () => {
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "dashboard_crawl_provider_health") {
        return {
          provider: "scrapling",
          available: true,
          configured: true,
          installable: true,
          ready: true,
          message: "ready",
        };
      }
      if (command === "dashboard_crawl_provider_install") {
        return {
          installed: true,
        };
      }
      if (command === "dashboard_crawl_provider_fetch_url") {
        return {
          provider: "scrapling",
          status: "ok",
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
  }, 15000);

  it("builds official-first bootstrap candidates from the prompt and role profile", () => {
    const urls = buildRoleKnowledgeBootstrapCandidates({
      roleId: "research_analyst",
      userPrompt:
        "스팀, 레딧, 메타크리틱 기준으로 2026년 장르 평가를 조사해줘. https://opencritic.com/ 도 참고해줘.",
    });

    expect(urls.length).toBeGreaterThanOrEqual(4);
    expect(urls.length).toBeLessThanOrEqual(7);
    expect(urls[0]).toBe("https://opencritic.com/");
    expect(urls.some((url) => url === "https://store.steampowered.com/")).toBe(true);
    expect(urls.some((url) => url === "https://steamcommunity.com/")).toBe(true);
    expect(urls.some((url) => url.includes("duckduckgo.com/html/?q="))).toBe(false);
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

  it("falls back to search-result bootstrap candidates when no direct domain target exists", () => {
    const urls = buildRoleKnowledgeBootstrapCandidates({
      roleId: "research_analyst",
      userPrompt: "짧고 중독성 있는 인디게임 아이디어를 조사해줘",
    });

    expect(urls.some((url) => url.includes("duckduckgo.com"))).toBe(true);
    expect(urls.some((url) => url.includes("bing.com/search"))).toBe(true);
  });

  it("prefers steam market sources over legacy pm planning domains for game ideation", () => {
    const urls = buildRoleKnowledgeBootstrapCandidates({
      roleId: "pm_planner",
      userPrompt: "스팀 기준으로 2026년 게임 장르 트렌드와 시장 신호를 조사해줘",
    });

    expect(urls.some((url) => url === "https://store.steampowered.com/")).toBe(true);
    expect(urls.some((url) => url === "https://steamcommunity.com/")).toBe(true);
    expect(urls.some((url) => url === "https://steamdb.info/")).toBe(true);
    expect(urls.some((url) => url.includes("gdcvault.com"))).toBe(false);
  });

  it("retries researcher bootstrap until it reaches at least half successful sources", async () => {
    const attemptsByUrl = new Map<string, number>();
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "dashboard_crawl_provider_health") {
        const provider = String(args?.provider ?? "");
        if (provider !== "scrapling") {
          return {
            provider,
            available: false,
            configured: false,
            installable: false,
            ready: false,
            message: `${provider} not configured`,
          };
        }
        return {
          provider,
          available: true,
          configured: true,
          installable: true,
          ready: true,
          message: "ready",
        };
      }
      if (command === "dashboard_crawl_provider_fetch_url") {
        const url = String(args?.url ?? "");
        const provider = String(args?.provider ?? "");
        if (provider !== "scrapling") {
          throw new Error(`unexpected provider ${provider}`);
        }
        const attempt = (attemptsByUrl.get(url) ?? 0) + 1;
        attemptsByUrl.set(url, attempt);
        if (attempt === 1) {
          throw new Error(`temporary timeout for ${url}`);
        }
        return {
          provider,
          status: "ok",
          url,
          fetched_at: "2026-03-21T00:00:00Z",
          summary: `summary for ${url}`,
          content: `content for ${url}`,
          json_path: `/tmp/${attemptsByUrl.size}.json`,
        };
      }
      if (command === "dashboard_crawl_provider_install") {
        return { installed: true };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await bootstrapRoleKnowledgeProfile({
      cwd: "/tmp/workspace",
      invokeFn,
      roleId: "research_analyst",
      taskId: "TASK-RETRY",
      runId: "role-retry",
      userPrompt: "2026년 3월 20일 기준 가장 인기 있는 게임 장르를 조사해줘",
    });

    expect(result.sourceCount).toBeGreaterThan(0);
    expect(result.sourceSuccessCount).toBeGreaterThanOrEqual(Math.ceil(result.sourceCount * 0.5));
    expect(result.message).toContain("재시도");
  }, 15000);

  it("falls back from crawl4ai to scrapling for documentation-like sources", async () => {
    const invokeFn = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "dashboard_crawl_provider_health") {
        const provider = String(args?.provider ?? "");
        if (provider === "crawl4ai") {
          return {
            provider,
            available: false,
            configured: true,
            installable: false,
            ready: false,
            message: "crawl4ai runtime not installed",
          };
        }
        return {
          provider,
          available: true,
          configured: true,
          installable: true,
          ready: true,
          message: "ready",
        };
      }
      if (command === "dashboard_crawl_provider_fetch_url") {
        return {
          provider: String(args?.provider ?? "scrapling"),
          status: "ok",
          url: String(args?.url ?? ""),
          fetched_at: "2026-03-22T00:00:00Z",
          summary: "fallback summary",
          content: "fallback content",
          json_path: "/tmp/fallback.json",
        };
      }
      if (command === "dashboard_crawl_provider_install") {
        return { installed: true };
      }
      throw new Error(`unexpected command: ${command}`);
    }) as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const result = await bootstrapRoleKnowledgeProfile({
      cwd: "/tmp/workspace",
      invokeFn,
      roleId: "technical_writer",
      taskId: "TASK-DOCS",
      runId: "role-docs",
      userPrompt: "공식 문서 기준으로 Tauri window API guide를 정리해줘",
    });

    const invokeMock = invokeFn as ReturnType<typeof vi.fn>;
    const healthProviders = invokeMock.mock.calls
      .filter((call) => String((call as [unknown, unknown])[0] ?? "") === "dashboard_crawl_provider_health")
      .map((call) => {
        const [, args] = call as [string, Record<string, unknown> | undefined];
        return String(args?.provider ?? "");
      });

    expect(healthProviders.includes("crawl4ai")).toBe(true);
    expect(healthProviders.includes("scrapling")).toBe(true);
    expect(result.sourceSuccessCount).toBeGreaterThan(0);
  });
});
