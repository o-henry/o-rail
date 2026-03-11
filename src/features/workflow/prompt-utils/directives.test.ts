import { describe, expect, it } from "vitest";
import { buildCodexMultiAgentDirective } from "./directives";

describe("buildCodexMultiAgentDirective", () => {
  it("returns an empty string when multi-agent mode is off", () => {
    expect(buildCodexMultiAgentDirective("off")).toBe("");
  });

  it("adds patience and log-driven completion rules in balanced mode", () => {
    const directive = buildCodexMultiAgentDirective("balanced");
    expect(directive).toContain("참을성을 가지고 먼저 실행한 하위 에이전트의 완료/실패 로그를 확인한 뒤 다음 행동을 결정하라.");
    expect(directive).toContain("다음 행동은 감이 아니라 로그, 산출물, 완료 상태를 기준으로 결정하라.");
    expect(directive).toContain("예상한 하위 에이전트 결과나 산출물이 아직 없으면 비어 있는 부분을 임의로 채워 통합 답변을 만들지 마라.");
  });

  it("keeps the stronger completion guard in max mode", () => {
    const directive = buildCodexMultiAgentDirective("max");
    expect(directive).toContain("누락된 하위 에이전트 결과가 하나라도 있으면 최종 통합 답변을 완료로 선언하지 마라.");
  });
});
