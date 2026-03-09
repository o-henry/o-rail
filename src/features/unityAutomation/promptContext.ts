import type {
  UnityAutomationPresetKind,
  UnityDiagnosticFileSummary,
  UnityDiagnosticsBundle,
  UnityGuardInspection,
} from "./types";

export const UNITY_AUTOMATION_PRESET_KINDS: UnityAutomationPresetKind[] = [
  "unityCiDoctor",
  "unityTestsmith",
  "unityBuildWatcher",
  "unityLocalizationQa",
  "unityAddressablesDiet",
];

export function isUnityAutomationPresetKind(value: string | null | undefined): value is UnityAutomationPresetKind {
  return UNITY_AUTOMATION_PRESET_KINDS.includes(String(value ?? "") as UnityAutomationPresetKind);
}

function summarizeFile(file: UnityDiagnosticFileSummary): string {
  const parts = [
    `kind=${file.kind}`,
    `present=${file.present ? "yes" : "no"}`,
    `errors=${file.errorCount}`,
    `warnings=${file.warningCount}`,
  ];
  if (file.path.trim()) {
    parts.push(`path=${file.path}`);
  }
  return `- ${parts.join(" / ")}`;
}

export function buildUnityAutomationPromptContext(input: {
  inspection: UnityGuardInspection;
  diagnostics: UnityDiagnosticsBundle;
}): string {
  const warningLines = input.inspection.warnings
    .filter((line) => line.trim())
    .slice(0, 4)
    .map((line) => `- ${line}`);
  const fileLines = input.diagnostics.files.slice(0, 4).map(summarizeFile);

  return [
    "[UNITY_AUTOMATION_CONTEXT]",
    `project=${input.inspection.projectPath}`,
    `unityProject=${input.inspection.unityProject ? "yes" : "no"}`,
    `recommendedMode=${input.inspection.recommendedMode}`,
    `currentBranch=${String(input.inspection.currentBranch ?? "unknown")}`,
    `dirty=${String(input.inspection.dirty ?? "unknown")}`,
    `protectedPaths=${input.inspection.protectedPaths.join(", ")}`,
    `diagnosticSummary=${input.diagnostics.summary}`,
    "",
    "[guard_warnings]",
    warningLines.length > 0 ? warningLines.join("\n") : "- none",
    "",
    "[diagnostic_files]",
    fileLines.length > 0 ? fileLines.join("\n") : "- none",
    "[/UNITY_AUTOMATION_CONTEXT]",
  ].join("\n");
}
