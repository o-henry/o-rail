import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { CoordinationMode } from "../../features/orchestration/agentic/coordinationTypes";
import { TURN_REASONING_LEVEL_OPTIONS } from "../../features/workflow/reasoningLevels";
import { findRuntimeModelOption, RUNTIME_MODEL_OPTIONS } from "../../features/workflow/runtimeModelOptions";
import { useI18n } from "../../i18n";
import type { TaskAgentMentionMatch, TaskAgentMentionOption } from "./taskAgentMentions";
import { getTaskAgentLabel, stripCoordinationModeTags } from "./taskAgentPresets";
import type { ThreadRoleId } from "./threadTypes";
import type { TasksWebProviderStatus } from "./useTasksWebProviderStatus";

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
  composerProviderOverrides?: string[];
  providerStatuses?: TasksWebProviderStatus[];
  providerStatusPending?: boolean;
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
  onOpenProviderSession: (provider: string) => void;
  onRefreshProviderStatuses: () => void;
  onSetModel: (value: string) => void;
  onToggleModelMenu: () => void;
  onSetReasoning: (value: string) => void;
  onToggleReasonMenu: () => void;
  onClearComposerProviderOverrides: () => void;
  onToggleCreativeMode: () => void;
  onRemoveComposerProvider: (value: string) => void;
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
  providerValues?: string[];
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
  const providerValues = [...new Set((params.providerValues ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  for (const providerValue of providerValues) {
    badges.push({
      key: `provider:${providerValue}`,
      kind: "provider",
      label: composerProviderLabel(providerValue),
      value: providerValue,
    });
  }
  const autoProviderValue = String(params.autoProviderValue ?? "").trim();
  if (autoProviderValue && !providerValues.includes(autoProviderValue)) {
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
    providerValues: props.composerProviderOverrides,
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
    <>
      {(props.providerStatuses?.length ?? 0) > 0 ? (
        <div
          aria-label="웹 AI provider 상태"
          id="tasks-provider-status-strip"
          className="tasks-thread-provider-status-strip"
          data-e2e="tasks-provider-status-strip"
          role="region"
        >
          {props.providerStatuses?.map((status) => (
            <div
              aria-label={`${status.label} 상태 ${status.message}`}
              className={`tasks-thread-provider-status-card is-${status.state}`}
              data-e2e={`tasks-provider-status-card-${status.provider}`}
              key={status.provider}
              role="group"
              title={status.url || status.message}
            >
              <strong>{status.label}</strong>
              <span>{status.message}</span>
              <div className="tasks-thread-provider-status-actions">
                <button
                  aria-label={`${status.label} 세션 열기`}
                  data-e2e={`tasks-provider-open-${status.provider}`}
                  onClick={() => props.onOpenProviderSession(status.provider)}
                  type="button"
                >
                  세션 열기
                </button>
                <button
                  aria-label={`${status.label} 상태 새로고침`}
                  className="tasks-thread-provider-status-refresh"
                  data-e2e={`tasks-provider-refresh-${status.provider}`}
                  disabled={props.providerStatusPending}
                  onClick={props.onRefreshProviderStatuses}
                  title="상태 새로고침"
                  type="button"
                >
                  <img alt="" aria-hidden="true" src="/reload.svg" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div
        aria-label="Tasks 질문 작성기"
        className="tasks-thread-composer-shell question-input agents-composer"
        data-e2e="tasks-composer-shell"
        role="region"
      >
      {props.mentionMatch ? (
        <div
          aria-label={t("tasks.aria.agentMentions")}
          className="tasks-thread-mention-menu"
          data-e2e="tasks-mention-menu"
          id="tasks-mention-menu"
          ref={mentionMenuRef}
          role="listbox"
        >
          {props.mentionMatch.options.map((option, index) => {
            const previousKind = props.mentionMatch?.options[index - 1]?.kind;
            const startsSection = index > 0 && previousKind !== option.kind;
            return (
            <button
              aria-label={`${option.mention} ${option.label} ${option.description}`.trim()}
              id={`tasks-mention-option-${option.mention.replace(/[^a-z0-9_-]+/gi, "").toLowerCase()}`}
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
        <div aria-label="첨부 파일 목록" className="agents-file-list" data-e2e="tasks-attached-files">
          {props.attachedFiles.map((file) => (
            <span aria-label={`${file.name} 첨부 파일`} className="agents-file-chip" data-e2e={`tasks-attached-file-${file.id}`} key={file.id}>
              <span className={`agents-file-chip-name${file.enabled === false ? " is-disabled" : ""}`} title={file.path}>
                {file.name}
              </span>
              <button
                aria-label={`${file.name} 첨부 파일 제거`}
                className="agents-file-chip-remove"
                data-e2e={`tasks-attached-file-remove-${file.id}`}
                onClick={() => props.onRemoveAttachedFile(file.id)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div aria-label="선택된 에이전트 및 provider" className="tasks-thread-selected-mentions" data-e2e="tasks-selected-badges">
          <button
            aria-label={props.creativeModeEnabled ? "창의성 모드 켜짐, 끄기" : "창의성 모드 꺼짐, 켜기"}
            aria-pressed={props.creativeModeEnabled}
            className={`tasks-thread-selected-mention-chip tasks-thread-creative-mode-toggle${props.creativeModeEnabled ? " is-active" : ""}`}
            data-e2e="tasks-creative-mode-toggle"
            onClick={props.onToggleCreativeMode}
            title={props.creativeModeEnabled ? "창의성 모드 켜짐, 끄기" : "창의성 모드 꺼짐, 켜기"}
            type="button"
          >
            {props.creativeModeEnabled ? "창의성 모드: ON" : "창의성 모드: OFF"}
          </button>
          {selectedBadges.map((badge) => (
            <span
              aria-label={`${badge.kind === "auto-agent" || badge.kind === "auto-provider" ? "자동 선택" : "선택됨"} ${badge.label}`}
              className={`tasks-thread-selected-mention-chip${badge.kind === "auto-agent" || badge.kind === "auto-provider" ? " is-auto" : ""}${badge.kind === "provider" || badge.kind === "auto-provider" ? " is-provider" : ""}`}
              data-e2e={`tasks-selected-badge-${badge.key.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`}
              key={badge.key}
              role="group"
              title={badge.kind === "auto-agent" || badge.kind === "auto-provider" ? "Orchestrator selected this automatically." : undefined}
            >
              <span>{badge.kind === "auto-agent" || badge.kind === "auto-provider" ? `AUTO: ${badge.label}` : badge.label}</span>
              {badge.kind === "auto-agent" || badge.kind === "auto-provider" ? null : (
                <button
                  aria-label={`${badge.label} 제거`}
                  data-e2e={`tasks-selected-badge-remove-${badge.key.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`}
                  onClick={() => {
                    if (badge.kind === "agent" && badge.roleId) {
                      props.onRemoveComposerRole(badge.roleId);
                      return;
                    }
                    if (badge.kind === "provider") {
                      props.onRemoveComposerProvider(badge.value ?? "");
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
      <div aria-label="질문 입력 영역" className="tasks-thread-composer-input-wrap" role="group">
        <textarea
          ref={props.composerRef}
          aria-label="Tasks 질문 입력"
          aria-autocomplete="list"
          aria-controls={props.mentionMatch ? "tasks-mention-menu" : undefined}
          aria-expanded={Boolean(props.mentionMatch)}
          className="tasks-thread-composer-input"
          data-e2e="tasks-composer-input"
          id="tasks-composer-input"
          name="tasks-composer-input"
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

      <div aria-label="질문 작성 도구막대" className="question-input-footer tasks-thread-composer-toolbar" role="group">
        <div aria-label="모델 및 파일 제어" className="agents-composer-left tasks-thread-composer-controls" role="group">
          <button
            aria-label="코드 파일 첨부"
            className="agents-icon-button"
            data-e2e="tasks-attach-files"
            disabled={composerDisabled}
            onClick={props.onOpenAttachmentPicker}
            type="button"
          >
            <img alt="" aria-hidden="true" src="/plus-large-svgrepo-com.svg" />
          </button>
          <div aria-label="모델 선택 드롭다운" className={`agents-model-dropdown${props.isModelMenuOpen ? " is-open" : ""}`} data-e2e="tasks-model-dropdown" ref={props.modelMenuRef} role="group">
            <button
              aria-label={t("tasks.aria.modelMenu")}
              aria-controls="tasks-model-menu"
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
              <ul aria-label={t("tasks.aria.modelMenu")} className="agents-model-menu" data-e2e="tasks-model-menu" id="tasks-model-menu" role="listbox">
                {visibleModelOptions.map((option) => (
                  <li data-e2e={`tasks-model-option-row-${option.value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`} key={option.value}>
                    <button
                      aria-label={`${option.label} 모델 선택`}
                      aria-selected={option.value === props.selectedModelOption.value}
                      className={option.value === props.selectedModelOption.value ? "is-selected" : ""}
                      data-e2e={`tasks-model-option-${option.value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`}
                      id={`tasks-model-option-${option.value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`}
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
          <div aria-label="추론 강도 선택 드롭다운" className={`agents-model-dropdown agents-reason-dropdown${props.isReasonMenuOpen ? " is-open" : ""}`} data-e2e="tasks-reasoning-dropdown" ref={props.reasonMenuRef} role="group">
            <button
              aria-label={t("tasks.aria.reasoningMenu")}
              aria-controls="tasks-reasoning-menu"
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
              <ul aria-label={t("tasks.aria.reasoningMenu")} className="agents-model-menu" data-e2e="tasks-reasoning-menu" id="tasks-reasoning-menu" role="listbox">
                {TURN_REASONING_LEVEL_OPTIONS.map((option) => (
                  <li data-e2e={`tasks-reasoning-option-row-${option.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`} key={option}>
                    <button
                      aria-label={`${option} 추론 강도 선택`}
                      aria-selected={option === props.reasoning}
                      className={option === props.reasoning ? "is-selected" : ""}
                      data-e2e={`tasks-reasoning-option-${option.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`}
                      id={`tasks-reasoning-option-${option.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`}
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

        <div aria-label="질문 전송 제어" className="agents-composer-actions" role="group">
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
    </>
  );
}
