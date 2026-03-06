import type { StudioRoleId } from "./handoffTypes";

export const STUDIO_ROLE_PROMPTS: Record<StudioRoleId, string> = {
  pm_planner: "요구사항을 태스크 단위로 분해하고 우선순위를 확정해 인수인계 가능한 계획으로 정리해줘.",
  client_programmer: "게임플레이/UX 구현 관점에서 즉시 실행 가능한 코드 변경안과 테스트 기준을 제시해줘.",
  system_programmer: "시스템 구조/데이터 흐름/성능 병목 관점에서 안정화 계획을 제시해줘.",
  tooling_engineer: "개발 자동화/툴링 스크립트 중심으로 반복 작업을 줄이는 실행안을 제시해줘.",
  art_pipeline: "리소스 임포트/빌드 최적화/파이프라인 자동화 관점의 실행안을 제시해줘.",
  qa_engineer: "재현 가능한 테스트 시나리오와 회귀 방지 체크리스트를 우선으로 작성해줘.",
  build_release: "빌드/릴리즈 검증 항목과 배포 전 점검 체크를 실행 순서로 제시해줘.",
  technical_writer: "핵심 결정사항과 변경사항을 다음 담당자가 바로 실행할 수 있게 문서화해줘.",
};

export function toStudioRoleId(value: string): StudioRoleId | null {
  const normalized = String(value ?? "").trim();
  if (
    normalized === "pm_planner" ||
    normalized === "client_programmer" ||
    normalized === "system_programmer" ||
    normalized === "tooling_engineer" ||
    normalized === "art_pipeline" ||
    normalized === "qa_engineer" ||
    normalized === "build_release" ||
    normalized === "technical_writer"
  ) {
    return normalized;
  }
  return null;
}
