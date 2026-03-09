import type { AppLocale } from "../../../i18n/types";
import type { PresetKind, TurnConfig } from "../domain";
import { getTurnExecutor } from "../domain";
import type { GraphNode } from "../types";

const INPUT_PLACEHOLDER = "{{input}}";

function localizedPresetIntent(kind: PresetKind, locale: AppLocale): string {
  if (locale === "en") {
    if (kind === "validation") return "derive a verifiable conclusion";
    if (kind === "development") return "produce an executable development plan/implementation";
    if (kind === "research") return "perform evidence-driven research and analysis";
    if (kind === "expert") return "support expert-level decision making";
    if (kind === "unityCiDoctor") return "diagnose Unity CI failures and prioritize the next fix";
    if (kind === "unityTestsmith") return "design Unity tests and prioritize the next verification";
    if (kind === "unityBuildWatcher") return "analyze Unity build and size regressions";
    if (kind === "unityLocalizationQa") return "audit Unity localization quality and release risk";
    if (kind === "unityAddressablesDiet") return "analyze Unity Addressables and asset bloat safely";
    if (kind === "unityGame") return "deliver a Unity game development plan";
    if (kind === "fullstack") return "deliver a full-stack product implementation";
    if (kind === "creative") return "convert creative ideas into executable proposals";
    return "support news/trend-based judgment";
  }
  if (locale === "jp") {
    if (kind === "validation") return "検証可能な結論を導く";
    if (kind === "development") return "実装可能な開発計画を作る";
    if (kind === "research") return "根拠中心の調査・分析を行う";
    if (kind === "expert") return "専門家レベルの意思決定を支援する";
    if (kind === "unityCiDoctor") return "Unity CI 障害を診断し次の修正を優先順位付けする";
    if (kind === "unityTestsmith") return "Unityテストを設計し次の検証を優先順位付けする";
    if (kind === "unityBuildWatcher") return "Unityビルド時間/サイズ回帰を分析する";
    if (kind === "unityLocalizationQa") return "Unityローカライズ品質とリリースリスクを監査する";
    if (kind === "unityAddressablesDiet") return "Unity Addressables と資産肥大化を安全に分析する";
    if (kind === "unityGame") return "Unityゲーム開発計画を作成する";
    if (kind === "fullstack") return "フルスタック製品の実装計画を作る";
    if (kind === "creative") return "創造的アイデアを実行可能な提案に変換する";
    return "ニュース/トレンドに基づく判断を支援する";
  }
  if (kind === "validation") return "得出可验证结论";
  if (kind === "development") return "形成可执行的开发计划/实现";
  if (kind === "research") return "进行证据驱动的研究分析";
  if (kind === "expert") return "支持专家级决策";
  if (kind === "unityCiDoctor") return "诊断 Unity CI 故障并确定下一步修复优先级";
  if (kind === "unityTestsmith") return "设计 Unity 测试并确定下一步验证优先级";
  if (kind === "unityBuildWatcher") return "分析 Unity 构建与体积回归";
  if (kind === "unityLocalizationQa") return "审计 Unity 本地化质量与发布风险";
  if (kind === "unityAddressablesDiet") return "安全分析 Unity Addressables 与资产膨胀";
  if (kind === "unityGame") return "制定 Unity 游戏开发方案";
  if (kind === "fullstack") return "制定全栈产品实现方案";
  if (kind === "creative") return "将创意转化为可执行提案";
  return "支持基于新闻/趋势的判断";
}

