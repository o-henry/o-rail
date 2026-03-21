import { describe, expect, it } from "vitest";
import { buildStudioRolePromptEnvelope } from "./rolePromptGuidance";

describe("rolePromptGuidance", () => {
  it("builds a creativity-focused PM prompt envelope", () => {
    const prompt = buildStudioRolePromptEnvelope({
      roleId: "pm_creative_director",
      taskId: "PM-IDEA-001",
      request: "신작 로그라이크의 코어 차별점을 제안해줘.",
    });

    expect(prompt).toContain("기획(PM) · 창의 확장");
    expect(prompt).toContain("새로운 조합");
    expect(prompt).toContain("안전안");
    expect(prompt).toContain("혼합안");
    expect(prompt).toContain("## 창의적 코어 제안");
    expect(prompt).toContain("## 빠른 검증 실험");
  });

  it("builds a scoring-focused PM critic prompt envelope", () => {
    const prompt = buildStudioRolePromptEnvelope({
      roleId: "pm_feasibility_critic",
      taskId: "PM-CRITIC-001",
      request: "제안된 전투 시스템의 현실성을 평가해줘.",
    });

    expect(prompt).toContain("기획(PM) · 현실성 비평");
    expect(prompt).toContain("항목별 점수(0-10)");
    expect(prompt).toContain("## 현실성 평가표");
    expect(prompt).toContain("## 치명 리스크");
  });

  it("adds a structured keep/revise/drop review contract for reviewer roles", () => {
    const prompt = buildStudioRolePromptEnvelope({
      roleId: "qa_engineer",
      taskId: "QA-REVIEW-001",
      request: "세 후보안의 핵심 리스크를 평가해줘.",
    });

    expect(prompt).toContain("창의성을 곧바로 허황됨으로 치부하지 말고");
    expect(prompt).toContain("`keep`, `revise`, `drop`");
    expect(prompt).toContain("장점 2개, 치명 단점 2개");
  });
});
