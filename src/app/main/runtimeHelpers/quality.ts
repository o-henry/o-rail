import { invoke } from "../../../shared/tauri";
import { inferQualityProfile, type ArtifactType, type TurnConfig } from "../../../features/workflow/domain";
import { extractFinalAnswer, turnRoleLabel } from "../../../features/workflow/labels";
import { getByPath, stringifyInput, tryParseJsonText } from "../../../features/workflow/promptUtils";
import { QUALITY_DEFAULT_THRESHOLD, normalizeQualityScore, normalizeQualityThreshold } from "../../../features/workflow/quality";
import type { GraphNode, KnowledgeConfig } from "../../../features/workflow/types";
import { tp } from "../../../i18n";
import { KNOWLEDGE_DEFAULT_MAX_CHARS, KNOWLEDGE_DEFAULT_TOP_K } from "../../mainAppGraphHelpers";
import { applyContentQualityChecks } from "../runtime/qualityContentValidation";
import { buildConflictLedger, normalizeEvidenceEnvelope } from "./evidence";

const DOCUMENT_TRUNCATION_MARKER_RE = /(?:\.\.\.|…|\(truncated\)|중략|생략|omitted|truncated)/i;
const DOCUMENT_GROUNDING_SIGNAL_RE =
  /(출처|근거|source|evidence|citation|reference|confidence|신뢰도|추가 근거 필요|검증 필요|needs more evidence|unsupported)/i;

export function parseQualityCommands(input: unknown): string[] {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeArtifactOutput(
  nodeId: string,
  artifactType: ArtifactType,
  rawOutput: unknown,
): { output: unknown; warnings: string[] } {
  if (artifactType === "none") {
    return { output: rawOutput, warnings: [] };
  }

  let payload: unknown = rawOutput;
  const textCandidate = extractFinalAnswer(rawOutput).trim();
  if (typeof rawOutput === "string") {
    const text = rawOutput.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { text };
      }
    } else {
      payload = { text };
    }
  } else if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
    const inheritedPayload = getByPath(rawOutput, "artifact.payload");
    if (inheritedPayload !== undefined) {
      payload = inheritedPayload;
    }
    const parsedFromText = textCandidate ? tryParseJsonText(textCandidate) : null;
    if (parsedFromText != null) {
      payload = parsedFromText;
    } else if (payload === rawOutput && textCandidate) {
      payload = { text: textCandidate };
    }
  }

  const warnings: string[] = [];
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload === rawOutput &&
    ("completion" in (payload as Record<string, unknown>) ||
      "threadId" in (payload as Record<string, unknown>) ||
      "turnId" in (payload as Record<string, unknown>))
  ) {
    payload = textCandidate ? { text: textCandidate } : { text: "" };
    warnings.push(tp("아티팩트 변환: 실행 메타데이터 wrapper를 본문에서 제외했습니다."));
  }
  if (payload == null || typeof payload !== "object") {
    payload = { text: textCandidate || stringifyInput(rawOutput) };
    warnings.push(tp("아티팩트 변환: 구조화된 출력이 없어 텍스트 기반으로 보정했습니다."));
  }

  return {
    output: {
      artifact: {
        artifactType,
        version: "v1",
        authorNodeId: nodeId,
        createdAt: new Date().toISOString(),
        payload,
      },
      text: textCandidate || (typeof rawOutput === "string" ? rawOutput : ""),
      raw: rawOutput,
    },
    warnings,
  };
}