function buildLocalizedPreprocessPrompt(kind: PresetKind, locale: AppLocale): string {
  const intent = localizedPresetIntent(kind, locale);
  if (locale === "en") {
    return (
      "You are the request preprocessor for this multi-agent workflow.\n" +
      "Goal: convert the user's ambiguous request into an executable brief and enforce must-have elements.\n" +
      "Rules: do not distort intent; state conservative assumptions when needed.\n" +
      "Output strictly one JSON object only. No markdown/code fence/preamble.\n" +
      "{\n" +
      '  "intent": "...",\n' +
      '  "userGoal": "...",\n' +
      `  "templateIntent": "${intent}",\n` +
      '  "requiredOutputs": ["..."],\n' +
      '  "constraints": ["..."],\n' +
      '  "assumptions": ["..."],\n' +
      '  "researchPlan": {\n' +
      '    "webQueries": ["..."],\n' +
      '    "sources": ["news","papers & official docs","community & SNS"],\n' +
      '    "collectionOrder": ["freshness check","collect core evidence","collect counterexamples/risks"],\n' +
      '    "verificationRules": ["cite sources","include timestamps","annotate confidence"]\n' +
      "  },\n" +
      '  "acceptanceCriteria": ["..."],\n' +
      '  "riskChecklist": ["..."],\n' +
      '  "selfValidationPlan": ["accuracy","completeness","feasibility","missing items"]\n' +
      "}\n" +
      `Question: ${INPUT_PLACEHOLDER}`
    );
  }
  if (locale === "jp") {
    return (
      "あなたはこのマルチエージェント実行の要求前処理エージェントです。\n" +
      "目的: 曖昧なユーザー要求を実行可能なブリーフへ整理し、必須要素を強制すること。\n" +
      "原則: 意図を歪めないこと。必要時は保守的な仮定を明示すること。\n" +
      "必ず JSON オブジェクトのみを出力してください。コードフェンス/前置き/補足説明は禁止。\n" +
      "{\n" +
      '  "intent": "...",\n' +
      '  "userGoal": "...",\n' +
      `  "templateIntent": "${intent}",\n` +
      '  "requiredOutputs": ["..."],\n' +
      '  "constraints": ["..."],\n' +
      '  "assumptions": ["..."],\n' +
      '  "researchPlan": {\n' +
      '    "webQueries": ["..."],\n' +
      '    "sources": ["ニュース","論文・公式文書","コミュニティ・SNS"],\n' +
      '    "collectionOrder": ["最新性確認","中核根拠の収集","反証・リスク収集"],\n' +
      '    "verificationRules": ["出典明記","タイムスタンプ確認","信頼度表記"]\n' +
      "  },\n" +
      '  "acceptanceCriteria": ["..."],\n' +
      '  "riskChecklist": ["..."],\n' +
      '  "selfValidationPlan": ["正確性","完全性","実行可能性","抜け漏れ"]\n' +
      "}\n" +
      `質問: ${INPUT_PLACEHOLDER}`
    );
  }
  return (
    "你是该多代理流程的需求预处理代理。\n" +
    "目标: 将用户模糊请求整理为可执行简报，并强制补齐关键要素。\n" +
    "原则: 不得偏离用户意图；必要时明确保守假设。\n" +
    "必须只输出一个 JSON 对象。禁止代码块/前言/补充说明。\n" +
    "{\n" +
    '  "intent": "...",\n' +
    '  "userGoal": "...",\n' +
    `  "templateIntent": "${intent}",\n` +
    '  "requiredOutputs": ["..."],\n' +
    '  "constraints": ["..."],\n' +
    '  "assumptions": ["..."],\n' +
    '  "researchPlan": {\n' +
    '    "webQueries": ["..."],\n' +
    '    "sources": ["新闻","论文与官方文档","社区与SNS"],\n' +
    '    "collectionOrder": ["时效性确认","核心证据收集","反例与风险收集"],\n' +
    '    "verificationRules": ["标注来源","标注时间","标注可信度"]\n' +
    "  },\n" +
    '  "acceptanceCriteria": ["..."],\n' +
    '  "riskChecklist": ["..."],\n' +
    '  "selfValidationPlan": ["准确性","完整性","可执行性","缺漏检查"]\n' +
    "}\n" +
    `问题: ${INPUT_PLACEHOLDER}`
  );
}

