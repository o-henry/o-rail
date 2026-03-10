import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storeGraphRoleKnowledge } from "./graphRoleKnowledgeMemory";
import { readRoleKnowledgeProfiles, writeRoleKnowledgeProfiles } from "./roleKnowledgeStore";

function createLocalStorageMock() {
  let store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store = new Map<string, string>();
    }),
  };
}

describe("graphRoleKnowledgeMemory", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createLocalStorageMock(),
      configurable: true,
    });
  });

  afterEach(() => {
    writeRoleKnowledgeProfiles([]);
  });

  it("stores completed graph role output into role knowledge profiles", () => {
    writeRoleKnowledgeProfiles([]);

    storeGraphRoleKnowledge({
      roleId: "pm_planner",
      runId: "run-graph-1",
      taskId: "PLAN-001",
      output: {
        summary: "전투 루프를 3단계로 정리합니다.",
        notes: [
          "입문 5분 내 핵심 재미 전달",
          "보상 루프는 전투 후 즉시 노출",
        ],
        source: "https://example.com/design-loop",
      },
      logs: ["요구사항 수집 완료"],
    });

    const stored = readRoleKnowledgeProfiles().find((row) => row.roleId === "pm_planner");
    expect(stored?.runId).toBe("run-graph-1");
    expect(stored?.taskId).toBe("PLAN-001");
    expect(stored?.summary).toContain("전투 루프");
    expect(stored?.keyPoints.length).toBeGreaterThan(0);
    expect(stored?.sources[0]?.url).toBe("https://example.com/design-loop");
  });

  it("merges validated role knowledge instead of replacing prior points", () => {
    writeRoleKnowledgeProfiles([
      {
        roleId: "pm_planner",
        roleLabel: "기획(PM)",
        goal: "요구사항 정의",
        taskId: "PLAN-001",
        runId: "run-older",
        summary: "기존 누적 요약",
        keyPoints: ["기존 포인트"],
        sources: [{ url: "https://example.com/old", status: "ok", fetchedAt: "2026-03-01T00:00:00.000Z" }],
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    storeGraphRoleKnowledge({
      roleId: "pm_planner",
      runId: "run-new",
      taskId: "PLAN-002",
      output: {
        summary: "새 기획 판단 요약",
        notes: ["신규 포인트"],
        source: "https://example.com/new",
      },
      logs: [],
    });

    const stored = readRoleKnowledgeProfiles().find((row) => row.roleId === "pm_planner");
    expect(stored?.runId).toBe("run-new");
    expect(stored?.summary).toContain("새 기획 판단 요약");
    expect(stored?.summary).toContain("기존 누적 요약");
    expect(stored?.keyPoints).toEqual(expect.arrayContaining(["기존 포인트"]));
    expect(stored?.keyPoints.some((line) => line.includes("새 기획"))).toBe(true);
    expect(stored?.sources.map((row) => row.url)).toEqual(
      expect.arrayContaining(["https://example.com/old", "https://example.com/new"]),
    );
  });

  it("stores instance knowledge separately when a role instance id is present", () => {
    writeRoleKnowledgeProfiles([]);

    storeGraphRoleKnowledge({
      roleId: "pm_planner",
      roleInstanceId: "pm_planner:alt-1",
      runId: "run-alt",
      taskId: "PLAN-ALT-001",
      output: {
        summary: "실험형 PM 관점",
        notes: ["리스크를 감수하고 차별화를 우선"],
        source: "https://example.com/alt-perspective",
      },
      logs: [],
    });

    const rows = readRoleKnowledgeProfiles().filter((row) => row.roleId === "pm_planner");
    const shared = rows.find((row) => (row.scope ?? "shared") === "shared");
    const instance = rows.find((row) => row.scope === "instance" && row.instanceId === "pm_planner:alt-1");

    expect(shared?.summary).toContain("실험형 PM 관점");
    expect(instance?.summary).toContain("실험형 PM 관점");
    expect(instance?.instanceId).toBe("pm_planner:alt-1");
  });

  it("stores logical PM output under the logical PM knowledge profile", () => {
    writeRoleKnowledgeProfiles([]);

    storeGraphRoleKnowledge({
      roleId: "pm_planner",
      pmPlanningMode: "logical",
      runId: "run-logic",
      taskId: "PLAN-CRITIC-001",
      output: {
        summary: "현실성 점수표를 정리합니다.",
        notes: ["운영 비용과 범위 리스크를 먼저 본다"],
      },
      logs: [],
    });

    const stored = readRoleKnowledgeProfiles().find((row) => row.roleId === "pm_feasibility_critic");
    expect(stored?.runId).toBe("run-logic");
    expect(stored?.summary).toContain("현실성 점수표");
  });
});