export async function buildQualityReport(params: {
  node: GraphNode;
  config: TurnConfig;
  output: unknown;
  cwd: string;
}): Promise<any> {
  const { node, config, output, cwd } = params;
  const profile = inferQualityProfile(node, config);
  const threshold = normalizeQualityThreshold(config.qualityThreshold ?? QUALITY_DEFAULT_THRESHOLD);
  const checks: any[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  const fullText = extractFinalAnswer(output) || (typeof output === "string" ? output : "");
  const artifactType = String(config.artifactType ?? "none").trim();
  const documentLike = profile === "synthesis_final" || (artifactType && artifactType !== "none");
  const evidenceEnvelope = normalizeEvidenceEnvelope({
    nodeId: node.id,
    roleLabel: turnRoleLabel(node),
    output,
  });
  const evidenceConflicts = buildConflictLedger([evidenceEnvelope]);

  const addCheck = (input: {
    id: string;
    label: string;
    kind: string;
    required: boolean;
    passed: boolean;
    penalty: number;
    detail?: string;
  }) => {
    if (!input.passed) {
      score = Math.max(0, score - input.penalty);
      if (input.required) {
        failures.push(input.label);
      }
    }
    checks.push({
      id: input.id,
      label: input.label,
      kind: input.kind,
      required: input.required,
      passed: input.passed,
      scoreDelta: input.passed ? 0 : -input.penalty,
      detail: input.detail,
    });
  };

  addCheck({ id: "non_empty", label: tp("응답 비어있지 않음"), kind: "structure", required: true, passed: fullText.trim().length > 0, penalty: 40 });
  addCheck({
    id: "minimum_length",
    label: tp("최소 설명 길이"),
    kind: "structure",
    required: false,
    passed: fullText.trim().length >= 120,
    penalty: 10,
    detail: tp("120자 미만이면 요약 부족으로 감점"),
  });
  if (documentLike) {
    addCheck({
      id: "no_truncation_markers",
      label: tp("문서 중략/생략 금지"),
      kind: "consistency",
      required: true,
      passed: !DOCUMENT_TRUNCATION_MARKER_RE.test(fullText),
      penalty: 18,
      detail: tp("문서 본문에 ..., 중략, 생략, truncated 같은 표기를 남기면 안 됩니다."),
    });
  }

  if (profile === "research_evidence") {
    addCheck({ id: "source_signal", label: tp("근거/출처 신호 포함"), kind: "evidence", required: true, passed: /(source|출처|근거|http|https|reference)/i.test(fullText), penalty: 20 });
    addCheck({
      id: "freshness_signal",
      label: tp("시점/날짜 정보 포함"),
      kind: "evidence",
      required: false,
      passed: /(20\d{2}[-./]\d{1,2}[-./]\d{1,2}|as of|updated|date|날짜|기준|timestamp|時点|日期)/i.test(fullText),
      penalty: 8,
      detail: tp("핵심 근거의 시점 정보 포함 권장"),
    });
    addCheck({ id: "uncertainty_signal", label: tp("한계/불확실성 표기"), kind: "consistency", required: false, passed: /(한계|불확실|리스크|위험|counter|반례|제약)/i.test(fullText), penalty: 10 });
  } else if (profile === "design_planning") {
    const hits = [/(목표|objective|goal|目的|目标)/i, /(제약|constraint|boundary|制約|约束)/i, /(리스크|위험|risk|リスク|风险)/i, /(우선순위|priority|優先順位)/i, /(아키텍처|architecture|設計)/i, /(마일스톤|milestone|roadmap|ロードマップ|里程碑)/i].filter((pattern) => pattern.test(fullText)).length;
    addCheck({ id: "design_sections", label: tp("설계 핵심 항목 포함"), kind: "structure", required: true, passed: hits >= 3, penalty: 20, detail: tp("목표/제약/리스크/우선순위 등 3개 이상 필요") });
  } else if (profile === "synthesis_final") {
    const hits = [/(결론|요약|conclusion|summary|結論|要約|结论|摘要)/i, /(근거|출처|evidence|source|根拠|依据)/i, /(한계|리스크|불확실|risk|limit|limitation|制約|风险)/i, /(다음 단계|체크포인트|next step|next action|action items|次のステップ|下一步)/i].filter((pattern) => pattern.test(fullText)).length;
    addCheck({ id: "final_structure", label: tp("최종 답변 구조 충족"), kind: "structure", required: true, passed: hits >= 3, penalty: 20, detail: tp("결론/근거/한계/다음 단계 중 3개 이상") });
    const headingCount = (fullText.match(/^##\s+/gm) ?? []).length;
    const listCount = (fullText.match(/^(?:- |\d+\.\s+)/gm) ?? []).length;
    addCheck({ id: "readability_layout", label: tp("가독성 문서 레이아웃"), kind: "structure", required: false, passed: headingCount >= 2 || listCount >= 4, penalty: 8, detail: tp("제목(##) 2개 이상 또는 목록 4개 이상 권장") });
    addCheck({ id: "trust_signal", label: tp("신뢰도/근거 표기"), kind: "evidence", required: true, passed: /(출처|근거|source|evidence|confidence|신뢰도|as of|기준|timestamp|date)/i.test(fullText), penalty: 15, detail: tp("핵심 판단에 근거와 신뢰도 표기 필요") });
    addCheck({ id: "limit_signal", label: tp("한계/불확실성 명시"), kind: "consistency", required: false, passed: /(한계|불확실|가정|제약|limit|uncertainty|assumption|constraint|制約|风险)/i.test(fullText), penalty: 8 });
    addCheck({
      id: "grounding_gate",
      label: tp("최종 주장 grounding 또는 보류 표기"),
      kind: "evidence",
      required: true,
      passed: DOCUMENT_GROUNDING_SIGNAL_RE.test(fullText),
      penalty: 20,
      detail: tp("핵심 판단에는 근거/신뢰도 또는 추가 근거 필요 표기가 있어야 합니다."),
    });
  } else if (profile === "code_implementation") {
    addCheck({ id: "code_plan_signal", label: tp("코드/파일/테스트 계획 포함"), kind: "structure", required: true, passed: /(file|파일|test|테스트|lint|build|patch|module|class|function)/i.test(fullText), penalty: 20 });
    if (config.qualityCommandEnabled) {
      const commands = parseQualityCommands(config.qualityCommands);
      if (commands.length === 0) {
        warnings.push(tp("품질 명령 실행이 켜져 있지만 명령 목록이 비어 있습니다."));
      } else {
        try {
          const commandResults = await invoke<any[]>("quality_run_checks", { commands, cwd });
          const failed = commandResults.find((row) => row.exitCode !== 0);
          addCheck({
            id: "local_commands",
            label: tp("로컬 품질 명령 통과"),
            kind: "local_command",
            required: true,
            passed: !failed,
            penalty: 30,
            detail: failed ? `${failed.name} ${tp("실패")}(exit=${failed.exitCode})` : tp("모든 명령 성공"),
          });
          for (const row of commandResults) {
            if (row.exitCode !== 0 && row.stderrTail.trim()) {
              warnings.push(`[${row.name}] ${row.stderrTail}`);
            }
          }
        } catch (error) {
          addCheck({ id: "local_commands", label: tp("로컬 품질 명령 통과"), kind: "local_command", required: true, passed: false, penalty: 30, detail: String(error) });
        }
      }
    }
  }

  applyContentQualityChecks({ profile, fullText, evidenceEnvelope, evidenceConflicts, addCheck, warnings });
  const normalizedScore = normalizeQualityScore(score);
  return {
    profile,
    threshold,
    score: normalizedScore,
    decision: normalizedScore >= threshold && failures.length === 0 ? "PASS" : "REJECT",
    checks,
    failures,
    warnings,
  };
}

export function summarizeQualityMetrics(nodeMetrics: Record<string, any>): any {
  const rows = Object.values(nodeMetrics);
  if (rows.length === 0) {
    return { avgScore: 0, passRate: 0, totalNodes: 0, passNodes: 0 };
  }
  const passNodes = rows.filter((row: any) => row.decision === "PASS").length;
  const avgScore = rows.reduce((sum: number, row: any) => sum + row.score, 0) / rows.length;
  const passRate = passNodes / rows.length;
  return {
    avgScore: Math.round(avgScore * 100) / 100,
    passRate: Math.round(passRate * 10000) / 100,
    totalNodes: rows.length,
    passNodes,
  };
}

export function defaultKnowledgeConfig(): KnowledgeConfig {
  return {
    files: [],
    topK: KNOWLEDGE_DEFAULT_TOP_K,
    maxChars: KNOWLEDGE_DEFAULT_MAX_CHARS,
  };
}
