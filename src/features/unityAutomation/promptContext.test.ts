import { describe, expect, it } from "vitest";
import { buildUnityAutomationPromptContext, isUnityAutomationPresetKind } from "./promptContext";

describe("unity automation prompt context", () => {
  it("recognizes all supported preset kinds", () => {
    expect(isUnityAutomationPresetKind("unityCiDoctor")).toBe(true);
    expect(isUnityAutomationPresetKind("unityTestsmith")).toBe(true);
    expect(isUnityAutomationPresetKind("unityBuildWatcher")).toBe(true);
    expect(isUnityAutomationPresetKind("unityLocalizationQa")).toBe(true);
    expect(isUnityAutomationPresetKind("unityAddressablesDiet")).toBe(true);
    expect(isUnityAutomationPresetKind("research")).toBe(false);
  });

  it("builds a compact guard/diagnostic context block", () => {
    const text = buildUnityAutomationPromptContext({
      inspection: {
        projectPath: "/tmp/unity-project",
        unityProject: true,
        currentBranch: "main",
        dirty: false,
        recommendedMode: "git_worktree",
        protectedPaths: ["ProjectSettings/**", "Assets/**/*.unity"],
        latestDiagnosticsPath: "/tmp/latest-diagnostics.json",
        latestDiagnosticsMarkdownPath: "/tmp/latest-diagnostics.md",
        worktreeRoot: "/tmp/.rail/unity/sandboxes",
        warnings: ["workspace must remain read-only by default"],
      },
      diagnostics: {
        projectPath: "/tmp/unity-project",
        recommendedMode: "git_worktree",
        summary: "2 errors / 1 warning",
        files: [
          {
            kind: "editor",
            path: "/tmp/Editor.log",
            present: true,
            bytes: 128,
            lineCount: 7,
            errorCount: 2,
            warningCount: 1,
            excerpt: "NullReferenceException",
          },
        ],
        savedJsonPath: "/tmp/latest-diagnostics.json",
        savedMarkdownPath: "/tmp/latest-diagnostics.md",
      },
    });

    expect(text).toContain("[UNITY_AUTOMATION_CONTEXT]");
    expect(text).toContain("recommendedMode=git_worktree");
    expect(text).toContain("protectedPaths=ProjectSettings/**, Assets/**/*.unity");
    expect(text).toContain("diagnosticSummary=2 errors / 1 warning");
    expect(text).toContain("kind=editor");
  });
});
