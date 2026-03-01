import { Fragment, type ReactNode } from "react";

const THREAD_NAME_KO_LABELS: Record<string, string> = {
  "crawler-agent": "크롤러 에이전트",
  "rag-analyst": "RAG 분석 에이전트",
  "snapshot-synthesizer": "스냅샷 합성 에이전트",
  "signal-scout": "시그널 스카우트",
  "risk-analyst": "리스크 분석 에이전트",
  "briefing-lead": "브리핑 리드",
  "content-planner": "콘텐츠 기획 에이전트",
  "content-writer": "콘텐츠 작성 에이전트",
  "quality-reviewer": "품질 검수 에이전트",
  "spec-architect": "명세 설계 에이전트",
  "implementation-agent": "구현 에이전트",
  "verification-agent": "검증 에이전트",
  "planner-agent": "계획 에이전트",
  "executor-agent": "실행 에이전트",
};

export function toKoreanThreadName(name: string): string {
  const normalized = String(name ?? "").trim();
  if (!normalized) {
    return "에이전트";
  }
  const mapped = THREAD_NAME_KO_LABELS[normalized];
  if (mapped) {
    return mapped;
  }
  const customMatch = /^agent-(\d+)$/i.exec(normalized);
  if (customMatch) {
    return `에이전트-${customMatch[1]}`;
  }
  return normalized;
}

export function detectTextLang(value: string): "en" | "ko" {
  return /[A-Za-z]/.test(String(value ?? "")) ? "en" : "ko";
}

export function renderMixedLangText(value: string): ReactNode {
  const text = String(value ?? "");
  const parts = text.split(/([A-Za-z][A-Za-z0-9/._-]*)/g).filter((part) => part.length > 0);
  return parts.map((part, index) =>
    /[A-Za-z]/.test(part) ? (
      <span key={`${part}-${index}`} lang="en">
        {part}
      </span>
    ) : (
      <Fragment key={`${part}-${index}`}>{part}</Fragment>
    ),
  );
}
