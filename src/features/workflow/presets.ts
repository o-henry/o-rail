import type { PresetKind } from "./domain";
import type { GraphData } from "./types";
import {
  buildDevelopmentPreset,
  buildExpertPreset,
  buildResearchPreset,
  buildUnityCiDoctorPreset,
  buildValidationPreset,
} from "./presets/buildersCore";
import {
  buildCreativePreset,
  buildFullstackPreset,
  buildNewsTrendPreset,
  buildUnityGamePreset,
} from "./presets/buildersExtended";
import {
  applyPresetOutputSchemaPolicies,
  applyPresetTurnPolicies,
  simplifyPresetForSimpleWorkflow,
} from "./presets/policies";
import { prependPreprocessAgent } from "./presets/preprocess";

export { applyPresetOutputSchemaPolicies, applyPresetTurnPolicies, simplifyPresetForSimpleWorkflow };

export function buildPresetGraphByKind(kind: PresetKind): GraphData {
  let base: GraphData;
  if (kind === "validation") {
    base = buildValidationPreset();
  } else if (kind === "development") {
    base = buildDevelopmentPreset();
  } else if (kind === "research") {
    base = buildResearchPreset();
  } else if (kind === "unityCiDoctor") {
    base = buildUnityCiDoctorPreset();
  } else if (kind === "unityGame") {
    base = buildUnityGamePreset();
  } else if (kind === "fullstack") {
    base = buildFullstackPreset();
  } else if (kind === "creative") {
    base = buildCreativePreset();
  } else if (kind === "newsTrend") {
    base = buildNewsTrendPreset();
  } else {
    base = buildExpertPreset();
  }
  return prependPreprocessAgent(kind, base);
}
