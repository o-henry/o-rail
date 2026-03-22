import { describe, expect, it } from "vitest";
import { extractKnowledgeRequestSummary } from "./knowledgeRequestSummary";

describe("knowledgeRequestSummary", () => {
  it("strips internal orchestration wrappers from task_request payloads", () => {
    const summary = extractKnowledgeRequestSummary(`
<task_request>
# 작업 모드 최종 합성 답변
Formatting re-enabled
<role_profile>
PM planning mode
</role_profile>
역할을 부여해줄게, 스팀에 대해 조사해서 최소 10개의 장르 불문 게임 아이디어를 고안해줘.
# 압축된 스레드 컨텍스트
이전 대화 요약
</task_request>
    `);

    expect(summary).toContain("역할을 부여해줄게");
    expect(summary).not.toContain("Formatting re-enabled");
    expect(summary).not.toContain("압축된 스레드 컨텍스트");
    expect(summary).not.toContain("role_profile");
  });
});
