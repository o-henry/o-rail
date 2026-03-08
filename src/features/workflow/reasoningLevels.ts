export const TURN_REASONING_LEVEL_OPTIONS = ["낮음", "중간", "높음", "매우 높음"] as const;

export type TurnReasoningLevelLabel = (typeof TURN_REASONING_LEVEL_OPTIONS)[number];
export type TurnReasoningEffort = "low" | "medium" | "high" | "xhigh";

export const DEFAULT_TURN_REASONING_LEVEL: TurnReasoningLevelLabel = "중간";

const TURN_REASONING_EFFORT_BY_LABEL: Record<TurnReasoningLevelLabel, TurnReasoningEffort> = {
  낮음: "low",
  중간: "medium",
  높음: "high",
  "매우 높음": "xhigh",
};

const TURN_REASONING_LABEL_BY_EFFORT: Record<TurnReasoningEffort, TurnReasoningLevelLabel> = {
  low: "낮음",
  medium: "중간",
  high: "높음",
  xhigh: "매우 높음",
};

export function normalizeTurnReasoningLevel(value: unknown): TurnReasoningLevelLabel {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_TURN_REASONING_LEVEL;
  }
  const matchedLabel = TURN_REASONING_LEVEL_OPTIONS.find((label) => label.toLowerCase() === normalized);
  if (matchedLabel) {
    return matchedLabel;
  }
  const matchedEffort = (Object.keys(TURN_REASONING_LABEL_BY_EFFORT) as TurnReasoningEffort[]).find(
    (effort) => effort === normalized,
  );
  if (matchedEffort) {
    return TURN_REASONING_LABEL_BY_EFFORT[matchedEffort];
  }
  if (normalized === "very high") {
    return "매우 높음";
  }
  return DEFAULT_TURN_REASONING_LEVEL;
}

export function toTurnReasoningEffort(value: unknown): TurnReasoningEffort {
  return TURN_REASONING_EFFORT_BY_LABEL[normalizeTurnReasoningLevel(value)];
}
