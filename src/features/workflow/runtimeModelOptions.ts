import type { TurnExecutor } from "./domain";

export type RuntimeModelOption = {
  value: string;
  label: string;
  allowsReasonLevel: boolean;
  executor: TurnExecutor;
  turnModel?: string;
};

export const RUNTIME_MODEL_OPTIONS: ReadonlyArray<RuntimeModelOption> = [
  {
    value: "5.4",
    label: "5.4",
    allowsReasonLevel: true,
    executor: "codex",
    turnModel: "GPT-5.4",
  },
  {
    value: "5.3-Codex",
    label: "5.3-Codex",
    allowsReasonLevel: true,
    executor: "codex",
    turnModel: "GPT-5.3-Codex",
  },
  {
    value: "5.3-Codex-Spark",
    label: "5.3-Codex-Spark",
    allowsReasonLevel: true,
    executor: "codex",
    turnModel: "GPT-5.3-Codex-Spark",
  },
  {
    value: "5.2-Codex",
    label: "5.2-Codex",
    allowsReasonLevel: true,
    executor: "codex",
    turnModel: "GPT-5.2-Codex",
  },
  {
    value: "5.1-Codex-Max",
    label: "5.1-Codex-Max",
    allowsReasonLevel: true,
    executor: "codex",
    turnModel: "GPT-5.1-Codex-Max",
  },
  {
    value: "5.2",
    label: "5.2",
    allowsReasonLevel: true,
    executor: "codex",
    turnModel: "GPT-5.2",
  },
  {
    value: "5.1-Codex-Mini",
    label: "5.1-Codex-Mini",
    allowsReasonLevel: true,
    executor: "codex",
    turnModel: "GPT-5.1-Codex-Mini",
  },
  {
    value: "GPT-Web",
    label: "AI · GPT",
    allowsReasonLevel: false,
    executor: "web_gpt",
  },
  {
    value: "Gemini",
    label: "AI · Gemini",
    allowsReasonLevel: false,
    executor: "web_gemini",
  },
  {
    value: "Grok",
    label: "AI · Grok",
    allowsReasonLevel: false,
    executor: "web_grok",
  },
  {
    value: "Perplexity",
    label: "AI · Perplexity",
    allowsReasonLevel: false,
    executor: "web_perplexity",
  },
  {
    value: "Claude",
    label: "AI · Claude",
    allowsReasonLevel: false,
    executor: "web_claude",
  },
];

export const DEFAULT_RUNTIME_MODEL_VALUE = RUNTIME_MODEL_OPTIONS[0].value;

export function findRuntimeModelOption(value: string): RuntimeModelOption {
  return RUNTIME_MODEL_OPTIONS.find((option) => option.value === value) ?? RUNTIME_MODEL_OPTIONS[0];
}
