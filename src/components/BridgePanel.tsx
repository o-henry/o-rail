import { useI18n } from "../i18n";
import UserMemoryPanel from "./UserMemoryPanel";

type WebBridgeProviderSeen = {
  provider: string;
  pageUrl?: string | null;
  lastSeenAt?: string | null;
};

type WebBridgeStatus = {
  running: boolean;
  port: number;
  tokenMasked: string;
  tokenStorage?: string;
  extensionOriginAllowlistConfigured?: boolean;
  allowedExtensionOriginCount?: number;
  connectedProviders: WebBridgeProviderSeen[];
  queuedTasks: number;
  activeTasks: number;
};

type BridgePanelProps = {
  status: WebBridgeStatus;
  connectCode: string;
  busy: boolean;
  embedded?: boolean;
  onRefreshStatus: () => void;
  onCopyConnectCode: () => void;
  onRestartBridge: () => void;
};

function normalizeConnectCode(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw.replace(/\s+/g, " ").trim();
  }
}

function BridgePanel({
  status,
  connectCode,
  busy,
  embedded = false,
  onRefreshStatus,
  onCopyConnectCode,
  onRestartBridge,
}: BridgePanelProps) {
  const { t } = useI18n();
  const bridgeUrl = `http://127.0.0.1:${status.port}`;
  const displayConnectCode = normalizeConnectCode(connectCode);
  const connectCodeFontSize =
    displayConnectCode.length > 150
      ? "10px"
      : displayConnectCode.length > 120
        ? "11px"
        : "12px";

  const content = (
    <>
      <section className="controls bridge-head-panel">
        <div className="web-automation-head">
          <div className="bridge-head-title-row">
            <h2>{t("bridge.title")}</h2>
            <div className="bridge-help-wrap">
              <button
                aria-label={t("bridge.help.aria")}
                className="bridge-help-trigger"
                type="button"
              >
                ?
              </button>
              <div className="bridge-help-panel">
                <div>{t("bridge.help.1")}</div>
                <div>
                  {t("bridge.help.2.prefix")}{" "}
                  {status.tokenStorage === "memory" ? t("bridge.help.2.memory") : t("bridge.help.2.unknown")}
                </div>
                <div>{t("bridge.help.3")}</div>
                <div>{t("bridge.help.4")}</div>
              </div>
            </div>
          </div>
          <div className="bridge-head-actions">
            <button
              aria-label={t("bridge.refresh.aria")}
              className="settings-refresh-button settings-refresh-icon-button"
              disabled={busy}
              onClick={onRefreshStatus}
              title={t("bridge.refresh.title")}
              type="button"
            >
              <img alt="" aria-hidden="true" className="settings-refresh-icon" src="/reload.svg" />
              <span className="settings-refresh-label">{t("bridge.refresh.short")}</span>
            </button>
            <button
              className="settings-account-button bridge-head-action-button"
              disabled={busy}
              onClick={onCopyConnectCode}
              type="button"
            >
              <span className="settings-button-label">{t("bridge.copyCode")}</span>
            </button>
            <button
              className="settings-account-button bridge-head-action-button"
              disabled={busy}
              onClick={onRestartBridge}
              type="button"
            >
              <span className="settings-button-label">{t("bridge.restart.short")}</span>
            </button>
          </div>
        </div>
        <div className="settings-badges">
          <span className={`status-tag ${status.running ? "on" : "off"}`}>
            {status.running ? t("bridge.ready") : t("bridge.stopped")}
          </span>
          <span className="status-tag neutral">{t("bridge.endpoint")}: {bridgeUrl}</span>
          <span
            className={`status-tag ${
              status.extensionOriginAllowlistConfigured ? "on" : "off"
            }`}
          >
            {status.extensionOriginAllowlistConfigured
              ? t("bridge.allowlist.count", { count: status.allowedExtensionOriginCount ?? 0 })
              : t("bridge.tokenMode")}
          </span>
        </div>
        {displayConnectCode && (
          <div className="bridge-code-card">
            <div className="bridge-code-head">
              <span>{t("bridge.connectCode")}</span>
              <button
                className="settings-account-button"
                disabled={busy}
                onClick={onCopyConnectCode}
                type="button"
              >
                <span className="settings-button-label">{t("bridge.copyAgain")}</span>
              </button>
            </div>
            <textarea
              className="bridge-code-textarea"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              rows={1}
              style={{ fontSize: connectCodeFontSize }}
              wrap="off"
              value={displayConnectCode}
            />
          </div>
        )}
      </section>

      {/* <section className="controls bridge-provider-panel">
        <h2>서비스 감지 상태</h2>
        <div className="provider-hub-list">
          {WEB_PROVIDER_OPTIONS.map((provider) => {
            const row = providerSeenMap.get(provider);
            const seenLabel = row?.lastSeenAt ? formatRunDateTime(row.lastSeenAt) : "";
            return (
              <div className="provider-hub-row" key={`bridge-provider-${provider}`}>
                <div className="provider-hub-meta">
                  <span className={`provider-session-pill ${row ? "connected" : "unknown"}`}>
                    <span className="provider-session-label">{row ? "연결됨" : "대기"}</span>
                  </span>
                  <span className="provider-hub-name">{webProviderLabel(provider)}</span>
                </div>
                <div className="bridge-provider-meta">
                  {seenLabel ? <span>{seenLabel}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="bridge-provider-queue-meta">
          큐: {status.queuedTasks} · 진행 중: {status.activeTasks}
        </div>
      </section> */}

      {/* <section className="controls bridge-log-panel">
        <h2>최근 수집 이벤트</h2>
        <div className="bridge-log-list">
          {logs.length === 0 && <div className="log-empty">최근 이벤트 없음</div>}
          {logs.map((line, index) => (
            <div className="bridge-log-line" key={`bridge-log-${index}`}>
              {line}
            </div>
          ))}
        </div>
      </section> */}

      <UserMemoryPanel />
    </>
  );

  if (embedded) {
    return <section className="bridge-embedded">{content}</section>;
  }

  return (
    <section className="panel-card settings-view bridge-view workspace-tab-panel">
      {content}
    </section>
  );
}

export default BridgePanel;
