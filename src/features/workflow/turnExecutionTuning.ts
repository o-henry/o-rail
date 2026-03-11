export const TURN_CONTEXT_BUDGET_OPTIONS = ["tight", "balanced", "wide"] as const;

export type TurnContextBudget = (typeof TURN_CONTEXT_BUDGET_OPTIONS)[number];

export const DEFAULT_TURN_TEMPERATURE = 0.2;
export const DEFAULT_TURN_CONTEXT_BUDGET: TurnContextBudget = "balanced";
export const TURN_INPUT_TRUNCATION_NOTICE = "[입력 일부 생략됨: context budget 제한]";

export const TURN_CONTEXT_BUDGET_MAX_INPUT_CHARS: Record<TurnContextBudget, number> = {
  tight: 2400,
  balanced: 3600,
  wide: 5600,
};

const TURN_TEMPERATURE_MIN = 0;
const TURN_TEMPERATURE_MAX = 1;
const TURN_MAX_INPUT_CHARS_MIN = 600;
const TURN_MAX_INPUT_CHARS_MAX = 20_000;

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeTurnTemperature(
  value: unknown,
  fallback = DEFAULT_TURN_TEMPERATURE,
): number {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  const clamped = Math.max(TURN_TEMPERATURE_MIN, Math.min(TURN_TEMPERATURE_MAX, safe));
  return roundToHundredth(clamped);
}

export function normalizeTurnContextBudget(value: unknown): TurnContextBudget {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "tight" || normalized === "wide") {
    return normalized;
  }
  return DEFAULT_TURN_CONTEXT_BUDGET;
}

export function normalizeTurnMaxInputChars(
  value: unknown,
  fallback = TURN_CONTEXT_BUDGET_MAX_INPUT_CHARS[DEFAULT_TURN_CONTEXT_BUDGET],
): number {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.round(
    Math.max(TURN_MAX_INPUT_CHARS_MIN, Math.min(TURN_MAX_INPUT_CHARS_MAX, safe)),
  );
}

export function resolveTurnMaxInputChars(input: {
  contextBudget?: unknown;
  maxInputChars?: unknown;
}): number {
  const budget = normalizeTurnContextBudget(input.contextBudget);
  return normalizeTurnMaxInputChars(
    input.maxInputChars,
    TURN_CONTEXT_BUDGET_MAX_INPUT_CHARS[budget],
  );
}

export function clipTurnInputText(
  inputText: string,
  maxInputChars: number,
): { text: string; clipped: boolean } {
  if (inputText.length <= maxInputChars) {
    return { text: inputText, clipped: false };
  }
  const reserved = TURN_INPUT_TRUNCATION_NOTICE.length + 2;
  const available = Math.max(200, maxInputChars - reserved);
  return {
    text: `${inputText.slice(0, available).trimEnd()}\n\n${TURN_INPUT_TRUNCATION_NOTICE}`,
    clipped: true,
  };
}