function isDecisionStage(nodeId: string, role: string): boolean {
  return (
    /(judge|evaluator|review|qa|ops|check|risk)/.test(nodeId) ||
    /(EVALUATION|QUALITY|REVIEW|QA|RISK|FACT CHECK|OPS)/i.test(role)
  );
}

function isIntakeStage(nodeId: string, role: string): boolean {
  return /(intake|requirements|spec|reframe|brief)/.test(nodeId) || /(INTAKE|SPEC|PLANNING)/i.test(role);
}

function isFinalStage(nodeId: string): boolean {
  return /final/.test(nodeId);
}

function isPlanningStage(nodeId: string, role: string): boolean {
  return (
    /(architecture|system|implementation|analysis|collector|factcheck|backend|frontend|diverge|critic|macro|company|search)/.test(
      nodeId,
    ) || /(ARCHITECTURE|IMPLEMENTATION|ANALYSIS|COLLECTION|BACKEND|FRONTEND|DIVERGENCE|CRITIC)/i.test(role)
  );
}

function buildDecisionTemplate(locale: AppLocale, role: string): string {
  if (locale === "en") {
    return (
      `You are ${role || "the quality evaluation agent"}.\n` +
      "Review the input and output JSON only.\n" +
      'Format: {"DECISION":"PASS|REJECT","finalDraft":"...","notes":["..."],"risks":["..."]}\n' +
      "If evidence is weak, set DECISION to REJECT and explain why.\n" +
      `Input: ${INPUT_PLACEHOLDER}`
    );
  }
  if (locale === "jp") {
    return (
      `あなたは${role || "品質評価エージェント"}です。\n` +
      "入力を評価し、JSONのみを出力してください。\n" +
      '形式: {"DECISION":"PASS|REJECT","finalDraft":"...","notes":["..."],"risks":["..."]}\n' +
      "根拠が弱い場合は DECISION を REJECT にし、理由を明記してください。\n" +
      `入力: ${INPUT_PLACEHOLDER}`
    );
  }
  return (
    `你是${role || "质量评估代理"}。\n` +
    "请评估输入，并只输出 JSON。\n" +
    '格式: {"DECISION":"PASS|REJECT","finalDraft":"...","notes":["..."],"risks":["..."]}\n' +
    "若证据不足，请将 DECISION 设为 REJECT 并说明原因。\n" +
    `输入: ${INPUT_PLACEHOLDER}`
  );
}

function buildFinalTemplate(locale: AppLocale, role: string): string {
  if (locale === "en") {
    return (
      `You are ${role || "the final synthesis agent"}.\n` +
      "Write the final deliverable in a clear, user-facing format.\n" +
      "Structure: conclusion, evidence, risks/limits, actionable next steps.\n" +
      `Input: ${INPUT_PLACEHOLDER}`
    );
  }
  if (locale === "jp") {
    return (
      `あなたは${role || "最終統合エージェント"}です。\n` +
      "ユーザー向けの最終成果物を明確に作成してください。\n" +
      "構成: 結論 / 根拠 / リスク・限界 / 次の実行ステップ。\n" +
      `入力: ${INPUT_PLACEHOLDER}`
    );
  }
  return (
    `你是${role || "最终综合代理"}。\n` +
    "请面向用户生成清晰的最终文档。\n" +
    "结构: 结论 / 证据 / 风险与限制 / 可执行下一步。\n" +
    `输入: ${INPUT_PLACEHOLDER}`
  );
}

function buildWebTemplate(locale: AppLocale, role: string): string {
  if (locale === "en") {
    return (
      `You are ${role || "the web research agent"}.\n` +
      "Collect the latest relevant signals and summarize them with source date context.\n" +
      "Include: key findings, confidence level, and unresolved questions.\n" +
      `Input: ${INPUT_PLACEHOLDER}`
    );
  }
  if (locale === "jp") {
    return (
      `あなたは${role || "Webリサーチエージェント"}です。\n` +
      "最新の関連情報を収集し、出典日付付きで要約してください。\n" +
      "含める項目: 主要発見、信頼度、未解決の論点。\n" +
      `入力: ${INPUT_PLACEHOLDER}`
    );
  }
  return (
    `你是${role || "Web 调研代理"}。\n` +
    "请收集最新相关信息，并结合来源日期进行摘要。\n" +
    "包含: 关键发现、可信度、待确认问题。\n" +
    `输入: ${INPUT_PLACEHOLDER}`
  );
}

