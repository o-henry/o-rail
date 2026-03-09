import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectKnowledgeContext } from "./turnExecutionUtils";
import { writeRoleKnowledgeProfiles } from "../../../features/studio/roleKnowledgeStore";
import type { GraphNode } from "../../../features/workflow/types";

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

describe("injectKnowledgeContext role knowledge", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createLocalStorageMock(),
      configurable: true,
    });
  });

  it("prepends stored role knowledge for handoff nodes", async () => {
    writeRoleKnowledgeProfiles([
      {
        roleId: "pm_planner",
        roleLabel: "기획(PM)",
        goal: "요구사항 정의",
        taskId: "PLAN-001",
        runId: "run-1",
        summary: "기획 근거 요약",
        keyPoints: ["핵심 루프를 먼저 고정", "범위와 완료 기준을 분리"],
        sources: [{ url: "https://example.com/design", status: "ok", summary: "레벨 진행 구조 참고" }],
        updatedAt: new Date().toISOString(),
      },
    ]);

    const node: GraphNode = {
      id: "turn-role",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        sourceKind: "handoff",
        handoffRoleId: "pm_planner",
        knowledgeEnabled: true,
      },
    };

    const result = await injectKnowledgeContext({
      node,
      prompt: "현재 요청",
      config: node.config,
      workflowQuestion: "새 게임 기획",
      activeRunPresetKind: undefined,
      internalMemoryCorpus: [],
      enabledKnowledgeFiles: [],
      graphKnowledge: { topK: 0, maxChars: 0 },
      addNodeLog: vi.fn(),
      invokeFn: vi.fn(),
    });

    expect(result.prompt).toContain("[역할 누적 지식]");
    expect(result.prompt).toContain("기획 근거 요약");
    expect(result.prompt).toContain("핵심 루프를 먼저 고정");
    expect(result.prompt).toContain("현재 요청");
  });

  it("merges shared and instance role knowledge for perspective passes", async () => {
    writeRoleKnowledgeProfiles([
      {
        roleId: "pm_planner",
        scope: "shared",
        roleLabel: "기획(PM)",
        goal: "요구사항 정의",
        taskId: "PLAN-001",
        runId: "run-shared",
        summary: "공통 PM 지식",
        keyPoints: ["공통 기준선 유지"],
        sources: [],
        updatedAt: new Date().toISOString(),
      },
      {
        roleId: "pm_planner",
        scope: "instance",
        instanceId: "pm_planner:alt-1",
        roleLabel: "기획(PM) · 추가 시각 1",
        goal: "대안 시각",
        taskId: "PLAN-ALT-001",
        runId: "run-instance",
        summary: "대안 PM 시각",
        keyPoints: ["실험적 시각에서 리스크 감수"],
        sources: [],
        updatedAt: new Date().toISOString(),
      },
    ]);

    const node: GraphNode = {
      id: "turn-role-alt",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        sourceKind: "handoff",
        handoffRoleId: "pm_planner",
        roleInstanceId: "pm_planner:alt-1",
        knowledgeEnabled: true,
      },
    };

    const result = await injectKnowledgeContext({
      node,
      prompt: "대안 시각으로 평가",
      config: node.config,
      workflowQuestion: "새 게임 기획",
      activeRunPresetKind: undefined,
      internalMemoryCorpus: [],
      enabledKnowledgeFiles: [],
      graphKnowledge: { topK: 0, maxChars: 0 },
      addNodeLog: vi.fn(),
      invokeFn: vi.fn(),
    });

    expect(result.prompt).toContain("[역할 누적 지식]");
    expect(result.prompt).toContain("공통 PM 지식");
    expect(result.prompt).toContain("[관점별 누적 지식]");
    expect(result.prompt).toContain("대안 PM 시각");
    expect(result.prompt).toContain("실험적 시각");
  });
});
