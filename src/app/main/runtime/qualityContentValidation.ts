import { tp } from "../../../i18n";
import type { EvidenceConflict, EvidenceEnvelope } from "../types";

function hasCriticalEvidenceIssue(issue: string): boolean {
  const normalized = String(issue ?? "").trim();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes(tp("핵심 주장 파싱 실패")) ||
    normalized.includes(tp("출처/인용 누락")) ||
    normalized.includes(tp("추가 검증 필요"))
  );
}

function countMeaningfulClaims(claims: EvidenceEnvelope["claims"]): number {
  return claims.filter((claim) => {
    const text = String(claim.text ?? "").trim();
    return text.length >= 10;
  }).length;
}

type AddCheckInput = {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  passed: boolean;
  penalty: number;
  detail?: string;
};

export function applyContentQualityChecks(params: {
  profile: "code_implementation" | "research_evidence" | "design_planning" | "synthesis_final" | "generic";
  fullText: string;
  evidenceEnvelope: EvidenceEnvelope;
  evidenceConflicts: EvidenceConflict[];
  addCheck: (input: AddCheckInput) => void;
  warnings: string[];
}): void {
  const { profile, fullText, evidenceEnvelope, evidenceConflicts, addCheck, warnings } = params;
  const meaningfulClaimCount = countMeaningfulClaims(evidenceEnvelope.claims);
  const hasEvidenceSupport = evidenceEnvelope.citations.length > 0 || meaningfulClaimCount >= 2;
  const criticalIssueCount = evidenceEnvelope.dataIssues.filter(hasCriticalEvidenceIssue).length;

  if (profile === "research_evidence") {
    addCheck({
      id: "content_claims",
      label: tp("핵심 주장 추출 가능"),
      kind: "content",
      required: true,
      passed: meaningfulClaimCount >= 2,
      penalty: 24,
      detail: tp("근거로 검토할 주장 2개 이상 필요"),
    });
    addCheck({
      id: "content_citations",
      label: tp("실제 출처 연결"),
      kind: "content",
      required: true,
      passed: evidenceEnvelope.citations.length > 0,
      penalty: 22,
      detail: tp("URL 또는 명시적 인용이 필요"),
    });
    addCheck({
      id: "content_verification",
      label: tp("근거 검증 상태 확보"),
      kind: "content",
      required: true,
      passed: evidenceEnvelope.verificationStatus !== "unparsed",
      penalty: 18,
      detail: tp("주장 파싱 또는 구조화 근거가 필요"),
    });
    addCheck({
      id: "content_issues",
      label: tp("중대한 데이터 이슈 없음"),
      kind: "content",
      required: true,
      passed: criticalIssueCount === 0,
      penalty: 24,
      detail: evidenceEnvelope.dataIssues.join(" | ") || tp("데이터 이슈 없음"),
    });
    addCheck({
      id: "content_conflicts",
      label: tp("상충 주장 없음"),
      kind: "content",
      required: true,
      passed: evidenceConflicts.length === 0,
      penalty: 30,
      detail:
        evidenceConflicts.length > 0
          ? evidenceConflicts.map((conflict) => conflict.metricKey).join(", ")
          : tp("상충 없음"),
    });
  } else if (profile === "design_planning") {
    addCheck({
      id: "design_evidence_support",
      label: tp("기획 근거 또는 조사 흔적 포함"),
      kind: "content",
      required: false,
      passed: hasEvidenceSupport || /(근거|자료|조사|reference|evidence|source)/i.test(fullText),
      penalty: 12,
      detail: tp("조사 근거나 참조 맥락이 있으면 더 신뢰할 수 있음"),
    });
    addCheck({
      id: "design_issue_pressure",
      label: tp("기획 데이터 이슈 과다 없음"),
      kind: "content",
      required: false,
      passed: criticalIssueCount <= 1,
      penalty: 10,
      detail: evidenceEnvelope.dataIssues.join(" | ") || tp("데이터 이슈 없음"),
    });
  } else if (profile === "synthesis_final") {
    addCheck({
      id: "final_claims",
      label: tp("최종 결론의 핵심 주장 추출 가능"),
      kind: "content",
      required: true,
      passed: meaningfulClaimCount >= 2,
      penalty: 20,
      detail: tp("최종 결론에서 검증 가능한 주장 2개 이상 필요"),
    });
    addCheck({
      id: "final_citations",
      label: tp("최종 결론의 출처 연결"),
      kind: "content",
      required: true,
      passed: evidenceEnvelope.citations.length > 0,
      penalty: 18,
      detail: tp("최종 문서는 핵심 판단의 출처를 포함해야 함"),
    });
    addCheck({
      id: "final_data_issues",
      label: tp("최종 결론의 데이터 이슈 관리"),
      kind: "content",
      required: true,
      passed: criticalIssueCount === 0,
      penalty: 20,
      detail: evidenceEnvelope.dataIssues.join(" | ") || tp("데이터 이슈 없음"),
    });
    addCheck({
      id: "final_conflicts",
      label: tp("최종 결론의 상충 주장 정리"),
      kind: "content",
      required: true,
      passed: evidenceConflicts.length === 0,
      penalty: 24,
      detail:
        evidenceConflicts.length > 0
          ? evidenceConflicts.map((conflict) => conflict.metricKey).join(", ")
          : tp("상충 없음"),
    });
  }

  if (evidenceEnvelope.dataIssues.length > 0) {
    warnings.push(...evidenceEnvelope.dataIssues.map((issue) => `[근거] ${issue}`));
  }
  if (evidenceConflicts.length > 0) {
    warnings.push(
      ...evidenceConflicts.map((conflict) => `[근거 충돌] ${conflict.metricKey}: ${conflict.note}`),
    );
  }
}
