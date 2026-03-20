import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { CoordinationMode } from "../../features/orchestration/agentic/coordinationTypes";
import { TURN_REASONING_LEVEL_OPTIONS } from "../../features/workflow/reasoningLevels";
import { RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";
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
};

type TasksThreadComposerProps = {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  reasonMenuRef: RefObject<HTMLDivElement | null>;
  mentionMatch: TaskAgentMentionMatch | null;
  mentionIndex: number;
  attachedFiles: AttachedFile[];
  selectedComposerRoleIds: ThreadRoleId[];
  composerCoordinationModeOverride: CoordinationMode | null;
  composerDraft: string;
  selectedModelOption: RuntimeModelOption;
  isModelMenuOpen: boolean;
  isReasonMenuOpen: boolean;
  reasoning: string;
  reasoningLabel: string;
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
  onSubmit: () => void;
  onStop: () => void;
};

export function canSubmitTasksComposer(input: string | null | undefined): boolean {
  return Boolean(stripCoordinationModeTags(String(input ?? "")).trim());
}

type SelectedTasksComposerBadge = {
  key: string;
  kind: "agent" | "mode";
  label: string;
  roleId?: ThreadRoleId;
  mode?: CoordinationMode;
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

export function buildSelectedTasksComposerBadges(params: {
  roleIds: ThreadRoleId[];
  modeOverride: CoordinationMode | null;
}): SelectedTasksComposerBadge[] {
  const badges: SelectedTasksComposerBadge[] = params.roleIds.map((roleId) => ({
    key: `agent:${roleId}`,
    kind: "agent",
    label: getTaskAgentLabel(roleId),
    roleId,
  }));
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
  const canSubmit = canSubmitTasksComposer(props.composerDraft);
  const selectedBadges = buildSelectedTasksComposerBadges({
    roleIds: props.selectedComposerRoleIds,
    modeOverride: props.composerCoordinationModeOverride,
  });

  return (
    <div className="tasks-thread-composer-shell question-input agents-composer">
      {props.mentionMatch ? (
        <div aria-label={t("tasks.aria.agentMentions")} className="tasks-thread-mention-menu" role="listbox">
          {props.mentionMatch.options.map((option, index) => {
            const startsModeSection = option.kind === "mode" && props.mentionMatch?.options[index - 1]?.kind !== "mode";
            return (
            <button
              aria-selected={index === props.mentionIndex}
              className={`tasks-thread-mention-option${index === props.mentionIndex ? " is-active" : ""}${startsModeSection ? " is-mode-section-start" : ""}`}
              key={option.mention}
              onMouseDown={(event) => {
                event.preventDefault();
                props.onSelectMention(option);
              }}
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
        <div aria-label="Attached files" className="agents-file-list">
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

      {selectedBadges.length > 0 ? (
        <div aria-label="Selected agents" className="tasks-thread-selected-mentions">
          {selectedBadges.map((badge) => (
            <span className="tasks-thread-selected-mention-chip" key={badge.key}>
              <span>{badge.label}</span>
              <button
                aria-label={`Remove ${badge.label}`}
                onClick={() => {
                  if (badge.kind === "agent" && badge.roleId) {
                    props.onRemoveComposerRole(badge.roleId);
                    return;
                  }
                  props.onClearCoordinationModeOverride();
                }}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="tasks-thread-composer-input-wrap">
        <textarea
          ref={props.composerRef}
          aria-label="Tasks composer"
          className="tasks-thread-composer-input"
          onClick={(event) => props.onComposerCursorChange(event.currentTarget.selectionStart ?? 0)}
          onChange={(event) => props.onComposerDraftChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onKeyDown={props.onComposerKeyDown}
          onKeyUp={(event) => props.onComposerCursorChange(event.currentTarget.selectionStart ?? 0)}
          placeholder={t("tasks.composer.placeholder")}
          rows={1}
          value={props.composerDraft}
        />
      </div>

      <div className="question-input-footer tasks-thread-composer-toolbar">
        <div className="agents-composer-left tasks-thread-composer-controls">
          <button
            aria-label="Attach code files"
            className="agents-icon-button"
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
              onClick={props.onToggleModelMenu}
              type="button"
            >
              <span>{props.selectedModelOption.label}</span>
              <img alt="" aria-hidden="true" src="/down-arrow.svg" />
            </button>
            {props.isModelMenuOpen ? (
              <ul aria-label={t("tasks.aria.modelMenu")} className="agents-model-menu" role="listbox">
                {RUNTIME_MODEL_OPTIONS.map((option) => (
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
              onClick={props.onToggleReasonMenu}
              type="button"
            >
              <span>{props.reasoningLabel}</span>
              <img alt="" aria-hidden="true" src="/down-arrow.svg" />
            </button>
            {props.isReasonMenuOpen ? (
              <ul aria-label={t("tasks.aria.reasoningMenu")} className="agents-model-menu" role="listbox">
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
          {props.canInterruptCurrentThread ? (
            <button
              aria-label={props.stoppingComposerRun ? t("common.loading") : t("tasks.actions.stop")}
              className="agents-stop-button"
              disabled={props.stoppingComposerRun}
              onClick={props.onStop}
              type="button"
            >
              <img alt="" aria-hidden="true" src="/canvas-stop.svg" />
            </button>
          ) : (
            <button
              aria-label={t("tasks.actions.send")}
              className="agents-send-button"
              disabled={!canSubmit}
              onClick={props.onSubmit}
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
