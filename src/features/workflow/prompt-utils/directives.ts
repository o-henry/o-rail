import type { AppLocale } from "../../../i18n";

export function buildForcedAgentRuleBlock(docs: Array<{ path: string; content: string }>): string {
  if (docs.length === 0) {
    return "";
  }

  const parts = docs.map((doc, index) => {
    const content = doc.content.trim();
    return `## 규칙 문서 ${index + 1}: ${doc.path}\n${content}`;
  });

  return [
    "[SYSTEM 강제 규칙]",
    "아래 AGENT/SKILL 규칙은 선택사항이 아니며 반드시 준수해야 합니다.",
    "규칙 충돌 시 문서에 명시된 우선순위를 따르고, 없으면 더 구체적인 규칙을 우선합니다.",
    "",
    ...parts,
    "[/SYSTEM 강제 규칙]",
  ].join("\n");
}

export function buildCodexMultiAgentDirective(mode: "off" | "balanced" | "max"): string {
  if (mode === "off") {
    return "";
  }

  const qualityRules =
    mode === "max"
      ? [
          "- 최소 3개 이상의 하위 에이전트를 병렬 사용해 서로 다른 관점(근거, 반례, 실행계획)으로 검토하라.",
          "- 불확실하거나 충돌하는 항목은 누락하지 말고 명시적으로 분리 보고하라.",
          "- 최종 답변 전 자기검증 단계(누락/모순/근거 부족)를 수행하라.",
          "- 누락된 하위 에이전트 결과가 하나라도 있으면 최종 통합 답변을 완료로 선언하지 마라.",
        ]
      : [
          "- 작업을 2~3개 하위 에이전트 단위로 분해하고 병렬 처리하라.",
          "- 중간 로그 대신 핵심 요약만 수집해 컨텍스트 오염을 줄여라.",
          "- 결과 통합 전 근거 일관성을 점검하라.",
        ];

  return [
    "[CODEx MULTI-AGENT ORCHESTRATION]",
    "복잡한 작업은 반드시 하위 에이전트(sub-agent) 병렬 실행으로 처리하라.",
    "각 하위 에이전트는 역할을 분리하고, 산출물은 짧은 구조화 요약으로 제출하라.",
    "모든 하위 에이전트 결과를 확인한 뒤 최종 통합 답변을 작성하라.",
    "참을성을 가지고 먼저 실행한 하위 에이전트의 완료/실패 로그를 확인한 뒤 다음 행동을 결정하라.",
    "다음 행동은 감이 아니라 로그, 산출물, 완료 상태를 기준으로 결정하라.",
    "예상한 하위 에이전트 결과나 산출물이 아직 없으면 비어 있는 부분을 임의로 채워 통합 답변을 만들지 마라.",
    "하위 에이전트 실행 계획/중간 진행상황/병렬 처리 설명은 최종 사용자 답변에 노출하지 마라.",
    ...qualityRules,
    "[/CODEx MULTI-AGENT ORCHESTRATION]",
  ].join("\n");
}

export function buildFinalVisualizationDirective(): string {
  return [
    "[시각화 출력 지침]",
    "- 최종 문서 이해를 돕는 차트/도표가 필요할 때만 포함하세요.",
    "- 시각 자료가 더 적합하면 관련 이미지도 포함하세요(신뢰 가능한 출처 URL만).",
    '- 이미지는 Markdown 형식 `![설명](https://...)`으로 작성하세요.',
    "- 차트는 아래 포맷의 fenced code block으로 작성하세요.",
    "- 언어 태그는 반드시 rail-chart 를 사용하세요.",
    "```rail-chart",
    "{",
    '  "type": "bar|line|pie",',
    '  "title": "차트 제목",',
    '  "labels": ["항목1", "항목2"],',
    '  "series": [',
    '    { "name": "시리즈명", "data": [10, 20], "color": "#4A7BFF" }',
    "  ]",
    "}",
    "```",
    "- 본문은 일반 Markdown 형식으로 작성하세요.",
  ].join("\n");
}

