export type UnityAutomationPresetKind =
  | "unityCiDoctor"
  | "unityTestsmith"
  | "unityBuildWatcher"
  | "unityLocalizationQa"
  | "unityAddressablesDiet";

export type UnityGuardInspection = {
  projectPath: string;
  unityProject: boolean;
  gitRoot?: string | null;
  currentBranch?: string | null;
  dirty?: boolean | null;
  recommendedMode: string;
  protectedPaths: string[];
  editorLogPath?: string | null;
  latestDiagnosticsPath: string;
  latestDiagnosticsMarkdownPath: string;
  worktreeRoot: string;
  warnings: string[];
};

export type UnityDiagnosticFileSummary = {
  kind: string;
  path: string;
  present: boolean;
  bytes: number;
  lineCount: number;
  errorCount: number;
  warningCount: number;
  excerpt: string;
};

export type UnityDiagnosticsBundle = {
  projectPath: string;
  recommendedMode: string;
  summary: string;
  files: UnityDiagnosticFileSummary[];
  savedJsonPath: string;
  savedMarkdownPath: string;
};
