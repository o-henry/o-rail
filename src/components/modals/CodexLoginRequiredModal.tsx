import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";

type CodexLoginRequiredModalProps = {
  open: boolean;
  onLogin: () => void;
};

export default function CodexLoginRequiredModal({
  open,
  onLogin,
}: CodexLoginRequiredModalProps) {
  const { t } = useI18n();
  if (!open) {
    return null;
  }

  const content = (
    <div className="modal-backdrop codex-login-required-modal-layer">
      <section className="approval-modal codex-login-required-modal">
        <h2>{t("modal.codexLoginRequired")}</h2>
        <div>{t("modal.codexLoginRequiredDetail")}</div>
        <div className="button-row">
          <button className="codex-login-required-modal-login" onClick={onLogin} type="button">
            {t("settings.codex.login")}
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
