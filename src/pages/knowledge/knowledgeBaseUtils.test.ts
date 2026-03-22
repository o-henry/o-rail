import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "../../features/studio/knowledgeTypes";
import { toReadableJsonInfo } from "./knowledgeEntryMapping";
import {
  buildKnowledgeEntryStats,
  groupKnowledgeEntries,
  shouldDeleteKnowledgeRunRecord,
  sortKnowledgeEntries,
} from "./knowledgeBaseUtils";

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "entry-1",
    runId: "run-1",
    taskId: "TASK_ONE",
    roleId: "technical_writer",
    sourceKind: "artifact",
    title: "문서",
    summary: "요약",
    createdAt: "2026-03-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("knowledgeBaseUtils", () => {
  it("groups same multi-agent request into one session and sorts latest group first", () => {
    const grouped = groupKnowledgeEntries(
      sortKnowledgeEntries([
        makeEntry({ id: "entry-1", runId: "run-old", taskId: "TASK_OLD", createdAt: "2026-03-03T00:00:00.000Z" }),
        makeEntry({
          id: "entry-2",
          runId: "run-new",
          taskId: "TASK_NEW",
          taskAgentId: "game_designer",
          taskAgentLabel: "GAME DESIGNER",
          studioRoleLabel: "기획",
          summary: "# USER REQUEST\n신선한 1인 인디게임 아이디어 3개만 추려줘",
          createdAt: "2026-03-05T00:00:00.000Z",
        }),
        makeEntry({
          id: "entry-3",
          runId: "run-new-researcher",
          taskId: "TASK_NEW",
          taskAgentId: "researcher",
          taskAgentLabel: "RESEARCHER",
          studioRoleLabel: "리서처",
          summary: "# USER REQUEST\n신선한 1인 인디게임 아이디어 3개만 추려줘",
          createdAt: "2026-03-04T00:00:00.000Z",
        }),
      ]),
    );

    expect(grouped.map((group) => group.runId)).toEqual(["run-new", "run-old"]);
    expect(grouped[0]?.entries.map((entry) => entry.id)).toEqual(["entry-2", "entry-3"]);
    expect(grouped[0]?.runIds).toEqual(["run-new", "run-new-researcher"]);
    expect(grouped[0]?.taskId).toBe("TASK_NEW");
    expect(grouped[0]?.promptLabel).toBe("신선한 1인 인디게임 아이디어 3개만 추려줘");
    expect(grouped[0]?.roleGroups.map((group) => group.label)).toEqual(["GAME DESIGNER", "RESEARCHER"]);
  });

  it("summarizes parsed JSON fields for detail view", () => {
    const info = toReadableJsonInfo(JSON.stringify({ summary: "ok", count: 3, tags: ["a", "b"] }));

    expect(info.summaryRows).toEqual([
      { key: "SUMMARY", value: "ok" },
      { key: "COUNT", value: "3" },
      { key: "TAGS", value: "배열 2개" },
    ]);
    expect(info.pretty).toContain("\"count\": 3");
  });

  it("does not delete dashboard synthetic run records as run files", () => {
    expect(shouldDeleteKnowledgeRunRecord("run-123.json")).toBe(true);
    expect(shouldDeleteKnowledgeRunRecord("dashboard-market-summary-1.json")).toBe(false);
    expect(shouldDeleteKnowledgeRunRecord("/tmp/run-123.json")).toBe(false);
  });

  it("groups by original request label even when role prompts differ", () => {
    const grouped = groupKnowledgeEntries(sortKnowledgeEntries([
      makeEntry({
        id: "entry-a",
        runId: "run-a",
        taskId: "THREAD_1",
        taskAgentId: "game_designer",
        taskAgentLabel: "GAME DESIGNER",
        requestLabel: "1인 인디게임 창의적 아이디어 3개만 추려줘",
        summary: "역할별 프롬프트 A",
      }),
      makeEntry({
        id: "entry-b",
        runId: "run-b",
        taskId: "THREAD_1",
        taskAgentId: "researcher",
        taskAgentLabel: "RESEARCHER",
        requestLabel: "1인 인디게임 창의적 아이디어 3개만 추려줘",
        summary: "역할별 프롬프트 B",
      }),
    ]));

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.promptLabel).toBe("1인 인디게임 창의적 아이디어 3개만 추려줘");
    expect(grouped[0]?.roleGroups.map((group) => group.label)).toEqual(["GAME DESIGNER", "RESEARCHER"]);
  });

  it("separates document, run, and role counts", () => {
    expect(buildKnowledgeEntryStats([
      makeEntry({
        id: "entry-a",
        runId: "run-a",
        taskAgentId: "game_designer",
        roleId: "pm_planner",
        sourceKind: "artifact",
      }),
      makeEntry({
        id: "entry-b",
        runId: "run-a",
        taskAgentId: "game_designer",
        roleId: "pm_planner",
        sourceKind: "web",
      }),
      makeEntry({
        id: "entry-c",
        runId: "run-b",
        taskAgentId: "researcher",
        roleId: "research_analyst",
        sourceKind: "ai",
      }),
    ])).toEqual({
      total: 3,
      runs: 2,
      roles: 2,
      artifact: 1,
      web: 1,
      ai: 1,
    });
  });
});
