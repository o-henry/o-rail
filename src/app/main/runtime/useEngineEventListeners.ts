import { useEffect } from "react";
import { t as translate } from "../../../i18n";
import { dispatchEngineNotificationEvent } from "./codexTurnNotifications";

export function useEngineEventListeners(params: any) {
  useEffect(() => {
    let cancelled = false;
    if (!params.hasTauriRuntime) {
      return () => {
        cancelled = true;
      };
    }

    const attach = async () => {
      const unlistenNotification = await params.listenFn("engine://notification", (event: any) => {
        try {
          const payload = event.payload;
          dispatchEngineNotificationEvent(payload);

          if (payload.method === "item/agentMessage/delta") {
            const delta = params.extractDeltaText(payload.params);
            const activeNodeId = params.activeTurnNodeIdRef.current;
            if (activeNodeId && delta) {
              params.activeRunDeltaRef.current[activeNodeId] =
                (params.activeRunDeltaRef.current[activeNodeId] ?? "") + delta;
            }
          }

          if (payload.method === "account/login/completed") {
            params.authLoginRequiredProbeCountRef.current = 0;
            params.lastAuthenticatedAtRef.current = Date.now();
            params.setLoginCompleted(true);
            params.setStatus(translate("bridge.status.event.loginCompleted"));
            void params.refreshAuthStateFromEngine(true);
          }

          if (payload.method === "account/updated") {
            const mode = params.extractAuthMode(payload.params);
            if (mode) {
              params.setAuthMode(mode);
              if (mode !== "unknown") {
                params.authLoginRequiredProbeCountRef.current = 0;
                params.lastAuthenticatedAtRef.current = Date.now();
                params.setLoginCompleted(true);
                params.setStatus(translate("bridge.status.event.accountUpdatedMode", { mode }));
              } else {
                params.setStatus(translate("bridge.status.event.accountUpdatedUnknown"));
                void params.refreshAuthStateFromEngine(true);
              }
            } else {
              params.setStatus(translate("bridge.status.event.accountUpdatedUnknown"));
              void params.refreshAuthStateFromEngine(true);
            }
          }

          if (payload.method === "web/progress") {
            const message = params.extractStringByPaths(payload.params, ["message", "stage", "error"]);
            const stage = params.extractStringByPaths(payload.params, ["stage"]);
            const provider = params.extractStringByPaths(payload.params, ["provider"])?.toLowerCase() ?? "";
            const providerKey = provider && params.webProviderOptions.includes(provider) ? provider : null;
            const activeWebNodeId = providerKey ? params.activeWebNodeByProviderRef.current[providerKey] : "";
            const hasBridgeStage = Boolean(stage?.startsWith("bridge_"));
            const progressMessage = hasBridgeStage
              ? params.normalizeWebBridgeProgressMessage(stage ?? "", message ?? "")
              : (message ?? "");
            if (activeWebNodeId && progressMessage && stage !== "bridge_waiting_user_send") {
              params.addNodeLog(activeWebNodeId, `[WEB] ${progressMessage}`);
            }
            if (hasBridgeStage) {
              const prefix = providerKey ? `[${providerKey.toUpperCase()}] ` : "";
              const line = `${prefix}${progressMessage || stage}`;
              params.setWebBridgeLogs((prev: string[]) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 120));
              if (providerKey && stage === "bridge_queued") {
                params.setStatus(translate("bridge.status.event.providerQueued", { provider: params.webProviderLabel(providerKey) }));
                params.scheduleWebBridgeStageWarn(
                  providerKey,
                  params.webBridgeClaimWarnMs,
                  translate("bridge.warn.claimDelayed.title", { provider: params.webProviderLabel(providerKey) }),
                  translate("bridge.warn.claimDelayed.detail"),
                  () => {
                    const prompt = params.activeWebPromptRef.current[providerKey];
                    if (!prompt) {
                      return;
                    }
                    void navigator.clipboard
                      .writeText(prompt)
                      .then(() => {
                        const activeNodeId = params.activeWebNodeByProviderRef.current[providerKey];
                        if (activeNodeId) {
                          params.addNodeLog(activeNodeId, translate("bridge.warn.copiedPrompt"));
                        }
                      })
                      .catch(() => {
                        // clipboard permission can be denied depending on runtime context
                      });
                  },
                );
              } else if (providerKey && stage === "bridge_claimed") {
                params.setStatus(translate("bridge.status.event.providerClaimed", { provider: params.webProviderLabel(providerKey) }));
                params.scheduleWebBridgeStageWarn(
                  providerKey,
                  params.webBridgePromptFilledWarnMs,
                  translate("bridge.warn.injectDelayed.title", { provider: params.webProviderLabel(providerKey) }),
                  translate("bridge.warn.injectDelayed.detail"),
                );
              } else if (providerKey && stage === "bridge_prompt_filled") {
                params.clearWebBridgeStageWarnTimer(providerKey);
                params.setStatus(translate("bridge.status.event.promptFilled", { provider: params.webProviderLabel(providerKey) }));
              } else if (providerKey && stage === "bridge_waiting_user_send") {
                params.clearWebBridgeStageWarnTimer(providerKey);
                params.setStatus(translate("bridge.status.event.waitingSend", { provider: params.webProviderLabel(providerKey) }));
                params.scheduleWebBridgeStageWarn(
                  providerKey,
                  1_600,
                  translate("bridge.warn.waitingSend.title", { provider: params.webProviderLabel(providerKey) }),
                  translate("bridge.warn.waitingSend.detail"),
                );
              } else if (providerKey && stage === "bridge_extension_error") {
                params.clearWebBridgeStageWarnTimer(providerKey);
                params.setStatus(translate("bridge.status.event.extensionError", { provider: params.webProviderLabel(providerKey) }));
              } else if (providerKey && stage === "bridge_done") {
                params.clearWebBridgeStageWarnTimer(providerKey);
                params.setStatus(translate("bridge.status.event.providerDone", { provider: params.webProviderLabel(providerKey) }));
              } else if (
                providerKey &&
                (stage === "bridge_failed" ||
                  stage === "bridge_timeout" ||
                  stage === "bridge_cancelled" ||
                  stage === "bridge_error")
              ) {
                params.clearWebBridgeStageWarnTimer(providerKey);
              }
            }
          }

          if (payload.method === "web/worker/ready") {
            params.setWebWorkerHealth((prev: any) => ({ ...prev, running: true }));
          }

          if (payload.method === "web/worker/stopped") {
            params.setWebWorkerHealth((prev: any) => ({ ...prev, running: false, activeProvider: null }));
          }

          const terminal = params.isTurnTerminalEvent(payload.method, payload.params);
          if (terminal && params.turnTerminalResolverRef.current) {
            const resolve = params.turnTerminalResolverRef.current;
            params.turnTerminalResolverRef.current = null;
            resolve(terminal);
          }
        } catch (handlerError) {
          params.reportSoftError("notification handler failed", handlerError);
        }
      });

      const unlistenApprovalRequest = await params.listenFn("engine://approval_request", (event: any) => {
        try {
          const payload = event.payload;
          params.setPendingApprovals((prev: any[]) => {
            if (prev.some((item) => item.requestId === payload.requestId)) {
              return prev;
            }
            return [
              ...prev,
              {
                requestId: payload.requestId,
                source: "remote",
                method: payload.method,
                params: payload.params,
              },
            ];
          });
          params.setStatus(translate("bridge.status.event.approvalRequest", { method: payload.method }));
        } catch (handlerError) {
          params.reportSoftError("approval handler failed", handlerError);
        }
      });

      const unlistenLifecycle = await params.listenFn("engine://lifecycle", (event: any) => {
        try {
          const payload = event.payload;
          const msg = payload.message ? ` (${payload.message})` : "";
          params.setStatus(`${params.lifecycleStateLabel(payload.state)}${msg}`);

          if (payload.state === "ready") {
            params.setEngineStarted(true);
            void params.refreshAuthStateFromEngine(true);
          }
          if (payload.state === "stopped" || payload.state === "disconnected") {
            params.setEngineStarted(false);
            params.markCodexNodesStatusOnEngineIssue("cancelled", translate("bridge.issue.engineDisconnected"));
            params.setUsageInfoText("");
            params.setPendingApprovals([]);
            params.setApprovalSubmitting(false);
          }
          if (payload.state === "parseError" || payload.state === "readError" || payload.state === "stderrError") {
            params.markCodexNodesStatusOnEngineIssue("failed", translate("bridge.issue.engineProtocolError"));
          }
        } catch (handlerError) {
          params.reportSoftError("lifecycle handler failed", handlerError);
        }
      });

      if (cancelled) {
        unlistenNotification();
        unlistenApprovalRequest();
        unlistenLifecycle();
      }

      return () => {
        unlistenNotification();
        unlistenApprovalRequest();
        unlistenLifecycle();
      };
    };

    let detach: (() => void) | undefined;
    attach()
      .then((fn) => {
        detach = fn;
      })
      .catch((e) => {
        params.reportSoftError("event listen failed", e);
      });

    return () => {
      cancelled = true;
      if (detach) {
        detach();
      }
    };
  }, [params.hasTauriRuntime]);
}
