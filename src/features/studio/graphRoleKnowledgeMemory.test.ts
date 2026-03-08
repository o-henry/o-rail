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
});
