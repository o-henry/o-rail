import { t as translate } from "../../../i18n";

export function createEngineBridgeHandlers(params: any) {
  function inferLoginStateFromUsage(raw: unknown): boolean | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const record = raw as Record<string, unknown>;
    if (record.requiresOpenaiAuth === true) {
      return false;
    }
    if ("account" in record && record.account == null) {
      return false;
    }
    if ("account" in record && record.account && typeof record.account === "object") {
      return true;
    }
    return null;
  }

  async function ensureEngineStarted() {
    if (params.engineStarted) {
      return;
    }
    const resolvedCwd = String(params.cwd ?? "").trim();
    if (!resolvedCwd || resolvedCwd === ".") {
      throw new Error(translate("bridge.error.cwdRequired"));
    }
    try {
      await params.invokeFn("engine_start", { cwd: resolvedCwd });
      params.setEngineStarted(true);
    } catch (error) {
      if (params.isEngineAlreadyStartedError(error)) {
        params.setEngineStarted(true);
        return;
      }
      throw error;
    }
  }

  async function onStartEngine() {
    params.setError("");
    try {
      await ensureEngineStarted();
      await refreshAuthStateFromEngine(true);
      params.setStatus(translate("bridge.status.ready"));
    } catch (e) {
      if (params.isEngineAlreadyStartedError(e)) {
        params.setEngineStarted(true);
        params.setStatus(translate("bridge.status.ready"));
        return;
      }
      params.setError(params.toErrorText(e));
    }
  }

  async function onStopEngine() {
    params.setError("");
    try {
      await params.invokeFn("engine_stop");
      params.setEngineStarted(false);
      params.markCodexNodesStatusOnEngineIssue("cancelled", translate("bridge.issue.engineStopped"));
      params.setStatus(translate("bridge.status.stopped"));
      params.setRunning(false);
      params.setIsGraphRunning(false);
      params.setUsageInfoText("");
    } catch (e) {
      params.setError(String(e));
    }
  }

  async function refreshAuthStateFromEngine(silent = true) {
    try {
      const result = await params.invokeFn("auth_probe");
      const mode = params.extractAuthMode(result.authMode ?? null) ?? params.extractAuthMode(result.raw ?? null);
      if (mode) {
        params.setAuthMode(mode);
      }

      if (result.state === "authenticated") {
        params.authLoginRequiredProbeCountRef.current = 0;
        params.lastAuthenticatedAtRef.current = Date.now();
        params.setLoginCompleted(true);
        if (!silent) {
          params.setStatus(mode ? translate("bridge.status.authCheckedMode", { mode }) : translate("bridge.status.authChecked"));
        }
      } else if (result.state === "login_required") {
        const now = Date.now();
        const nextProbeCount = params.authLoginRequiredProbeCountRef.current + 1;
        params.authLoginRequiredProbeCountRef.current = nextProbeCount;
        const withinGraceWindow =
          params.lastAuthenticatedAtRef.current > 0 &&
          now - params.lastAuthenticatedAtRef.current < params.authLoginRequiredGraceMs;
        const shouldKeepSession =
          params.lastAuthenticatedAtRef.current > 0 &&
          (withinGraceWindow || nextProbeCount < params.authLoginRequiredConfirmCount);

        if (shouldKeepSession) {
          if (!silent) {
            params.setStatus(translate("bridge.status.keepSession"));
          }
          return result;
        }

        params.setLoginCompleted(false);
        if (!silent) {
          params.setStatus(translate("bridge.status.loginRequired"));
        }
      } else if (!silent) {
        params.setStatus(translate("bridge.status.authCheckNeeded"));
      }

      return result;
    } catch (e) {
      if (!silent) {
        params.setError(String(e));
      }
      return null;
    }
  }

  async function onCheckUsage() {
    params.setError("");
    try {
      await ensureEngineStarted();
      const result = await params.invokeFn("usage_check");
      const mode = params.extractAuthMode(result.authMode ?? null) ?? params.extractAuthMode(result.raw ?? null);
      if (mode) {
        params.setAuthMode(mode);
      }
      const probed = await refreshAuthStateFromEngine(true);
      if (probed?.state === "authenticated") {
        params.setLoginCompleted(true);
      }
      const inferredLogin = inferLoginStateFromUsage(result.raw);
      if (inferredLogin === false && probed?.state !== "authenticated") {
        params.setLoginCompleted(false);
      }
      params.setUsageInfoText(params.formatUsageInfoForDisplay(result.raw));
      params.setUsageResultClosed(false);
      params.setStatus(translate("bridge.status.usageDone"));
    } catch (e) {
      params.setError(params.toUsageCheckErrorMessage(e));
      params.setStatus(translate("bridge.status.usageFailed"));
    }
  }

  async function onLoginCodex() {
    params.setError("");
    if (params.codexAuthBusy) {
      params.setStatus(translate("bridge.status.authBusy"));
      return;
    }
    try {
      if (!params.loginCompleted) {
        const now = Date.now();
        const elapsed = now - params.codexLoginLastAttemptAtRef.current;
        if (elapsed < params.codexLoginCooldownMs) {
          const remainSec = Math.ceil((params.codexLoginCooldownMs - elapsed) / 1000);
          params.setStatus(translate("bridge.status.loginRetry", { seconds: remainSec }));
          return;
        }
        params.codexLoginLastAttemptAtRef.current = now;
      }
      params.setCodexAuthBusy(true);
      await ensureEngineStarted();
      if (params.loginCompleted) {
        await params.invokeFn("logout_codex");
        await params.invokeFn("engine_stop");
        params.setEngineStarted(false);
        await params.invokeFn("engine_start", { cwd: params.cwd });
        params.setEngineStarted(true);
        params.authLoginRequiredProbeCountRef.current = 0;
        params.lastAuthenticatedAtRef.current = 0;
        params.setLoginCompleted(false);
        params.setAuthMode("unknown");
        params.setUsageInfoText("");
        params.setStatus(translate("bridge.status.logoutDone"));
        return;
      }

      const probed = await refreshAuthStateFromEngine(true);
      if (probed?.state === "authenticated") {
        params.authLoginRequiredProbeCountRef.current = 0;
        params.lastAuthenticatedAtRef.current = Date.now();
        params.setLoginCompleted(true);
        params.setStatus(translate("bridge.status.alreadyLoggedIn"));
        return;
      }
      const result = await params.invokeFn("login_chatgpt");
      const authUrl = typeof result?.authUrl === "string" ? result.authUrl.trim() : "";
      if (!authUrl) {
        throw new Error(translate("bridge.error.loginUrlMissing"));
      }
      await params.openUrlFn(authUrl);
      params.setStatus(translate("bridge.status.loginWindowOpened"));
    } catch (e) {
      if (params.loginCompleted) {
        params.setError(translate("bridge.error.logoutFailed", { error: String(e) }));
      } else {
        params.setError(translate("bridge.error.loginStartFailed", { error: String(e) }));
      }
    } finally {
      params.setCodexAuthBusy(false);
    }
  }

  async function onSelectCwdDirectory() {
    params.setError("");
    try {
      const selected = await params.invokeFn("dialog_pick_directory");
      const selectedDirectory = typeof selected === "string" ? selected.trim() : "";
      if (!selectedDirectory) {
        return;
      }
      params.setCwd(selectedDirectory);
      params.setStatus(translate("bridge.status.cwdSelected", { path: selectedDirectory.toLowerCase() }));
    } catch (error) {
      params.setError(translate("bridge.error.cwdSelectFailed", { error: String(error) }));
    }
  }

  async function onOpenPendingProviderWindow() {
    if (!params.pendingWebTurn) {
      return;
    }
    try {
      await params.openUrlFn(params.webProviderHomeUrl(params.pendingWebTurn.provider));
      params.setStatus(translate("bridge.status.providerOpened", { provider: params.webProviderLabel(params.pendingWebTurn.provider) }));
    } catch (error) {
      params.setError(String(error));
    }
  }

  async function onCloseProviderChildView(provider: any) {
    try {
      await params.invokeFn("provider_child_view_hide", { provider });
    } catch (error) {
      const message = String(error);
      if (!message.includes("provider child view not found")) {
        params.setError(translate("bridge.error.hideSessionWindowFailed", {
          provider: params.webProviderLabel(provider),
          error: message,
        }));
        return;
      }
    }

    try {
      await params.invokeFn("provider_window_close", { provider });
    } catch {
      // noop: standalone window not opened
    }

    params.setProviderChildViewOpen((prev: any) => ({ ...prev, [provider]: false }));
    params.setStatus(translate("bridge.status.sessionWindowHidden", { provider: params.webProviderLabel(provider) }));
    void refreshWebWorkerHealth(true);
  }

  async function refreshWebWorkerHealth(silent = false) {
    try {
      const health = await params.invokeFn("web_provider_health");
      params.setWebWorkerHealth(health);
      if (health.bridge) {
        params.setWebBridgeStatus(params.toWebBridgeStatus(health.bridge));
      }
      return health;
    } catch (error) {
      if (!silent) {
        params.setError(translate("bridge.error.workerHealthFailed", { error: String(error) }));
      }
      return null;
    }
  }

  function isBridgeMethodMissing(error: unknown): boolean {
    const message = String(error ?? "").toLowerCase();
    return message.includes("method not found") || message.includes("rpc error -32601");
  }

  async function invokeBridgeRpcWithRecovery(command: "web_bridge_status" | "web_bridge_rotate_token") {
    try {
      return await params.invokeFn(command);
    } catch (error) {
      if (!isBridgeMethodMissing(error)) {
        throw error;
      }
      await params.invokeFn("web_worker_stop").catch(() => {
        // ignore
      });
      await params.invokeFn("web_worker_start");
      return await params.invokeFn(command);
    }
  }

  async function refreshWebBridgeStatus(silent = false, forceRpc = false) {
    if (!forceRpc) {
      const health = await refreshWebWorkerHealth(true);
      if (health?.bridge) {
        const next = params.toWebBridgeStatus(health.bridge);
        params.setWebBridgeStatus(next);
        if (!silent) {
          params.setStatus(translate("bridge.status.refreshDone"));
        }
        return next;
      }
      return null;
    }
    try {
      const raw = await invokeBridgeRpcWithRecovery("web_bridge_status");
      const next = params.toWebBridgeStatus(raw);
      params.setWebBridgeStatus(next);
      if (!silent) {
        params.setStatus(translate("bridge.status.refreshDone"));
      }
      return next;
    } catch (error) {
      if (!silent) {
        params.setError(translate("bridge.error.statusFailed", { error: String(error) }));
      }
      return null;
    }
  }

  async function onRotateWebBridgeToken() {
    params.setWebWorkerBusy(true);
    params.setError("");
    try {
      const raw = await invokeBridgeRpcWithRecovery("web_bridge_rotate_token");
      params.setWebBridgeStatus(params.toWebBridgeStatus(raw));
      params.setStatus(translate("bridge.status.tokenRotated"));
    } catch (error) {
      params.setError(translate("bridge.error.rotateFailed", { error: String(error) }));
    } finally {
      params.setWebWorkerBusy(false);
    }
  }

  async function onRestartWebBridge() {
    params.setError("");
    params.setWebWorkerBusy(true);
    try {
      await params.invokeFn("web_worker_stop");
    } catch {
      // noop
    }
    try {
      await params.invokeFn("web_worker_start");
      params.setStatus(translate("bridge.status.workerRestarted"));
      await refreshWebBridgeStatus(true, true);
      try {
        const bundle = await params.invokeFn("web_bridge_connect_code");
        const maskedCode = typeof bundle?.maskedCode === "string" ? bundle.maskedCode : "";
        if (maskedCode) {
          params.setWebBridgeConnectCode(maskedCode);
        }
      } catch {
        // keep restarted state even if connect code refresh is temporarily unavailable
      }
    } catch (error) {
      params.setError(translate("bridge.error.restartFailed", { error: String(error) }));
    } finally {
      params.setWebWorkerBusy(false);
    }
  }

  async function onCopyWebBridgeConnectCode() {
    try {
      const bundle = await params.invokeFn("web_bridge_connect_code");
      const rawCode = typeof bundle?.code === "string" ? bundle.code : "";
      const maskedCode = typeof bundle?.maskedCode === "string" ? bundle.maskedCode : "";
      if (!rawCode) {
        throw new Error(translate("bridge.error.connectCodeUnavailable"));
      }
      params.setWebBridgeConnectCode(maskedCode);
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(rawCode);
          copied = true;
        }
      } catch {
        // fallback below
      }

      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = rawCode;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      if (copied) {
        params.setStatus(translate("bridge.status.connectCodeCopied"));
        params.setError("");
      } else {
        params.setError(translate("bridge.error.copyDenied"));
      }
    } catch (error) {
      params.setError(translate("bridge.error.copyFailed", { error: String(error) }));
    }
  }

  async function onOpenProviderSession(provider: any) {
    params.setWebWorkerBusy(true);
    params.setError("");
    try {
      const result = await params.invokeFn("web_provider_open_session", { provider });
      if (result && result.ok === false) {
        throw new Error(result.error || result.errorCode || translate("bridge.error.sessionOpenFailed", { provider: params.webProviderLabel(provider), error: "" }));
      }
      await refreshWebWorkerHealth(true);
      window.setTimeout(() => {
        void refreshWebWorkerHealth(true);
      }, 900);
      if (result?.sessionState === "active") {
        params.setStatus(translate("bridge.status.sessionAuthenticated", { provider: params.webProviderLabel(provider) }));
      } else if (result?.sessionState === "login_required") {
        params.setStatus(translate("bridge.status.sessionLoginRequired", { provider: params.webProviderLabel(provider) }));
      } else {
        params.setStatus(translate("bridge.status.sessionWindowOpened", { provider: params.webProviderLabel(provider) }));
      }
    } catch (error) {
      params.setError(translate("bridge.error.sessionOpenFailed", { provider: params.webProviderLabel(provider), error: String(error) }));
    } finally {
      params.setWebWorkerBusy(false);
    }
  }

  return {
    ensureEngineStarted,
    onStartEngine,
    onStopEngine,
    refreshAuthStateFromEngine,
    onCheckUsage,
    onLoginCodex,
    onSelectCwdDirectory,
    onOpenPendingProviderWindow,
    onCloseProviderChildView,
    refreshWebWorkerHealth,
    refreshWebBridgeStatus,
    onRotateWebBridgeToken,
    onRestartWebBridge,
    onCopyWebBridgeConnectCode,
    onOpenProviderSession,
  };
}
