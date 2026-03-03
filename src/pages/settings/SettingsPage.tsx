import { type ChangeEvent, useRef } from "react";
import FancySelect from "../../components/FancySelect";
import { useI18n } from "../../i18n";

type SettingsPageProps = {
  compact?: boolean;
  engineStarted: boolean;
  loginCompleted: boolean;
  authModeText: string;
  cwd: string;
  codexMultiAgentMode: string;
  codexMultiAgentModeOptions: ReadonlyArray<{ value: string; label: string }>;
  userBackgroundImage: string;
  userBackgroundOpacity: number;
  status: string;
  usageInfoText: string;
  usageResultClosed: boolean;
  running: boolean;
  isGraphRunning: boolean;
  codexAuthBusy: boolean;
  onSelectCwdDirectory: () => void;
  onSetCodexMultiAgentMode: (next: string) => void;
  onSetUserBackgroundImage: (next: string) => void;
  onSetUserBackgroundOpacity: (next: number) => void;
  onToggleCodexLogin: () => void;
  onCloseUsageResult: () => void;
  onOpenRunsFolder: () => void;
};

export default function SettingsPage({
  compact = false,
  engineStarted,
  loginCompleted,
  authModeText,
  cwd,
  codexMultiAgentMode,
  codexMultiAgentModeOptions,
  userBackgroundImage,
  userBackgroundOpacity,
  status,
  usageInfoText,
  usageResultClosed,
  running,
  isGraphRunning,
  codexAuthBusy,
  onSelectCwdDirectory,
  onSetCodexMultiAgentMode,
  onSetUserBackgroundImage,
  onSetUserBackgroundOpacity,
  onToggleCodexLogin,
  onCloseUsageResult,
  onOpenRunsFolder,
}: SettingsPageProps) {
  const { t } = useI18n();
  const backgroundFileInputRef = useRef<HTMLInputElement | null>(null);

  const onOpenBackgroundFilePicker = () => {
    backgroundFileInputRef.current?.click();
  };

  const onBackgroundFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onSetUserBackgroundImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  return (
    <section className={`controls ${compact ? "settings-compact" : ""}`}>
      <h3>{t("settings.title")}</h3>
      {!compact && (
        <div className="settings-badges">
          <span className={`status-tag ${engineStarted ? "on" : "off"}`}>
            {engineStarted ? t("settings.engine.connected") : t("settings.engine.waiting")}
          </span>
          <span className={`status-tag ${loginCompleted ? "on" : "off"}`}>
            {loginCompleted ? t("settings.login.done") : t("settings.login.required")}
          </span>
          <span className="status-tag neutral">{t("settings.auth.prefix")}: {authModeText}</span>
        </div>
      )}
      {!compact && (
        <label className="settings-codex-controls">
          <span>코덱스</span>
          <div className="button-row">
            <button
              className="settings-usage-button settings-account-button"
              disabled={running || isGraphRunning || codexAuthBusy}
              onClick={onToggleCodexLogin}
              type="button"
            >
              <span className="settings-button-label">
                {codexAuthBusy
                  ? t("settings.processing")
                  : loginCompleted
                    ? t("settings.codex.logout")
                    : t("settings.codex.login")}
              </span>
            </button>
          </div>
        </label>
      )}
      <label>
        {t("settings.cwd")}
        <div className="settings-cwd-row">
          <input className="lowercase-path-input" readOnly value={cwd} />
          <button className="settings-cwd-picker" onClick={onSelectCwdDirectory} type="button">
            {t("settings.pickFolder")}
          </button>
        </div>
      </label>
      <label>
        {t("settings.multiAgentMode")}
        <FancySelect
          ariaLabel={t("settings.multiAgentMode")}
          className="modern-select settings-multiagent-select"
          onChange={onSetCodexMultiAgentMode}
          options={[...codexMultiAgentModeOptions]}
          value={codexMultiAgentMode}
        />
      </label>
      <label className="settings-background-controls">
        {t("settings.backgroundImage")}
        <input
          className="settings-background-file-input"
          onChange={onBackgroundFileChange}
          ref={backgroundFileInputRef}
          type="file"
          accept="image/*"
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className="settings-background-row">
          <input
            className="lowercase-path-input settings-background-name"
            placeholder="https://... / data:image..."
            value={userBackgroundImage}
            onChange={(event) => onSetUserBackgroundImage(event.currentTarget.value)}
          />
          <button className="settings-cwd-picker" onClick={onOpenBackgroundFilePicker} type="button">
            {t("settings.backgroundImage.pick")}
          </button>
          <button className="settings-cwd-picker" onClick={() => onSetUserBackgroundImage("")} type="button">
            {t("common.delete")}
          </button>
          <input
            aria-label="Background opacity"
            className="settings-opacity-input"
            min={0}
            max={1}
            onChange={(event) => onSetUserBackgroundOpacity(Number(event.currentTarget.value))}
            step={0.05}
            type="number"
            value={userBackgroundOpacity}
          />
        </div>
      </label>
      <div className="usage-method usage-method-hidden">{t("settings.recentStatus")}: {status}</div>
      {usageInfoText && !usageResultClosed && (
        <div className="usage-result">
          <div className="usage-result-head">
            <button onClick={onCloseUsageResult} type="button">
              {t("common.close")}
            </button>
          </div>
          <pre>{usageInfoText}</pre>
        </div>
      )}
      {!compact && (
        <section className="settings-run-history settings-run-history-hidden">
          <div className="settings-run-history-head">
            <h3>LOG</h3>
            <button onClick={onOpenRunsFolder} type="button">
              {t("common.open")}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
