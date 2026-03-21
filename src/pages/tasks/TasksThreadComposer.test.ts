import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildSelectedTasksComposerBadges,
  canSubmitTasksComposer,
  TasksThreadComposer,
  shouldShowTasksComposerStopButton,
} from "./TasksThreadComposer";

describe("canSubmitTasksComposer", () => {
  it("returns false for empty or whitespace-only input", () => {
    expect(canSubmitTasksComposer("")).toBe(false);
    expect(canSubmitTasksComposer("   ")).toBe(false);
  });

  it("returns false when the draft only contains orchestration mode tags", () => {
    expect(canSubmitTasksComposer("@team")).toBe(false);
    expect(canSubmitTasksComposer("  @fanout   ")).toBe(false);
  });

  it("returns true when there is real prompt content", () => {
    expect(canSubmitTasksComposer("fix this bug")).toBe(true);
    expect(canSubmitTasksComposer("@team fix this bug")).toBe(true);
  });
});

describe("buildSelectedTasksComposerBadges", () => {
  it("includes coordination mode badges alongside agent badges", () => {
    expect(buildSelectedTasksComposerBadges({
      roleIds: ["researcher"],
      modeOverride: "fanout",
    })).toEqual([
      {
        key: "agent:researcher",
        kind: "agent",
        label: "RESEARCHER",
        roleId: "researcher",
      },
      {
        key: "mode:fanout",
        kind: "mode",
        label: "FANOUT",
        mode: "fanout",
      },
    ]);
  });
});

describe("shouldShowTasksComposerStopButton", () => {
  it("shows the stop button immediately while a submit is pending", () => {
    expect(shouldShowTasksComposerStopButton({
      canInterruptCurrentThread: false,
      composerSubmitPending: true,
    })).toBe(true);
  });

  it("stays visible while a thread is interruptible", () => {
    expect(shouldShowTasksComposerStopButton({
      canInterruptCurrentThread: true,
      composerSubmitPending: false,
    })).toBe(true);
  });

  it("hides the stop button when nothing is pending or running", () => {
    expect(shouldShowTasksComposerStopButton({
      canInterruptCurrentThread: false,
      composerSubmitPending: false,
    })).toBe(false);
  });
});

describe("TasksThreadComposer", () => {
  it("disables the composer while Codex login is required", () => {
    const html = renderToStaticMarkup(
      createElement(TasksThreadComposer, {
        attachedFiles: [],
        canInterruptCurrentThread: false,
        canUseStopButton: false,
        codexAuthCheckPending: false,
        codexLoginLocked: true,
        composerCoordinationModeOverride: null,
        composerDraft: "",
        composerRef: createRef<HTMLTextAreaElement>(),
        isModelMenuOpen: false,
        isReasonMenuOpen: false,
        mentionIndex: 0,
        mentionMatch: null,
        modelMenuRef: createRef<HTMLDivElement>(),
        onClearCoordinationModeOverride: () => undefined,
        onComposerCursorChange: () => undefined,
        onComposerDraftChange: () => undefined,
        onComposerKeyDown: () => undefined,
        onOpenAttachmentPicker: () => undefined,
        onRemoveAttachedFile: () => undefined,
        onRemoveComposerRole: () => undefined,
        onSelectMention: () => undefined,
        onSetModel: () => undefined,
        onSetReasoning: () => undefined,
        onStop: () => undefined,
        onSubmit: () => undefined,
        onToggleModelMenu: () => undefined,
        onToggleReasonMenu: () => undefined,
        reasonMenuRef: createRef<HTMLDivElement>(),
        reasoning: "중간",
        reasoningLabel: "MEDIUM",
        selectedComposerRoleIds: [],
        selectedModelOption: { value: "GPT-5.4", label: "GPT-5.4" },
        showStopButton: false,
        stoppingComposerRun: false,
      }),
    );

    expect(html).toContain("disabled");
    expect(html).toContain("Codex 로그인 후 Tasks를 사용할 수 있습니다.");
  });
});
