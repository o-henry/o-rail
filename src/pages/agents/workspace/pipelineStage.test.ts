import { describe, expect, it } from "vitest";
import { buildProcessSteps, resolveAgentPipelineStatus, resolvePipelineStageIndex, resolvePipelineStepStates } from "./pipelineStage";

describe("pipeline stage mapping", () => {
  it("maps runtime stage keys to pipeline index", () => {
    expect(resolvePipelineStageIndex({ running: true, progressStage: "crawler" })).toBe(0);
    expect(resolvePipelineStageIndex({ running: true, progressStage: "rag" })).toBe(1);
    expect(resolvePipelineStageIndex({ running: true, progressStage: "codex_turn" })).toBe(2);
    expect(resolvePipelineStageIndex({ running: true, progressStage: "save" })).toBe(3);
  });

  it("uses text inference when stage key is absent", () => {
    expect(resolvePipelineStageIndex({ running: true, progressText: "크롤러 실행 중" })).toBe(0);
    expect(resolvePipelineStageIndex({ running: true, progressText: "근거 추출 완료" })).toBe(1);
    expect(resolvePipelineStageIndex({ running: true, progressText: "Codex 응답 생성 중" })).toBe(2);
    expect(resolvePipelineStageIndex({ running: true, progressText: "스냅샷 저장 중" })).toBe(3);
  });

  it("marks all steps as done after completion", () => {
    expect(
      resolvePipelineStepStates({
        running: false,
        progressStage: "done",
        lastRunAt: "2026-03-01T00:00:00.000Z",
      }),
    ).toEqual(["done", "done", "done", "done"]);
  });

  it("keeps pending state for failed runs", () => {
    expect(
      resolvePipelineStepStates({
        running: false,
        progressStage: "error",
        lastError: "failed",
      }),
    ).toEqual(["error", "pending", "pending", "pending"]);
  });

  it("shows scoped steps per data pipeline agent", () => {
    const crawlerSteps = buildProcessSteps(
      {
        id: "marketSummary-crawler",
        name: "crawler-agent",
        role: "Crawler",
        guidance: [],
        starterPrompt: "",
        status: "preset",
      },
      false,
      "marketSummary",
      { running: true, progressStage: "rag" },
    );
    const ragSteps = buildProcessSteps(
      {
        id: "marketSummary-rag",
        name: "rag-analyst",
        role: "RAG",
        guidance: [],
        starterPrompt: "",
        status: "preset",
      },
      false,
      "marketSummary",
      { running: true, progressStage: "rag" },
    );
    const synthSteps = buildProcessSteps(
      {
        id: "marketSummary-synth",
        name: "snapshot-synthesizer",
        role: "Synth",
        guidance: [],
        starterPrompt: "",
        status: "preset",
      },
      false,
      "marketSummary",
      { running: true, progressStage: "rag" },
    );
    expect(crawlerSteps.map((step) => step.label)).toEqual(["allowlist 소스 수집 완료, raw 문서 저장 완료"]);
    expect(ragSteps.map((step) => step.label)).toEqual(["knowledge_probe/retrieve로 근거 스니펫 추출·정규화 중"]);
    expect(synthSteps.map((step) => step.label)).toEqual(["Codex 요약/리스크/이벤트 생성 대기", "스냅샷 저장 대기"]);
  });

  it("marks running agent by stage", () => {
    const crawlerStatus = resolveAgentPipelineStatus(
      {
        id: "marketSummary-crawler",
        name: "crawler-agent",
        role: "Crawler",
        guidance: [],
        starterPrompt: "",
        status: "preset",
      },
      "marketSummary",
      { running: true, progressStage: "rag" },
    );
    const ragStatus = resolveAgentPipelineStatus(
      {
        id: "marketSummary-rag",
        name: "rag-analyst",
        role: "RAG",
        guidance: [],
        starterPrompt: "",
        status: "preset",
      },
      "marketSummary",
      { running: true, progressStage: "rag" },
    );
    expect(crawlerStatus).toBe("done");
    expect(ragStatus).toBe("running");
  });

  it("ignores run state when expected runId does not match", () => {
    const status = resolveAgentPipelineStatus(
      {
        id: "marketSummary-rag",
        name: "rag-analyst",
        role: "RAG",
        guidance: [],
        starterPrompt: "",
        status: "preset",
      },
      "marketSummary",
      { running: true, progressStage: "rag", runId: "topic-20260302-aaa111" },
      "topic-20260302-bbb222",
    );
    const steps = buildProcessSteps(
      {
        id: "marketSummary-rag",
        name: "rag-analyst",
        role: "RAG",
        guidance: [],
        starterPrompt: "",
        status: "preset",
      },
      false,
      "marketSummary",
      { running: true, progressStage: "rag", runId: "topic-20260302-aaa111" },
      "topic-20260302-bbb222",
    );
    expect(status).toBe("pending");
    expect(steps.every((step) => step.state === "pending")).toBe(true);
  });

  it("keeps non-data agents as pending before explicit runtime state", () => {
    const status = resolveAgentPipelineStatus(
      {
        id: "market-scout",
        name: "signal-scout",
        role: "Scout",
        guidance: ["핵심 신호 수집"],
        starterPrompt: "",
        status: "preset",
      },
      null,
      null,
    );
    const steps = buildProcessSteps(
      {
        id: "market-scout",
        name: "signal-scout",
        role: "Scout",
        guidance: ["핵심 신호 수집", "핵심 근거 정리"],
        starterPrompt: "",
        status: "preset",
      },
      true,
      null,
      null,
    );
    expect(status).toBe("pending");
    expect(steps.every((step) => step.state === "pending")).toBe(true);
  });
});
