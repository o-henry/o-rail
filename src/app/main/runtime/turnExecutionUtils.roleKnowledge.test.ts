import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectKnowledgeContext } from "./turnExecutionUtils";
import { writeRoleKnowledgeProfiles } from "../../../features/studio/roleKnowledgeStore";
import { addUserMemoryEntry } from "../../../features/studio/userMemoryStore";
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

  it("uses logical PM knowledge when a PM node switches mode", async () => {
    writeRoleKnowledgeProfiles([
      {
        roleId: "pm_feasibility_critic",
        roleLabel: "기획(PM) · 논리 모드",
        goal: "현실성 평가",
        taskId: "PLAN-CRITIC-001",
        runId: "run-critic",
        summary: "현실성 점수 기준",
        keyPoints: ["0-10 점수로 범위와 운영 비용을 본다"],
        sources: [],
        updatedAt: new Date().toISOString(),
      },
    ]);

    const node: GraphNode = {
      id: "turn-role-logic",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        sourceKind: "handoff",
        handoffRoleId: "pm_planner",
        pmPlanningMode: "logical",
        knowledgeEnabled: true,
      },
    };

    const result = await injectKnowledgeContext({
      node,
      prompt: "냉정하게 검토",
      config: node.config,
      workflowQuestion: "새 게임 기획",
      activeRunPresetKind: undefined,
      internalMemoryCorpus: [],
      enabledKnowledgeFiles: [],
      graphKnowledge: { topK: 0, maxChars: 0 },
      addNodeLog: vi.fn(),
      invokeFn: vi.fn(),
    });

    expect(result.prompt).toContain("현실성 점수 기준");
    expect(result.prompt).toContain("0-10 점수");
    expect(result.prompt).toContain("냉정하게 검토");
  });

  it("prepends stored user memory when relevant", async () => {
    addUserMemoryEntry("나는 1인 인디 게임 개발자이고 빠른 프로토타이핑을 중요하게 생각한다.", "manual");

    const node: GraphNode = {
      id: "turn-general",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        knowledgeEnabled: true,
      },
    };

    const result = await injectKnowledgeContext({
      node,
      prompt: "창의적인 게임 아이디어를 제안해줘",
      config: node.config,
      workflowQuestion: "인디 게임 아이디어를 빠르게 검증하고 싶다",
      activeRunPresetKind: undefined,
      internalMemoryCorpus: [],
      enabledKnowledgeFiles: [],
      graphKnowledge: { topK: 0, maxChars: 0 },
      addNodeLog: vi.fn(),
      invokeFn: vi.fn(),
    });

    expect(result.prompt).toContain("[사용자 장기 메모리]");
    expect(result.prompt).toContain("1인 인디 게임 개발자");
    expect(result.prompt).toContain("창의적인 게임 아이디어를 제안해줘");
  });

  it("injects attached knowledge snippets into the node prompt", async () => {
    const invokeSpy = vi.fn();
    const invokeFn = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invokeSpy(command, args);
      if (command !== "knowledge_retrieve") {
        return { snippets: [], warnings: [] } as T;
      }
      return {
        snippets: [
          {
            fileId: "file-1",
            fileName: "guide.md",
            chunkIndex: 2,
            score: 0.91,
            text: "핵심 루프는 30초 안에 이해되어야 한다.",
          },
        ],
        warnings: [],
      } as T;
    };

    const node: GraphNode = {
      id: "turn-with-files",
      type: "turn",
      position: { x: 0, y: 0 },
      config: {
        knowledgeEnabled: true,
      },
    };

    const result = await injectKnowledgeContext({
      node,
      prompt: "유니티 게임 아이디어를 만들어줘",
      config: node.config,
      workflowQuestion: "창의적인 아이디어가 필요하다",
      activeRunPresetKind: undefined,
      internalMemoryCorpus: [],
      enabledKnowledgeFiles: [{ id: "file-1", name: "guide.md", enabled: true }],
      graphKnowledge: { topK: 3, maxChars: 2400 },
      addNodeLog: vi.fn(),
      invokeFn,
    });

    expect(invokeSpy).toHaveBeenCalledWith(
      "knowledge_retrieve",
      expect.objectContaining({
        files: [{ id: "file-1", name: "guide.md", enabled: true }],
        topK: 3,
        maxChars: 2400,
      }),
    );
    expect(result.prompt).toContain("[첨부 참고자료]");
    expect(result.prompt).toContain("guide.md#2");
    expect(result.prompt).toContain("핵심 루프는 30초 안에 이해되어야 한다.");
    expect(result.trace).toEqual([
      expect.objectContaining({
        fileId: "file-1",
        fileName: "guide.md",
      }),
    ]);
  });
});
