import { describe, expect, it } from "vitest";
import { buildAgentDispatchPayload } from "./agentPrompt";

describe("buildAgentDispatchPayload", () => {
  it("injects selected data source ids/details as RAG source block", () => {
    const payload = buildAgentDispatchPayload({
      threadName: "spec-architect",
      threadRole: "Spec Architect",
      threadGuidance: ["요구사항 분해", "수용 기준 정리"],
      threadStarterPrompt: "요구사항 기준으로 명세를 작성해줘.",
      selectedModel: "gpt-5.2-codex",
      selectedReasonLevel: "보통",
      isReasonLevelSelectable: true,
      text: "이번 작업 명세를 작성해줘.",
      attachedFileNames: ["design.md"],
      selectedDataSourceIds: ["marketSummary:topic-1", "devEcosystem:topic-2"],
      selectedDataSourceDetails: ["MARKET_SUMMARY · 변동성 확대", "DEV_ECOSYSTEM · 릴리스 노트 업데이트"],
      codexMultiAgentMode: "balanced",
    });

    expect(payload).toContain("[RAG SOURCES]");
    expect(payload).toContain("SOURCE IDS: marketSummary:topic-1, devEcosystem:topic-2");
    expect(payload).toContain("MARKET_SUMMARY · 변동성 확대");
    expect(payload).toContain("DEV_ECOSYSTEM · 릴리스 노트 업데이트");
  });

  it("omits RAG source block when no selected data source exists", () => {
    const payload = buildAgentDispatchPayload({
      threadName: "implementation-agent",
      threadRole: "Implementation Agent",
      threadGuidance: [],
      threadStarterPrompt: "",
      selectedModel: "gpt-5.2-codex",
      selectedReasonLevel: "보통",
      isReasonLevelSelectable: true,
      text: "코드를 구현해줘.",
      attachedFileNames: [],
      selectedDataSourceIds: [],
      selectedDataSourceDetails: [],
      codexMultiAgentMode: "balanced",
    });

    expect(payload).not.toContain("[RAG SOURCES]");
  });
});
