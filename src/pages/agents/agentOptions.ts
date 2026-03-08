import type { AgentModelOption, AgentSetOption } from "./agentTypes";
import { RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";

export const BASE_AGENT_SET_OPTIONS: AgentSetOption[] = [
  {
    id: "market-research",
    label: "시장 조사 세트",
    description: "트렌드 탐색, 경쟁사 분석, 주간 브리핑 에이전트 묶음",
  },
  {
    id: "content-ops",
    label: "콘텐츠 운영 세트",
    description: "콘텐츠 생성, 교정, 배포 체크 에이전트 묶음",
  },
  {
    id: "dev-delivery",
    label: "개발 전달 세트",
    description: "요구사항 정리, 구현, 검증 에이전트 묶음",
  },
];

export const AGENT_MODEL_OPTIONS: AgentModelOption[] = [...RUNTIME_MODEL_OPTIONS];

export const AGENT_REASON_LEVEL_OPTIONS = ["낮음", "중간", "높음", "매우 높음"];
