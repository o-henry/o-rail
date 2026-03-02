import { useEffect } from "react";

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
            params.setStatus("로그인 완료 이벤트 수신");
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
                params.setStatus(`계정 상태 갱신 수신 (인증 모드=${mode})`);
              } else {
                params.setStatus("계정 상태 갱신 수신 (인증 모드 미확인)");
                void params.refreshAuthStateFromEngine(true);
              }
            } else {
              params.setStatus("계정 상태 갱신 수신 (인증 모드 미확인)");
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
                params.setStatus(`${params.webProviderLabel(providerKey)} 작업 대기열 등록됨`);
                params.scheduleWebBridgeStageWarn(
                  providerKey,
                  params.webBridgeClaimWarnMs,
                  `${params.webProviderLabel(providerKey)} 탭에서 작업 수신이 지연되고 있습니다.`,
                  "[WEB] 작업 수신 지연: 해당 서비스 탭이 열려 있고 확장이 활성화되어 있는지 확인하세요.",
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
                          params.addNodeLog(activeNodeId, "[WEB] 자동 주입 지연으로 프롬프트를 클립보드에 복사했습니다.");
                        }
                      })
                      .catch(() => {
                        // clipboard permission can be denied depending on runtime context
                      });
                  },
                );
              } else if (providerKey && stage === "bridge_claimed") {
                params.setStatus(`${params.webProviderLabel(providerKey)} 탭 연결됨, 프롬프트 주입 중`);
                params.scheduleWebBridgeStageWarn(
                  providerKey,
                  params.webBridgePromptFilledWarnMs,
                  `${params.webProviderLabel(providerKey)} 프롬프트 자동 주입이 지연되고 있습니다.`,
                  "[WEB] 프롬프트 자동 주입 지연: 입력창 탐지 실패 가능성이 있습니다. 웹 탭을 새로고침 후 다시 실행하세요.",
                );
              } else if (providerKey && stage === "bridge_prompt_filled") {
                params.clearWebBridgeStageWarnTimer(providerKey);
                params.setStatus(`${params.webProviderLabel(providerKey)} 프롬프트 자동 주입 완료`);
              } else if (providerKey && stage === "bridge_waiting_user_send") {
                params.clearWebBridgeStageWarnTimer(providerKey);
                params.setStatus(`${params.webProviderLabel(providerKey)} 자동 전송 확인 중`);
                params.scheduleWebBridgeStageWarn(
                  providerKey,
                  1_600,
                  `${params.webProviderLabel(providerKey)} 탭에서 전송 1회가 필요합니다.`,
                  "[WEB] 자동 전송이 확인되지 않아 사용자 전송 클릭을 기다립니다.",
                );
              } else if (providerKey && stage === "bridge_extension_error") {
                params.clearWebBridgeStageWarnTimer(providerKey);
                params.setStatus(`${params.webProviderLabel(providerKey)} 웹 연결 오류 - 확장 연결 상태를 확인하세요.`);
              } else if (providerKey && stage === "bridge_done") {
                params.clearWebBridgeStageWarnTimer(providerKey);
                params.setStatus(`${params.webProviderLabel(providerKey)} 응답 수집 완료`);
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
          params.setStatus(`승인 요청 수신 (${payload.method})`);
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
            params.markCodexNodesStatusOnEngineIssue("cancelled", "엔진 중지 또는 연결 끊김");
            params.setUsageInfoText("");
            params.setPendingApprovals([]);
            params.setApprovalSubmitting(false);
          }
          if (payload.state === "parseError" || payload.state === "readError" || payload.state === "stderrError") {
            params.markCodexNodesStatusOnEngineIssue("failed", "엔진/프로토콜 오류");
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
