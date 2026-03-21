import { useI18n } from "../../i18n";

type CodexLoginRequiredModalProps = {
  open: boolean;
  onLogin: () => void;
  onOpenSettings: () => void;
};

export default function CodexLoginRequiredModal({
  open,
  onLogin,
  onOpenSettings,
}: CodexLoginRequiredModalProps) {
  const { t } = useI18n();
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop codex-login-required-modal-layer">
      <section className="approval-modal web-turn-modal codex-login-required-modal">
        <h2>{t("modal.codexLoginRequired")}</h2>
        <div>{t("modal.codexLoginRequiredDetail")}</div>
        <div className="button-row">
          <button className="codex-login-required-modal-login" onClick={onLogin} type="button">
            {t("settings.codex.login")}
          </button>
          <button className="codex-login-required-modal-settings" onClick={onOpenSettings} type="button">
            {t("modal.openSettings")}
          </button>
        </div>
      </section>
    </div>
  );
}
