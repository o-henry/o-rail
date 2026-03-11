import type { TurnConfig } from "../../../features/workflow/domain";
import type { TurnReasoningEffort } from "../../../features/workflow/reasoningLevels";
import {
  clipTurnInputText,
  normalizeTurnContextBudget,
  normalizeTurnTemperature,
  resolveTurnMaxInputChars,
  type TurnContextBudget,
} from "../../../features/workflow/turnExecutionTuning";

export type TurnRuntimeConfig = {
  temperature: number;
  contextBudget: TurnContextBudget;
  maxInputChars: number;
};

export function resolveTurnRuntimeConfig(config: TurnConfig): TurnRuntimeConfig {
  const contextBudget = normalizeTurnContextBudget(config.contextBudget);
  return {
    temperature: normalizeTurnTemperature(config.temperature),
    contextBudget,
    maxInputChars: resolveTurnMaxInputChars(config),
  };
}

export function applyTurnInputBudget(inputText: string, config: TurnRuntimeConfig) {
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