function buildIntakeTemplate(locale: AppLocale, role: string): string {
  if (locale === "en") {
    return (
      `You are ${role || "the intake/planning agent"}.\n` +
      "Convert the request into an execution brief.\n" +
      "Include: objective, constraints, required outputs, and assumptions.\n" +
      `Input: ${INPUT_PLACEHOLDER}`
    );
  }
  if (locale === "jp") {
    return (
      `あなたは${role || "要件整理エージェント"}です。\n` +
      "要求を実行ブリーフに変換してください。\n" +
      "含める項目: 目的、制約、必要アウトプット、前提。\n" +
      `入力: ${INPUT_PLACEHOLDER}`
    );
  }
  return (
    `你是${role || "需求整理代理"}。\n` +
    "请将请求整理为执行简报。\n" +
    "包含: 目标、约束、必需输出、前提假设。\n" +
    `输入: ${INPUT_PLACEHOLDER}`
  );
}

function buildPlanningTemplate(locale: AppLocale, role: string): string {
  if (locale === "en") {
    return (
      `You are ${role || "the stage specialist agent"}.\n` +
      "Produce a stage-specific structured result based on the input.\n" +
      "Show concrete outputs, assumptions, and verification points.\n" +
      `Input: ${INPUT_PLACEHOLDER}`
    );
  }
  if (locale === "jp") {
    return (
      `あなたは${role || "担当ステージ専門エージェント"}です。\n` +
      "入力に基づき、このステージの構造化結果を作成してください。\n" +
      "具体的アウトプット、前提、検証ポイントを示してください。\n" +
      `入力: ${INPUT_PLACEHOLDER}`
    );
  }
  return (
    `你是${role || "该阶段专业代理"}。\n` +
    "请基于输入输出该阶段的结构化结果。\n" +
    "明确给出具体产出、假设和验证点。\n" +
    `输入: ${INPUT_PLACEHOLDER}`
  );
}

function buildGenericTemplate(locale: AppLocale, role: string): string {
  if (locale === "en") {
    return `You are ${role || "an assistant agent"}.\nHandle this stage clearly.\nInput: ${INPUT_PLACEHOLDER}`;
  }
  if (locale === "jp") {
    return `あなたは${role || "アシスタントエージェント"}です。\nこのステージを明確に処理してください。\n入力: ${INPUT_PLACEHOLDER}`;
  }
  return `你是${role || "辅助代理"}。\n请清晰完成本阶段任务。\n输入: ${INPUT_PLACEHOLDER}`;
}

export function localizePresetPromptTemplate(
  kind: PresetKind,
  node: GraphNode,
  locale: AppLocale,
  fallbackTemplate: string,
): string {
  if (node.type !== "turn" || locale === "ko") {
    return fallbackTemplate;
  }

  const config = node.config as TurnConfig;
  const nodeId = node.id.toLowerCase();
  const role = String(config.role ?? "").trim();
  const executor = getTurnExecutor(config);

  if (nodeId.includes("preprocess")) {
    return buildLocalizedPreprocessPrompt(kind, locale);
  }
  if (executor.startsWith("web_")) {
    return buildWebTemplate(locale, role);
  }
  if (isDecisionStage(nodeId, role)) {
    return buildDecisionTemplate(locale, role);
  }
  if (isFinalStage(nodeId)) {
    return buildFinalTemplate(locale, role);
  }
  if (isIntakeStage(nodeId, role)) {
    return buildIntakeTemplate(locale, role);
  }
  if (isPlanningStage(nodeId, role)) {
    return buildPlanningTemplate(locale, role);
  }
  return buildGenericTemplate(locale, role);
}
