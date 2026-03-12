import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import type { TurnExecutor } from "../../../features/workflow/domain";
import type { KnowledgeFileRef } from "../../../features/workflow/types";
import { DEFAULT_TURN_REASONING_LEVEL, TURN_REASONING_LEVEL_OPTIONS } from "../../../features/workflow/reasoningLevels";
import {
  DEFAULT_RUNTIME_MODEL_VALUE,
  RUNTIME_MODEL_OPTIONS,
  findRuntimeModelOption,
} from "../../../features/workflow/runtimeModelOptions";

type WorkflowQuestionComposerProps = {
  attachedFiles: KnowledgeFileRef[];
  canRunGraphNow: boolean;
  isWorkflowBusy: boolean;
  onRunGraph: () => Promise<void>;
  onApplyModelSelection: (selection: {
    modelValue: string;
    modelLabel: string;
    executor: TurnExecutor;
    turnModel?: string;
    reasoningLevel?: string;
  }) => void;
  questionInputRef: RefObject<HTMLTextAreaElement | null>;
  setWorkflowQuestion: (value: string) => void;
  workflowQuestion: string;
  onOpenKnowledgeFilePicker: () => void;
  onRemoveKnowledgeFile: (fileId: string) => void;
  onSubmitMessage?: (message: string) => void;
};

export default function WorkflowQuestionComposer({
  attachedFiles,
  canRunGraphNow,
  isWorkflowBusy,
  onRunGraph,
  onApplyModelSelection,
  onOpenKnowledgeFilePicker,
  onRemoveKnowledgeFile,
  questionInputRef,
  setWorkflowQuestion,
  workflowQuestion,
  onSubmitMessage,
}: WorkflowQuestionComposerProps) {
  const { t } = useI18n();
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isReasonMenuOpen, setIsReasonMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_RUNTIME_MODEL_VALUE);
  const [selectedReasonLevel, setSelectedReasonLevel] = useState(DEFAULT_TURN_REASONING_LEVEL);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const reasonMenuRef = useRef<HTMLDivElement | null>(null);
  const modelOptions = useMemo(() => RUNTIME_MODEL_OPTIONS, []);
  const selectedModelOption = useMemo(() => findRuntimeModelOption(selectedModel), [selectedModel]);
  const isReasonLevelSelectable = selectedModelOption.allowsReasonLevel;
  const reasonLevelOptions = useMemo(() => [...TURN_REASONING_LEVEL_OPTIONS], []);
  const hasQuestion = workflowQuestion.trim().length > 0;

  useEffect(() => {
    if (isReasonLevelSelectable) {
      return;
    }
    setIsReasonMenuOpen(false);
  }, [isReasonLevelSelectable]);

  useEffect(() => {
    if (!isModelMenuOpen && !isReasonMenuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
      if (!reasonMenuRef.current?.contains(event.target as Node)) {
        setIsReasonMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isModelMenuOpen, isReasonMenuOpen]);

  const onSubmitWorkflowComposer = () => {
    const text = workflowQuestion.trim();
    if (!text) {
      return;
    }
    if (!canRunGraphNow) {
      return;
    }
    onSubmitMessage?.(text);
    const reasonTag = isReasonLevelSelectable ? selectedReasonLevel : "N/A";
    setWorkflowQuestion(`[model=${selectedModelOption.value}, reason=${reasonTag}] ${text}`);
    window.setTimeout(() => {
      void onRunGraph();
    }, 0);
  };

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!canRunGraphNow || !hasQuestion) {
      return;
    }
    onSubmitWorkflowComposer();
  };

  return (
    <div className="question-input agents-composer workflow-question-input">
      <textarea
        disabled={isWorkflowBusy}
        onChange={(e) => setWorkflowQuestion(e.currentTarget.value)}
        onKeyDown={onComposerKeyDown}
        placeholder={t("workflow.question.placeholder")}
        ref={questionInputRef}
        rows={1}
        value={workflowQuestion}
      />
      {attachedFiles.length > 0 && (
        <div className="agents-file-list" aria-label="Attached files">
          {attachedFiles.map((file) => (
            <span key={file.id} className="agents-file-chip">
              <span
                className={`agents-file-chip-name${file.enabled === false ? " is-disabled" : ""}`}
                title={file.path}
              >
                {file.name}
              </span>
              <button
                aria-label={`${file.name} ${t("common.delete")}`}
                className="agents-file-chip-remove"
                onClick={() => onRemoveKnowledgeFile(file.id)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="question-input-footer">
        <div className="agents-composer-left">
          <button
            aria-label={t("workflow.knowledge.addFile")}
            className="agents-icon-button"
            onClick={onOpenKnowledgeFilePicker}
            type="button"
          >
            <img alt="" aria-hidden="true" src="/plus-large-svgrepo-com.svg" />
          </button>
          <div className={`agents-model-dropdown${isModelMenuOpen ? " is-open" : ""}`} ref={modelMenuRef}>
            <button
              aria-expanded={isModelMenuOpen}
              aria-haspopup="listbox"
              className="agents-model-button"
              onClick={() => setIsModelMenuOpen((prev) => !prev)}
              type="button"
            >
              <span>{selectedModelOption.label}</span>
              <img alt="" aria-hidden="true" src="/down-arrow.svg" />
            </button>
            {isModelMenuOpen && (
              <ul aria-label="Workflow model" className="agents-model-menu" role="listbox">
                {modelOptions.map((option) => (
                  <li key={option.value}>
                    <button
                      aria-selected={option.value === selectedModel}
                      className={option.value === selectedModel ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedModel(option.value);
                        onApplyModelSelection({
                          modelValue: option.value,
                          modelLabel: option.label,
                          executor: option.executor,
                          turnModel: option.turnModel,
                          reasoningLevel: selectedReasonLevel,
                        });
                        setIsModelMenuOpen(false);
                      }}
                      role="option"
                      type="button"
                    >
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={`agents-reason-dropdown${isReasonMenuOpen ? " is-open" : ""}`} ref={reasonMenuRef}>
            <button
              aria-expanded={isReasonMenuOpen}
              aria-haspopup="listbox"
              className="agents-reason-button"
              disabled={!isReasonLevelSelectable}
              onClick={() => {
                if (!isReasonLevelSelectable) {
                  return;
                }
                setIsReasonMenuOpen((prev) => !prev);
              }}
              type="button"
            >
              <span>{isReasonLevelSelectable ? `이성 수준 · ${selectedReasonLevel}` : "이성 수준 · 선택 불가"}</span>
              <img alt="" aria-hidden="true" src="/down-arrow.svg" />
            </button>
            {isReasonMenuOpen && isReasonLevelSelectable && (
              <ul aria-label="Workflow reasoning level" className="agents-reason-menu" role="listbox">
                {reasonLevelOptions.map((level) => (
                  <li key={level}>
                    <button
                      aria-selected={level === selectedReasonLevel}
                      className={level === selectedReasonLevel ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedReasonLevel(level);
                        onApplyModelSelection({
                          modelValue: selectedModelOption.value,
                          modelLabel: selectedModelOption.label,
                          executor: selectedModelOption.executor,
                          turnModel: selectedModelOption.turnModel,
                          reasoningLevel: level,
                        });
                        setIsReasonMenuOpen(false);
                      }}
                      role="option"
                      type="button"
                    >
                      {level}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <button
          className="primary-action question-create-button agents-send-button"
          disabled={!canRunGraphNow || !hasQuestion}
          onClick={onSubmitWorkflowComposer}
          type="button"
        >
          <img alt="" aria-hidden="true" className="question-create-icon" src="/up.svg" />
        </button>
      </div>
    </div>
  );
}
