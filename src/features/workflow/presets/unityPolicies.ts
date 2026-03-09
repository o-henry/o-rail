import type { PresetKind } from "../domain";
import { DEFAULT_PRESET_TURN_POLICY, type PresetTurnPolicy } from "./shared";

export function resolveUnityAutomationTurnPolicy(kind: PresetKind, key: string): PresetTurnPolicy | null {
  if (kind === "unityCiDoctor") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 74, artifactType: "RequirementArtifact" };
    }
    if (key.includes("system")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 88, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("qa")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 82, artifactType: "TaskPlanArtifact" };
    }
    if (key.includes("pm")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 78, artifactType: "RequirementArtifact" };
    }
    if (key.includes("judge")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 90, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("final")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 84, artifactType: "ChangePlanArtifact" };
    }
  }

  if (kind === "unityTestsmith") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 74, artifactType: "RequirementArtifact" };
    }
    if (key.includes("design")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 80, artifactType: "DesignArtifact" };
    }
    if (key.includes("editmode") || key.includes("playmode")) {
      return {
        ...DEFAULT_PRESET_TURN_POLICY,
        profile: "code_implementation",
        threshold: 84,
        qualityCommandEnabled: true,
        qualityCommands: "npm run build",
        artifactType: "TaskPlanArtifact",
      };
    }
    if (key.includes("qa") || key.includes("judge")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 88, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("final")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 84, artifactType: "ChangePlanArtifact" };
    }
  }

  if (kind === "unityBuildWatcher") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 72, artifactType: "RequirementArtifact" };
    }
    if (key.includes("report") || key.includes("regression")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 86, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("risk") || key.includes("judge")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 89, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("final")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 84, artifactType: "ChangePlanArtifact" };
    }
  }

  if (kind === "unityLocalizationQa") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 72, artifactType: "RequirementArtifact" };
    }
    if (key.includes("keys") || key.includes("placeholders") || key.includes("terms")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 85, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("judge")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 89, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("final")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 84, artifactType: "ChangePlanArtifact" };
    }
  }

  if (kind === "unityAddressablesDiet") {
    if (key.includes("intake")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "design_planning", threshold: 74, artifactType: "RequirementArtifact" };
    }
    if (key.includes("layout") || key.includes("dup") || key.includes("load")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 87, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("judge")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "research_evidence", threshold: 90, artifactType: "EvidenceArtifact" };
    }
    if (key.includes("final")) {
      return { ...DEFAULT_PRESET_TURN_POLICY, profile: "synthesis_final", threshold: 85, artifactType: "ChangePlanArtifact" };
    }
  }

  return null;
}
