import type { TurnConfig } from "../../../features/workflow/domain";
import type { TurnReasoningEffort } from "../../../features/workflow/reasoningLevels";
import {
  clipTurnInputText,
  normalizeTurnContextBudget,
  normalizeTurnTemperature,
  resolveTurnMaxInputChars,
  resolveTurnInputOverflowPolicy,
  type TurnContextBudget,
  type TurnInputOverflowPolicy,
} from "../../../features/workflow/turnExecutionTuning";

export type TurnRuntimeConfig = {
  temperature: number;
  contextBudget: TurnContextBudget;
  maxInputChars: number;
  overflowPolicy: TurnInputOverflowPolicy;
};

export function resolveTurnRuntimeConfig(config: TurnConfig): TurnRuntimeConfig {
  const contextBudget = normalizeTurnContextBudget(config.contextBudget);
  return {
    temperature: normalizeTurnTemperature(config.temperature),
    contextBudget,
    maxInputChars: resolveTurnMaxInputChars(config),
    overflowPolicy: resolveTurnInputOverflowPolicy(config),
  };
}

export function applyTurnInputBudget(inputText: string, config: TurnRuntimeConfig) {
  if (config.overflowPolicy === "preserve") {
    return { text: inputText, clipped: false };
  }
  return clipTurnInputText(inputText, config.maxInputChars);
}

export function buildTurnStartArgs(params: {
  threadId: string;
  text: string;
  reasoningEffort: TurnReasoningEffort;
  config: TurnRuntimeConfig;
}) {
  return {
    threadId: params.threadId,
    text: params.text,
    reasoningEffort: params.reasoningEffort,
    temperature: params.config.temperature,
    contextBudget: params.config.contextBudget,
    maxInputChars: params.config.maxInputChars,
  };
}
