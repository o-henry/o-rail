export type UnityAutomationPresetKind =
  | "unityCiDoctor"
  | "unityTestsmith"
  | "unityBuildWatcher"
  | "unityLocalizationQa"
  | "unityAddressablesDiet";

export type UnityBatchAction = "build" | "tests_edit" | "tests_play";

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

export type UnityGuardPrepareResult = {
  strategy: string;
  sandboxPath?: string | null;
  branchName?: string | null;
  metadataPath: string;
  sourceProjectPath: string;
  readOnlyDefault: boolean;
  protectedPaths: string[];
  warnings: string[];
};

export type UnityBatchCommandPreview = {
  action: UnityBatchAction;
  sandboxPath: string;
  unityPath: string;
  command: string;
  logPath: string;
  testResultsPath?: string | null;
};
