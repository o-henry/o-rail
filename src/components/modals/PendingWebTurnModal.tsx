import { createPortal } from "react-dom";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useI18n } from "../../i18n";

type PendingWebTurnModalProps = {
  open: boolean;
  preview?: boolean;
  nodeId: string;
  providerLabel: string;
  modeLabel: string;
  prompt: string;
  responseDraft: string;
  dragging: boolean;
  position: { x: number; y: number };
  panelRef: RefObject<HTMLElement | null>;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onChangeResponseDraft: (next: string) => void;
  onOpenProviderWindow: () => void;
  onCopyPrompt: () => void;
  onSubmit: () => void;
  onDismiss: () => void;
  onCancelRun: () => void;
};

export default function PendingWebTurnModal({
  open,
  preview = false,
  nodeId,
  providerLabel,
  modeLabel,
  prompt,
  responseDraft,
  dragging,
  position,
  panelRef,
  onDragStart,
  onChangeResponseDraft,
  onOpenProviderWindow,
  onCopyPrompt,
  onSubmit,
  onDismiss,
  onCancelRun,
}: PendingWebTurnModalProps) {
  const { t } = useI18n();
  if (!open) {
    return null;
  }

  const content = (
    <div className="web-turn-modal-layer">
      <section
        className={`approval-modal web-turn-modal web-turn-floating${dragging ? " is-dragging" : ""}${preview ? " is-preview" : ""}`}
        ref={panelRef}
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
      >
        <div className="web-turn-drag-handle" onPointerDown={onDragStart}>
          <h4>{t("modal.webInput.title")}</h4>
          <div className="web-turn-drag-actions">
            <span>{preview ? "PREVIEW" : "➠"}</span>
            <button
              aria-label={t("common.close")}
              className="web-turn-close-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDismiss();
              }}
              type="button"
            >
              ×
            </button>
          </div>
        </div>
        <div>{t("modal.node")}: {nodeId}</div>
        <div>{t("modal.service")}: {providerLabel}</div>
        <div>{t("modal.collectMode")}: {modeLabel}</div>
        <div className="button-row">
          <button className="web-turn-action-open" onClick={onOpenProviderWindow} type="button">
            {t("modal.openServiceWindow")}
          </button>
          <button className="web-turn-action-copy" onClick={onCopyPrompt} type="button">
            {t("modal.copyPrompt")}
          </button>
        </div>
        <div className="web-turn-prompt">{prompt}</div>
        <label>
          {t("modal.paste")}
          <textarea onChange={(e) => onChangeResponseDraft(e.currentTarget.value)} rows={8} value={responseDraft} />
        </label>
        <div className="button-row">
          <button className="web-turn-action-submit" onClick={onSubmit} type="button">
            {t("modal.inputDone")}
          </button>
          <button className="web-turn-action-dismiss" onClick={onDismiss} type="button">
            {t("common.cancel")}
          </button>
          <button className="web-turn-action-stop" onClick={onCancelRun} type="button">
            {t("modal.cancelRun")}
          </button>
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}