export function buildReadableDocumentDirective(locale: AppLocale): string {
  if (locale === "ko") {
    return [
      "[문서 가독성 포맷 지침]",
      "- 최종 결과는 사람이 읽기 쉬운 Markdown 문서 형식으로 작성하세요.",
      "- 첫 줄에 한 문단 요약을 두고, 이후 `##` 제목으로 섹션을 구분하세요.",
      "- `## 결론 요약`, `## 핵심 근거`, `## 신뢰도와 한계`, `## 다음 체크포인트` 섹션을 반드시 포함하세요.",
      "- 섹션 내 항목은 문장 나열 대신 bullet(`-`) 또는 번호 목록(`1.`)을 사용하세요.",
      "- 한 문단은 2~4문장 이내로 유지하고, 지나치게 긴 한 줄 텍스트를 금지하세요.",
      "- key:value를 한 줄에 연속 나열하지 말고 줄바꿈해 항목별로 분리하세요.",
      "[/문서 가독성 포맷 지침]",
    ].join("\n");
  }

  if (locale === "en") {
    return [
      "[Readability Formatting Directive]",
      "- Write the final output as human-readable Markdown.",
      "- Start with a short summary paragraph, then split content with `##` section headings.",
      "- Use bullets (`-`) or numbered lists (`1.`) for enumerations instead of dense prose.",
      "- Keep paragraphs short (2-4 sentences) and avoid very long single-line blocks.",
      "- Do not chain multiple key:value pairs on one line; separate each item with line breaks.",
      "[/Readability Formatting Directive]",
    ].join("\n");
  }

  if (locale === "jp") {
    return [
      "[可読性フォーマット指示]",
      "- 最終出力は人間が読みやすい Markdown 形式で作成してください。",
      "- 冒頭に短い要約段落を置き、その後は `##` 見出しでセクション分割してください。",
      "- 列挙は密な文章ではなく bullet(`-`) または番号付きリスト(`1.`)を使ってください。",
      "- 段落は 2〜4 文程度に抑え、極端に長い 1 行テキストを避けてください。",
      "- key:value を 1 行に連続で並べず、改行で項目ごとに分離してください。",
      "[/可読性フォーマット指示]",
    ].join("\n");
  }

  return [
    "[可读性格式指令]",
    "- 最终输出必须采用面向人类阅读的 Markdown 文档格式。",
    "- 先给简短摘要段落，然后使用 `##` 标题分节。",
    "- 枚举内容使用 bullet(`-`) 或编号列表(`1.`)，避免密集大段文字。",
    "- 每段控制在 2-4 句，避免超长单行文本。",
    "- 不要在一行连续堆叠多个 key:value，需按条目换行拆分。",
    "[/可读性格式指令]",
  ].join("\n");
}

export function buildExpertOrchestrationDirective(
  locale: AppLocale,
  profile: "code_implementation" | "research_evidence" | "design_planning" | "synthesis_final" | "generic",
): string {
  const coreKo = [
    "[전문가 오케스트레이션 계약]",
    "- 문제를 먼저 재정의하라: 목표/범위/성공기준을 3줄 이내로 명시.",
    "- 작업은 단계로 분해하라: 단계별 입력, 처리, 기대 산출물을 분리.",
    "- 금지형 제약만 나열하지 말고, 원하는 결과를 긍정 지시로 명확히 적어라.",
    "- 출력 전 자기검증: 누락/모순/근거 부족 항목을 점검하고 보정.",
    "- 내부 실행 과정(계획/하위 에이전트 사용/진행 로그)은 최종 답변에 쓰지 말고, 사용자에게는 결과만 제시하라.",
    "[/전문가 오케스트레이션 계약]",
  ];

  const coreEn = [
    "[Expert Orchestration Contract]",
    "- Reframe first: state objective, scope, and success criteria in <=3 lines.",
    "- Decompose into explicit steps with input/process/expected output per step.",
    "- Prefer positive instructions over long lists of prohibitions.",
    "- Before output, run a self-check for gaps, contradictions, and weak evidence.",
    "- Keep orchestration internal: do not output planning logs/sub-agent process; show only final results.",
    "[/Expert Orchestration Contract]",
  ];

  const coreJp = [
    "[専門家オーケストレーション契約]",
    "- まず再定義: 目的/範囲/成功基準を3行以内で明記。",
    "- 作業を段階分解し、各段階の入力/処理/期待成果を分離。",
    "- 禁止事項の羅列より、望ましい結果を肯定的指示で明確化。",
    "- 出力前に自己検証し、欠落/矛盾/根拠不足を補正。",
    "- 内部の実行過程（計画/サブエージェント/進行ログ）は出力せず、最終結果のみ提示する。",
    "[/専門家オーケストレーション契約]",
  ];

  const coreZh = [
    "[专家编排契约]",
    "- 先重述问题：用不超过3行写清目标/范围/成功标准。",
    "- 分解为明确步骤：每步给出输入/处理/期望产出。",
    "- 优先使用正向指令，避免只堆叠禁止项。",
    "- 输出前做自检：补齐缺漏、冲突和薄弱证据。",
    "- 编排过程保持内部化：不要输出计划日志/子代理执行过程，只呈现最终结果。",
    "[/专家编排契约]",
  ];

  const profileKo: Record<typeof profile, string[]> = {
    code_implementation: [
      "- 구현 전 파일/모듈 단위 계획을 제시하고, 검증 명령(lint/test/build)을 명시.",
    ],
    research_evidence: [
      "- 사실/추론을 분리하고, 핵심 주장마다 출처·날짜·신뢰도(High/Med/Low)를 붙여라.",
    ],
    design_planning: [
      "- 설계안에는 목표, 제약, 리스크, 우선순위, 단계별 마일스톤을 포함하라.",
    ],
    synthesis_final: [
      "- 최종안은 결론/근거/리스크·한계/다음 행동 순서로 구조화하라.",
      "- 사용자 질문에 직접 답하고, 하위 에이전트 평가/점수표/판정 보고는 출력하지 마라.",
      "- 신뢰도/한계/재검증 포인트를 별도 섹션으로 명시하라.",
    ],
    generic: [],
  };

  const profileEn: Record<typeof profile, string[]> = {
    code_implementation: [
      "- Before coding, provide a file/module plan and explicit validation commands (lint/test/build).",
    ],
    research_evidence: [
      "- Separate facts vs inferences and attach source/date/confidence (High/Med/Low) to key claims.",
    ],
    design_planning: [
      "- Include objective, constraints, risks, priorities, and milestone sequence in the plan.",
    ],
    synthesis_final: [
      "- Structure final output as conclusion, evidence, risks/limits, and next actions.",
      "- Answer the user question directly; do not output evaluator scorecards or judging reports.",
      "- Add an explicit section for confidence, limitations, and re-verification triggers.",
    ],
    generic: [],
  };

  if (locale === "ko") {
    return [...coreKo, ...profileKo[profile]].join("\n");
  }
  if (locale === "en") {
    return [...coreEn, ...profileEn[profile]].join("\n");
  }
  if (locale === "jp") {
    return [...coreJp, ...profileEn[profile]].join("\n");
  }
  return [...coreZh, ...profileEn[profile]].join("\n");
}

