import type { StudioRoleId } from "./handoffTypes";

export type StudioRoleTemplate = {
  id: StudioRoleId;
  label: string;
  goal: string;
  defaultTaskId: string;
};

export const STUDIO_ROLE_TEMPLATES: StudioRoleTemplate[] = [
  { id: "pm_planner", label: "기획(PM)", goal: "요구사항·우선순위·범위 정의", defaultTaskId: "PLAN-001" },
  {
    id: "pm_creative_director",
    label: "기획(PM) · 창의 확장",
    goal: "틀에 박히지 않은 차별화 아이디어와 신선한 기획 가설 도출",
    defaultTaskId: "PM-IDEA-001",
  },
  {
    id: "pm_feasibility_critic",
    label: "기획(PM) · 현실성 비평",
    goal: "기획안을 냉철하게 비평하고 현실성·비용·리스크를 점수화해 평가",
    defaultTaskId: "PM-CRITIC-001",
  },
  { id: "client_programmer", label: "클라이언트", goal: "게임플레이/UX 구현", defaultTaskId: "CLIENT-001" },
  { id: "system_programmer", label: "시스템", goal: "아키텍처/데이터 흐름 안정화", defaultTaskId: "SYSTEM-001" },
  { id: "tooling_engineer", label: "툴링", goal: "개발 자동화/에디터 유틸 구축", defaultTaskId: "TOOL-001" },
  { id: "art_pipeline", label: "아트 파이프라인", goal: "리소스 임포트/최적화 파이프", defaultTaskId: "ART-001" },
  { id: "qa_engineer", label: "QA", goal: "테스트/회귀/버그 재현", defaultTaskId: "QA-001" },
  { id: "build_release", label: "빌드·릴리즈", goal: "배포/버전/릴리즈 체크", defaultTaskId: "RELEASE-001" },
  { id: "technical_writer", label: "문서화", goal: "핸드오프/운영/릴리즈 문서 정리", defaultTaskId: "DOC-001" },
];
