import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { CoordinationMode } from "../../features/orchestration/agentic/coordinationTypes";
import { TURN_REASONING_LEVEL_OPTIONS } from "../../features/workflow/reasoningLevels";
import { findRuntimeModelOption, RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";
import { useI18n } from "../../i18n";
import type { TaskAgentMentionMatch, TaskAgentMentionOption } from "./taskAgentMentions";
import { getTaskAgentLabel, stripCoordinationModeTags } from "./taskAgentPresets";
import type { ThreadRoleId } from "./threadTypes";

type AttachedFile = {
  id: string;
  name: string;
  path: string;
  enabled?: boolean;
};

type RuntimeModelOption = {
  value: string;
  label: string;
  executor?: string;
};

const HIDDEN_TASKS_MODEL_VALUES = new Set([
  "GPT-Web",
  "Gemini",
  "Grok",
  "Perplexity",
  "Claude",
  "WEB / STEEL",
  "WEB / LIGHTPANDA",
]);

type TasksThreadComposerProps = {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  reasonMenuRef: RefObject<HTMLDivElement | null>;
  mentionMatch: TaskAgentMentionMatch | null;
  mentionIndex: number;
  attachedFiles: AttachedFile[];
  selectedComposerRoleIds: ThreadRoleId[];
  autoSelectedComposerRoleIds?: ThreadRoleId[];
  composerProviderOverride?: string | null;
  autoSelectedProviderModel?: string | null;
  creativeModeEnabled: boolean;
  composerCoordinationModeOverride: CoordinationMode | null;
  composerDraft: string;
  selectedModelOption: RuntimeModelOption;
  isModelMenuOpen: boolean;
  isReasonMenuOpen: boolean;
  reasoning: string;
  reasoningLabel: string;
  showStopButton: boolean;
  canUseStopButton: boolean;
  canInterruptCurrentThread: boolean;
  stoppingComposerRun: boolean;
  onSelectMention: (option: TaskAgentMentionOption) => void;
  onRemoveAttachedFile: (id: string) => void;
  onRemoveComposerRole: (roleId: ThreadRoleId) => void;
  onClearCoordinationModeOverride: () => void;
  onComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerDraftChange: (value: string, cursor: number) => void;
  onComposerCursorChange: (cursor: number) => void;
  onOpenAttachmentPicker: () => void;
  onSetModel: (value: string) => void;
  onToggleModelMenu: () => void;
  onSetReasoning: (value: string) => void;
  onToggleReasonMenu: () => void;
  onClearComposerProviderOverride: () => void;
  onToggleCreativeMode: () => void;
  onSubmit: () => void;
  onStop: () => void;
};

export function canSubmitTasksComposer(input: string | null | undefined): boolean {
  return Boolean(stripCoordinationModeTags(String(input ?? "")).trim());
}

export function shouldShowTasksComposerStopButton(params: {
  canInterruptCurrentThread: boolean;
  composerSubmitPending: boolean;
}): boolean {
  return Boolean(params.canInterruptCurrentThread || params.composerSubmitPending);
}

type SelectedTasksComposerBadge = {
  key: string;
  kind: "agent" | "auto-agent" | "mode" | "provider" | "auto-provider";
  label: string;
  roleId?: ThreadRoleId;
  mode?: CoordinationMode;
  value?: string;
};

function coordinationModeLabel(mode: CoordinationMode): string {
  if (mode === "fanout") {
    return "FANOUT";
  }
  if (mode === "team") {
    return "TEAM";
  }
  return "QUICK";
}

function composerProviderLabel(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  return findRuntimeModelOption(normalized).label;
}

export function buildSelectedTasksComposerBadges(params: {
  roleIds: ThreadRoleId[];
  autoRoleIds?: ThreadRoleId[];
  providerValue?: string | null;
  autoProviderValue?: string | null;
  modeOverride: CoordinationMode | null;
}): SelectedTasksComposerBadge[] {
  const badges: SelectedTasksComposerBadge[] = params.roleIds.map((roleId) => ({
    key: `agent:${roleId}`,
    kind: "agent",
    label: getTaskAgentLabel(roleId),
    roleId,
  }));
  for (const roleId of params.autoRoleIds ?? []) {
    if (params.roleIds.includes(roleId)) {
      continue;
    }
    badges.push({
      key: `auto-agent:${roleId}`,
      kind: "auto-agent",
      label: getTaskAgentLabel(roleId),
      roleId,
    });
  }
  const providerValue = String(params.providerValue ?? "").trim();
  if (providerValue) {
    badges.push({
      key: `provider:${providerValue}`,
      kind: "provider",
      label: composerProviderLabel(providerValue),
      value: providerValue,
    });
  }
  const autoProviderValue = String(params.autoProviderValue ?? "").trim();
  if (autoProviderValue && autoProviderValue !== providerValue) {
    badges.push({
      key: `auto-provider:${autoProviderValue}`,
      kind: "auto-provider",
      label: composerProviderLabel(autoProviderValue),
      value: autoProviderValue,
    });
  }
  if (params.modeOverride) {
    badges.push({
      key: `mode:${params.modeOverride}`,
      kind: "mode",
      label: coordinationModeLabel(params.modeOverride),
      mode: params.modeOverride,
    });
  }
  return badges;
}

export function TasksThreadComposer(props: TasksThreadComposerProps) {
  const { t } = useI18n();
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canSubmit = canSubmitTasksComposer(props.composerDraft);
  const composerDisabled = false;
  const composerPlaceholder = t("tasks.composer.placeholder");
  const visibleModelOptions = RUNTIME_MODEL_OPTIONS.filter((option) => !HIDDEN_TASKS_MODEL_VALUES.has(option.value));
  const selectedBadges = buildSelectedTasksComposerBadges({
    roleIds: props.selectedComposerRoleIds,
    autoRoleIds: props.autoSelectedComposerRoleIds ?? [],
    providerValue: props.composerProviderOverride,
    autoProviderValue: props.autoSelectedProviderModel,
    modeOverride: props.composerCoordinationModeOverride,
  });

  useEffect(() => {
    if (!props.mentionMatch) {
      mentionOptionRefs.current = [];
      return;
    }
    const activeOption = mentionOptionRefs.current[props.mentionIndex];
    const mentionMenu = mentionMenuRef.current;
    if (!activeOption || !mentionMenu) {
      return;
    }
    const menuPadding = 6;
    const optionTop = activeOption.offsetTop - menuPadding;
    const optionBottom = activeOption.offsetTop + activeOption.offsetHeight + menuPadding;
    const visibleTop = mentionMenu.scrollTop;
    const visibleBottom = mentionMenu.scrollTop + mentionMenu.clientHeight;
    if (optionTop < visibleTop) {
      mentionMenu.scrollTop = Math.max(0, optionTop);
      return;
    }
    if (optionBottom > visibleBottom) {
      mentionMenu.scrollTop = Math.max(0, optionBottom - mentionMenu.clientHeight);
    }
  }, [props.mentionIndex, props.mentionMatch]);

  return (
    <div className="tasks-thread-composer-shell question-input agents-composer">
      {props.mentionMatch ? (
        <div
          aria-label={t("tasks.aria.agentMentions")}
          className="tasks-thread-mention-menu"
          data-e2e="tasks-mention-menu"
          ref={mentionMenuRef}
          role="listbox"
        >
          {props.mentionMatch.options.map((option, index) => {
            const previousKind = props.mentionMatch?.options[index - 1]?.kind;
            const startsSection = index > 0 && previousKind !== option.kind;
            return (
            <button
              aria-label={`${option.mention} ${option.label} ${option.description}`.trim()}
              aria-selected={index === props.mentionIndex}
              className={`tasks-thread-mention-option${index === props.mentionIndex ? " is-active" : ""}${startsSection ? " is-section-start" : ""}`}
              data-e2e={`tasks-mention-option-${option.mention.replace(/[^a-z0-9_-]+/gi, "").toLowerCase()}`}
              key={option.mention}
              ref={(node) => {
                mentionOptionRefs.current[index] = node;
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                props.onSelectMention(option);
              }}
              title={`${option.mention} · ${option.label}`}
              type="button"
            >
              <strong>{option.mention}</strong>
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
            );
          })}
        </div>
      ) : null}

      {props.attachedFiles.length > 0 ? (
        <div aria-label="Attached files" className="agents-file-list" data-e2e="tasks-attached-files">
          {props.attachedFiles.map((file) => (
            <span className="agents-file-chip" key={file.id}>
              <span className={`agents-file-chip-name${file.enabled === false ? " is-disabled" : ""}`} title={file.path}>
                {file.name}
              </span>
              <button
                aria-label={`Remove ${file.name}`}
                className="agents-file-chip-remove"
                onClick={() => props.onRemoveAttachedFile(file.id)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div aria-label="Selected agents" className="tasks-thread-selected-mentions" data-e2e="tasks-selected-badges">
          <button
            aria-pressed={props.creativeModeEnabled}
            className={`tasks-thread-selected-mention-chip tasks-thread-creative-mode-toggle${props.creativeModeEnabled ? " is-active" : ""}`}
            data-e2e="tasks-creative-mode-toggle"
            onClick={props.onToggleCreativeMode}
            type="button"
          >
            {props.creativeModeEnabled ? "창의성 모드: ON" : "창의성 모드: OFF"}
          </button>
          {selectedBadges.map((badge) => (
            <span
              className={`tasks-thread-selected-mention-chip${badge.kind === "auto-agent" || badge.kind === "auto-provider" ? " is-auto" : ""}${badge.kind === "provider" || badge.kind === "auto-provider" ? " is-provider" : ""}`}
              key={badge.key}
              title={badge.kind === "auto-agent" || badge.kind === "auto-provider" ? "Orchestrator selected this automatically." : undefined}
            >
              <span>{badge.kind === "auto-agent" || badge.kind === "auto-provider" ? `AUTO: ${badge.label}` : badge.label}</span>
              {badge.kind === "auto-agent" || badge.kind === "auto-provider" ? null : (
                <button
                  aria-label={`Remove ${badge.label}`}
                  onClick={() => {
                    if (badge.kind === "agent" && badge.roleId) {
                      props.onRemoveComposerRole(badge.roleId);
                      return;
                    }
                    if (badge.kind === "provider") {
                      props.onClearComposerProviderOverride();
                      return;
                    }
                    props.onClearCoordinationModeOverride();
                  }}
                  type="button"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>

      <div className="tasks-thread-composer-input-wrap">
        <textarea
          ref={props.composerRef}
          aria-label="Tasks composer"
          className="tasks-thread-composer-input"
          data-e2e="tasks-composer-input"
          disabled={composerDisabled}
          onClick={(event) => props.onComposerCursorChange(event.currentTarget.selectionStart ?? 0)}
          onChange={(event) => props.onComposerDraftChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onKeyDown={props.onComposerKeyDown}
          onKeyUp={(event) => props.onComposerCursorChange(event.currentTarget.selectionStart ?? 0)}
          placeholder={composerPlaceholder}
          rows={1}
          value={props.composerDraft}
        />
      </div>

      <div className="question-input-footer tasks-thread-composer-toolbar">
        <div className="agents-composer-left tasks-thread-composer-controls">
          <button
            aria-label="Attach code files"
            className="agents-icon-button"
            data-e2e="tasks-attach-files"
            disabled={composerDisabled}
            onClick={props.onOpenAttachmentPicker}
            type="button"
          >
            <img alt="" aria-hidden="true" src="/plus-large-svgrepo-com.svg" />
          </button>
          <div className={`agents-model-dropdown${props.isModelMenuOpen ? " is-open" : ""}`} ref={props.modelMenuRef}>
            <button
              aria-label={t("tasks.aria.modelMenu")}
              aria-expanded={props.isModelMenuOpen}
              aria-haspopup="listbox"
              className="agents-model-button"
              data-e2e="tasks-model-trigger"
              disabled={composerDisabled}
              onClick={props.onToggleModelMenu}
              type="button"
            >
              <span>{props.selectedModelOption.label}</span>
              <img alt="" aria-hidden="true" src="/down-arrow.svg" />
            </button>
            {props.isModelMenuOpen ? (
              <ul aria-label={t("tasks.aria.modelMenu")} className="agents-model-menu" data-e2e="tasks-model-menu" role="listbox">
                {visibleModelOptions.map((option) => (
                  <li key={option.value}>
                    <button
                      aria-selected={option.value === props.selectedModelOption.value}
                      className={option.value === props.selectedModelOption.value ? "is-selected" : ""}
                      onClick={() => props.onSetModel(option.value)}
                      role="option"
                      type="button"
                    >
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className={`agents-model-dropdown agents-reason-dropdown${props.isReasonMenuOpen ? " is-open" : ""}`} ref={props.reasonMenuRef}>
            <button
              aria-label={t("tasks.aria.reasoningMenu")}
              aria-expanded={props.isReasonMenuOpen}
              aria-haspopup="listbox"
              className="agents-model-button"
              data-e2e="tasks-reasoning-trigger"
              disabled={composerDisabled}
              onClick={props.onToggleReasonMenu}
              type="button"
            >
              <span>{props.reasoningLabel}</span>
              <img alt="" aria-hidden="true" src="/down-arrow.svg" />
            </button>
            {props.isReasonMenuOpen ? (
              <ul aria-label={t("tasks.aria.reasoningMenu")} className="agents-model-menu" data-e2e="tasks-reasoning-menu" role="listbox">
                {TURN_REASONING_LEVEL_OPTIONS.map((option) => (
                  <li key={option}>
                    <button
                      aria-selected={option === props.reasoning}
                      className={option === props.reasoning ? "is-selected" : ""}
                      onClick={() => props.onSetReasoning(option)}
                      role="option"
                      type="button"
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="agents-composer-actions">
          {props.showStopButton && !props.stoppingComposerRun ? (
            <button
              aria-label={props.stoppingComposerRun ? t("common.loading") : t("tasks.actions.stop")}
              className="agents-stop-button"
              data-e2e="tasks-stop-button"
              disabled={!props.canUseStopButton || props.stoppingComposerRun}
              onClick={props.onStop}
              title={props.stoppingComposerRun ? t("common.loading") : t("tasks.actions.stop")}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/canvas-stop.svg" />
            </button>
          ) : (
            <button
              aria-label={props.stoppingComposerRun ? t("common.loading") : t("tasks.actions.send")}
              className="agents-send-button"
              data-e2e="tasks-send-button"
              disabled={props.stoppingComposerRun || composerDisabled || !canSubmit}
              onClick={props.onSubmit}
              title={props.stoppingComposerRun ? t("common.loading") : t("tasks.actions.send")}
              type="button"
            >
              <img alt="" aria-hidden="true" className="question-create-icon" src="/up.svg" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
