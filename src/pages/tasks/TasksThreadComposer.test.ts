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
      autoRoleIds: ["game_designer"],
      autoProviderValue: "WEB / STEEL",
      modeOverride: "fanout",
    })).toEqual([
      {
        key: "agent:researcher",
        kind: "agent",
        label: "RESEARCHER",
        roleId: "researcher",
      },
      {
        key: "auto-agent:game_designer",
        kind: "auto-agent",
        label: "GAME DESIGNER",
        roleId: "game_designer",
      },
      {
        key: "auto-provider:WEB / STEEL",
        kind: "auto-provider",
        label: "WEB / STEEL",
        value: "WEB / STEEL",
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
  it("keeps the composer usable even when Codex login is missing", () => {
    const html = renderToStaticMarkup(
      createElement(TasksThreadComposer, {
        attachedFiles: [],
        autoSelectedComposerRoleIds: [],
        autoSelectedProviderModel: null,
        canInterruptCurrentThread: false,
        canUseStopButton: false,
        creativeModeEnabled: false,
        composerProviderOverride: null,
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
        onClearComposerProviderOverride: () => undefined,
        onOpenAttachmentPicker: () => undefined,
        onToggleCreativeMode: () => undefined,
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

    expect(html).not.toContain("<textarea disabled");
    expect(html).toContain("Unity 작업 내용을 입력하거나 @로 에이전트를 선택하세요");
  });

  it("hides WEB / STEEL and WEB / LIGHTPANDA from the task model menu", () => {
    const html = renderToStaticMarkup(
      createElement(TasksThreadComposer, {
        attachedFiles: [],
        autoSelectedComposerRoleIds: [],
        autoSelectedProviderModel: null,
        canInterruptCurrentThread: false,
        canUseStopButton: false,
        creativeModeEnabled: false,
        composerProviderOverride: null,
        composerCoordinationModeOverride: null,
        composerDraft: "",
        composerRef: createRef<HTMLTextAreaElement>(),
        isModelMenuOpen: true,
        isReasonMenuOpen: false,
        mentionIndex: 0,
        mentionMatch: null,
        modelMenuRef: createRef<HTMLDivElement>(),
        onClearCoordinationModeOverride: () => undefined,
        onComposerCursorChange: () => undefined,
        onComposerDraftChange: () => undefined,
        onComposerKeyDown: () => undefined,
        onClearComposerProviderOverride: () => undefined,
        onOpenAttachmentPicker: () => undefined,
        onToggleCreativeMode: () => undefined,
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

    expect(html).not.toContain("AI · GPT");
    expect(html).not.toContain("AI · Gemini");
    expect(html).not.toContain("AI · Grok");
    expect(html).not.toContain("AI · Perplexity");
    expect(html).not.toContain("AI · Claude");
    expect(html).not.toContain("WEB / STEEL");
    expect(html).not.toContain("WEB / LIGHTPANDA");
  });

  it("renders orchestrator-selected badges with a distinct auto style", () => {
    const html = renderToStaticMarkup(
      createElement(TasksThreadComposer, {
        attachedFiles: [],
        autoSelectedComposerRoleIds: ["researcher", "game_designer"],
        autoSelectedProviderModel: "WEB / STEEL",
        canInterruptCurrentThread: false,
        canUseStopButton: false,
        creativeModeEnabled: true,
        composerProviderOverride: null,
        composerCoordinationModeOverride: null,
        composerDraft: "인디게임 아이디어 추천해줘",
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
        onClearComposerProviderOverride: () => undefined,
        onOpenAttachmentPicker: () => undefined,
        onToggleCreativeMode: () => undefined,
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

    expect(html).toContain("tasks-thread-selected-mention-chip is-auto");
    expect(html).toContain("창의성 모드 ON");
    expect(html).toContain("AUTO: GAME DESIGNER");
    expect(html).toContain("AUTO: RESEARCHER");
    expect(html).toContain("AUTO: WEB / STEEL");
  });

  it("switches back to a disabled send button while a stop request is in flight", () => {
    const html = renderToStaticMarkup(
      createElement(TasksThreadComposer, {
        attachedFiles: [],
        autoSelectedComposerRoleIds: [],
        autoSelectedProviderModel: null,
        canInterruptCurrentThread: true,
        canUseStopButton: true,
        creativeModeEnabled: false,
        composerProviderOverride: null,
        composerCoordinationModeOverride: null,
        composerDraft: "인디게임 아이디어 정리해줘",
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
        onClearComposerProviderOverride: () => undefined,
        onOpenAttachmentPicker: () => undefined,
        onToggleCreativeMode: () => undefined,
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
        showStopButton: true,
        stoppingComposerRun: true,
      }),
    );

    expect(html).not.toContain("tasks-stop-button");
    expect(html).toContain("tasks-send-button");
    expect(html).toContain("disabled");
  });
});
