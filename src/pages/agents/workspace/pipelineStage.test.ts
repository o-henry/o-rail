import { describe, expect, it } from "vitest";
import { resolvePipelineStageIndex, resolvePipelineStepStates } from "./pipelineStage";

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

  it("marks all steps as running after completion", () => {
    expect(
      resolvePipelineStepStates({
        running: false,
        progressStage: "done",
        lastRunAt: "2026-03-01T00:00:00.000Z",
      }),
    ).toEqual(["running", "running", "running", "running"]);
  });

  it("keeps pending state for failed runs", () => {
    expect(
      resolvePipelineStepStates({
        running: false,
        progressStage: "error",
        lastError: "failed",
      }),
    ).toEqual(["pending", "pending", "pending", "pending"]);
  });
});
