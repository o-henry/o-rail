import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";

type PendingWebConnectModalProps = {
  open: boolean;
  providersLabel: string;
  reason: string;
  onOpenBridgeTab: () => void;
  onContinue: () => void;
  onCancel: () => void;
};

export default function PendingWebConnectModal({
  open,
  providersLabel,
  reason,
  onOpenBridgeTab,
  onContinue,
  onCancel,
}: PendingWebConnectModalProps) {
  const { t } = useI18n();
  if (!open) {
    return null;
  }

  const content = (
    <div className="modal-backdrop">
      <section className="approval-modal web-turn-modal pending-web-connect-modal">
        <h2>{t("modal.webConnectRequired")}</h2>
        <div>{t("modal.service")}: {providersLabel}</div>
        <div>{reason}</div>
        <div>{t("modal.webConnectQuickGuide")}</div>
        <div className="button-row">
          <button onClick={onOpenBridgeTab} type="button">
            {t("modal.openWebConnect")}
          </button>
          <button onClick={onContinue} type="button">
            {t("modal.continueWithoutWebConnect")}
          </button>
          <button onClick={onCancel} type="button">
            {t("common.cancel")}
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
