import { useEffect } from "react";

export function useMainAppRuntimeEffects(params: any) {
  useEffect(() => {
    return () => {
      for (const timerId of Object.values(params.webBridgeStageWarnTimerRef.current)) {
        window.clearTimeout(timerId as number);
      }
      params.webBridgeStageWarnTimerRef.current = {};
    };
  }, []);

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      params.reportSoftError("unhandled rejection", event.reason);
    };
    const onWindowError = (event: ErrorEvent) => {
      params.reportSoftError("runtime error", event.error ?? event.message);
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onWindowError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onWindowError);
    };
  }, []);

  useEffect(() => {
    params.refreshGraphFiles();
    params.refreshFeedTimeline();
  }, []);

  useEffect(() => {
    params.setStatus("대기 중");
    return () => {
      for (const timerId of Object.values(params.feedReplyFeedbackClearTimerRef.current)) {
        window.clearTimeout(timerId as number);
      }
      params.feedReplyFeedbackClearTimerRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (params.workspaceTab === "workflow") {
      return;
    }
    const openProviders = params.webProviderOptions.filter((provider: string) => params.providerChildViewOpen[provider]);
    if (openProviders.length === 0) {
      return;
    }
    for (const provider of openProviders) {
      params.onCloseProviderChildView(provider);
    }
  }, [params.workspaceTab, params.providerChildViewOpen]);

  useEffect(() => {
    if (!params.pendingWebTurn) {
      params.pendingWebTurnAutoOpenKeyRef.current = "";
      return;
    }
    params.webTurnPanel.setPosition({
      x: params.webTurnFloatingDefaultX,
      y: params.webTurnFloatingDefaultY,
    });
    window.setTimeout(() => {
      const panel = params.webTurnFloatingRef.current;
      const textarea = panel?.querySelector("textarea");
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus({ preventScroll: true });
      }
    }, 0);
    const key = `${params.pendingWebTurn.nodeId}:${params.pendingWebTurn.provider}:${params.pendingWebTurn.mode}:${params.pendingWebTurn.prompt.length}`;
    if (params.pendingWebTurnAutoOpenKeyRef.current === key) {
      return;
    }
    params.pendingWebTurnAutoOpenKeyRef.current = key;
    const homeUrl = params.webProviderHomeUrl(params.pendingWebTurn.provider);
    if (!homeUrl) {
      params.setStatus(`${params.webProviderLabel(params.pendingWebTurn.provider)} 외부 런타임이 브라우저 없이 직접 실행됩니다.`);
      return;
    }
    void params.openUrlFn(homeUrl)
      .then(() => {
        params.setStatus(`${params.webProviderLabel(params.pendingWebTurn.provider)} 기본 브라우저 자동 열림`);
      })
      .catch((error: unknown) => {
        params.setError(`${params.webProviderLabel(params.pendingWebTurn.provider)} 브라우저 자동 열기 실패: ${String(error)}`);
      });
  }, [params.pendingWebTurn]);

  useEffect(() => {
    if (!params.pendingWebLogin) {
      params.pendingWebLoginAutoOpenKeyRef.current = "";
      return;
    }
    const key = `${params.pendingWebLogin.nodeId}:${params.pendingWebLogin.provider}:${params.pendingWebLogin.reason.length}`;
    if (params.pendingWebLoginAutoOpenKeyRef.current === key) {
      return;
    }
    params.pendingWebLoginAutoOpenKeyRef.current = key;
    void params.invokeFn("web_provider_open_session", {
      provider: params.pendingWebLogin.provider,
    })
      .then(() => {
        params.setStatus(`${params.webProviderLabel(params.pendingWebLogin.provider)} 로그인 세션 자동 열림`);
        void params.refreshWebWorkerHealth(true);
      })
      .catch((error: unknown) => {
        params.setError(`${params.webProviderLabel(params.pendingWebLogin.provider)} 로그인 브라우저 열기 실패: ${String(error)}`);
      });
  }, [params.pendingWebLogin]);

  useEffect(() => {
    if (params.workspaceTab !== "settings") {
      return;
    }

    void params.refreshWebWorkerHealth(true);
    return;
  }, [params.workspaceTab]);

  useEffect(() => {
    if (params.workspaceTab !== "bridge") {
      return;
    }
    void params.refreshWebWorkerHealth(true);
    return undefined;
  }, [params.workspaceTab]);

  useEffect(() => {
    if (params.workspaceTab !== "feed") {
      params.setFeedShareMenuPostId(null);
      return;
    }
    void params.refreshFeedTimeline();
  }, [params.workspaceTab]);

  useEffect(() => {
    const hasActiveNodeRuntime = Object.values(params.nodeStates).some(
      (row: any) =>
        Boolean(row.startedAt) &&
        !row.finishedAt &&
        (row.status === "queued" || row.status === "running" || row.status === "waiting_user"),
    );
    if (!hasActiveNodeRuntime) {
      return;
    }
    params.setRuntimeNowMs(Date.now());
    const timer = window.setInterval(() => {
      params.setRuntimeNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [params.nodeStates]);
}
