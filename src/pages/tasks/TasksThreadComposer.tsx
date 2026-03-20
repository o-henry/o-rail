import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { TURN_REASONING_LEVEL_OPTIONS } from "../../features/workflow/reasoningLevels";
import { RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";
import { useI18n } from "../../i18n";
import { getTaskAgentLabel } from "./taskAgentPresets";
import type { ThreadRoleId } from "./threadTypes";

type MentionOption = {
  presetId: ThreadRoleId;
  mention: string;
  label: string;
};

type MentionMatch = {
  query: string;
  rangeStart: number;
  options: MentionOption[];
};

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
  mentionMatch: MentionMatch | null;
  mentionIndex: number;
  attachedFiles: AttachedFile[];
  selectedComposerRoleIds: ThreadRoleId[];
  composerDraft: string;
  selectedModelOption: RuntimeModelOption;
  isModelMenuOpen: boolean;
  isReasonMenuOpen: boolean;
  reasoning: string;
  reasoningLabel: string;
  canInterruptCurrentThread: boolean;
  stoppingComposerRun: boolean;
  onSelectMention: (presetId: ThreadRoleId) => void;
  onRemoveAttachedFile: (id: string) => void;
  onRemoveComposerRole: (roleId: ThreadRoleId) => void;
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

export function TasksThreadComposer(props: TasksThreadComposerProps) {
  const { t } = useI18n();

  return (
    <div className="tasks-thread-composer-shell question-input agents-composer">
      {props.mentionMatch ? (
        <div aria-label={t("tasks.aria.agentMentions")} className="tasks-thread-mention-menu" role="listbox">
          {props.mentionMatch.options.map((option, index) => (
            <button
              aria-selected={index === props.mentionIndex}
              className={`tasks-thread-mention-option${index === props.mentionIndex ? " is-active" : ""}`}
              key={option.presetId}
              onMouseDown={(event) => {
                event.preventDefault();
                props.onSelectMention(option.presetId);
              }}
              type="button"
            >
              <strong>{option.mention}</strong>
              <span>{option.label}</span>
            </button>
          ))}
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

      {props.selectedComposerRoleIds.length > 0 ? (
        <div aria-label="Selected agents" className="tasks-thread-selected-mentions">
          {props.selectedComposerRoleIds.map((roleId) => (
            <span className="tasks-thread-selected-mention-chip" key={roleId}>
              <span>{getTaskAgentLabel(roleId)}</span>
              <button
                aria-label={`Remove ${getTaskAgentLabel(roleId)}`}
                onClick={() => props.onRemoveComposerRole(roleId)}
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

          <div className={`agents-reason-dropdown${props.isReasonMenuOpen ? " is-open" : ""}`} ref={props.reasonMenuRef}>
            <button
              aria-label={t("tasks.aria.reasoningMenu")}
              aria-expanded={props.isReasonMenuOpen}
              aria-haspopup="listbox"
              className="agents-reason-button"
              onClick={props.onToggleReasonMenu}
              type="button"
            >
              <span>{props.reasoningLabel}</span>
              <img alt="" aria-hidden="true" src="/down-arrow.svg" />
            </button>
            {props.isReasonMenuOpen ? (
              <ul aria-label={t("tasks.aria.reasoningMenu")} className="agents-reason-menu" role="listbox">
                {TURN_REASONING_LEVEL_OPTIONS.map((level) => (
                  <li key={level}>
                    <button
                      aria-selected={level === props.reasoning}
                      className={level === props.reasoning ? "is-selected" : ""}
                      onClick={() => props.onSetReasoning(level)}
                      role="option"
                      type="button"
                    >
                      {level}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="tasks-thread-composer-actions">
          <button
            aria-label={props.canInterruptCurrentThread ? t("tasks.aria.stop") : t("tasks.aria.send")}
            className="primary-action question-create-button agents-send-button"
            disabled={props.canInterruptCurrentThread ? props.stoppingComposerRun : !props.composerDraft.trim()}
            onClick={props.canInterruptCurrentThread ? props.onStop : props.onSubmit}
            type="button"
          >
            <img
              alt=""
              aria-hidden="true"
              className="question-create-icon"
              src={props.canInterruptCurrentThread ? "/canvas-stop.svg" : "/up.svg"}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