export function buildOutputSchemaDirective(schemaRaw: string): string {
  const trimmed = String(schemaRaw ?? "").trim();
  if (!trimmed) {
    return "";
  }
  let prettySchema = trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    prettySchema = JSON.stringify(parsed, null, 2);
  } catch {
    return "";
  }

  return [
    "[OUTPUT SCHEMA CONTRACT]",
    "아래 JSON 스키마를 반드시 만족하는 결과만 출력하세요.",
    "설명문/서론/결론 없이 스키마에 맞는 결과만 출력하세요.",
    "```json",
    prettySchema,
    "```",
    "[/OUTPUT SCHEMA CONTRACT]",
  ].join("\n");
}

const OUTPUT_LANGUAGE_BLOCK_START = "[RAIL OUTPUT LANGUAGE]";
const OUTPUT_LANGUAGE_BLOCK_END = "[/RAIL OUTPUT LANGUAGE]";

function stripOutputLanguageDirective(input: string): string {
  return String(input ?? "")
    .replace(/\[RAIL OUTPUT LANGUAGE\][\s\S]*?\[\/RAIL OUTPUT LANGUAGE\]\s*/g, "")
    .trimStart();
}

export function buildOutputLanguageDirective(locale: AppLocale): string {
  if (locale === "ko") {
    return [
      OUTPUT_LANGUAGE_BLOCK_START,
      "- 최종 답변은 반드시 한국어로 작성하라.",
      "- 영어 고유명사/라이브러리명/코드 식별자는 원문 표기를 유지할 수 있다.",
      "- 설명/요약/목록/표 캡션까지 모두 한국어를 우선 사용하라.",
      OUTPUT_LANGUAGE_BLOCK_END,
    ].join("\n");
  }

  if (locale === "en") {
    return [
      OUTPUT_LANGUAGE_BLOCK_START,
      "- Write the final answer strictly in English.",
      "- Keep proper nouns, library names, and code identifiers in their original form.",
      "- Use English consistently for headings, bullets, summaries, and table/chart captions.",
      OUTPUT_LANGUAGE_BLOCK_END,
    ].join("\n");
  }

  if (locale === "jp") {
    return [
      OUTPUT_LANGUAGE_BLOCK_START,
      "- 最終回答は必ず日本語で作成してください。",
      "- 固有名詞、ライブラリ名、コード識別子は原文表記を維持して構いません。",
      "- 見出し、箇条書き、要約、表・チャートの説明も日本語を優先してください。",
      OUTPUT_LANGUAGE_BLOCK_END,
    ].join("\n");
  }

  return [
    OUTPUT_LANGUAGE_BLOCK_START,
    "- 最终回答必须使用中文。",
    "- 专有名词、库名称、代码标识符可保留原文。",
    "- 标题、列表、摘要、表格/图表说明等内容请统一使用中文。",
    OUTPUT_LANGUAGE_BLOCK_END,
  ].join("\n");
}

export function injectOutputLanguageDirective(template: string, locale: AppLocale): string {
  const body = stripOutputLanguageDirective(template);
  const directive = buildOutputLanguageDirective(locale);
  if (!directive) {
    return body;
  }
  return `${directive}\n\n${body}`.trim();
}
