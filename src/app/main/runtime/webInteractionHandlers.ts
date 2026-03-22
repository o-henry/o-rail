import { webProviderUsesWorkerBridge, type WebProvider } from "../../../features/workflow/domain";

export function createWebInteractionHandlers(params: any) {
  async function ensureWebWorkerReady(provider?: WebProvider) {
    if (provider && !webProviderUsesWorkerBridge(provider)) {
      return true;
    }
    try {
      await params.invokeFn("web_worker_start");
      const health = await params.refreshWebWorkerHealth(true);
      if (!health?.running) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function resolvePendingWebLogin(retry: boolean) {
    const resolver = params.webLoginResolverRef.current;
    params.webLoginResolverRef.current = null;
    params.setPendingWebLogin(null);
    if (resolver) {
      resolver(retry);
    }
  }

  async function onCopyPendingWebPrompt() {
    if (!params.pendingWebTurn) {
      return;
    }
    try {
      await navigator.clipboard.writeText(params.pendingWebTurn.prompt);
      params.setStatus("웹 프롬프트 복사 완료");
    } catch (error) {
      params.setError(`clipboard copy failed: ${String(error)}`);
    }
  }

  function onSubmitPendingWebTurn() {
    if (!params.pendingWebTurn) {
      return;
    }
    if (!params.webTurnResolverRef.current) {
      if (!params.manualInputWaitNoticeByNodeRef.current[params.pendingWebTurn.nodeId]) {
        params.manualInputWaitNoticeByNodeRef.current[params.pendingWebTurn.nodeId] = true;
        params.setStatus("자동 수집 중단 처리 중입니다. 잠시 후 '입력 완료'를 다시 눌러주세요.");
      }
      return;
    }
    const normalized = params.normalizeWebTurnOutput(
      params.pendingWebTurn.provider,
      params.pendingWebTurn.mode,
      params.webResponseDraft,
    );
    if (!normalized.ok) {
      params.setError(normalized.error ?? "웹 응답 처리 실패");
      return;
    }
    params.resolvePendingWebTurn({ ok: true, output: normalized.output });
  }

  function onDismissPendingWebTurn() {
    if (!params.pendingWebTurn) {
      return;
    }
    params.webTurnPanel.clearDragging();
    params.setSuspendedWebTurn(params.pendingWebTurn);
    params.setSuspendedWebResponseDraft(params.webResponseDraft);
    params.setPendingWebTurn(null);
    params.setStatus("웹 응답 입력 창을 닫았습니다. 하단 '웹 입력 다시 열기' 버튼으로 재개할 수 있습니다.");
  }

  function onReopenPendingWebTurn() {
    if (!params.suspendedWebTurn) {
      return;
    }
    params.setPendingWebTurn(params.suspendedWebTurn);
    params.setWebResponseDraft(params.suspendedWebResponseDraft);
    params.setSuspendedWebTurn(null);
    params.setSuspendedWebResponseDraft("");
    params.setStatus(`${params.webProviderLabel(params.suspendedWebTurn.provider)} 웹 응답 입력 창을 다시 열었습니다.`);
  }

  function onOpenWebInputForNode(nodeId: string) {
    params.clearDetachedWebTurnResolver("이전 웹 입력 세션이 비어 있어 새 입력 세션으로 교체했습니다.");
    if (params.pendingWebTurn?.nodeId === nodeId) {
      params.webTurnPanel.setPosition({
        x: params.webTurnFloatingDefaultX,
        y: params.webTurnFloatingDefaultY,
      });
      params.setStatus("해당 WEB 노드의 수동 입력 창이 이미 열려 있습니다.");
      return;
    }

    if (params.suspendedWebTurn?.nodeId === nodeId) {
      onReopenPendingWebTurn();
      return;
    }

    const queuedIndex = params.webTurnQueueRef.current.findIndex((row: any) => row.turn.nodeId === nodeId);
    if (queuedIndex >= 0) {
      const hasActiveWebInputSession = Boolean(
        params.pendingWebTurn || params.suspendedWebTurn || params.webTurnResolverRef.current,
      );
      if (hasActiveWebInputSession) {
        if (queuedIndex > 0) {
          const [target] = params.webTurnQueueRef.current.splice(queuedIndex, 1);
          if (target) {
            params.webTurnQueueRef.current.unshift(target);
          }
        }
        params.setStatus("해당 WEB 노드 입력은 대기열 맨 앞으로 이동했습니다.");
        return;
      }

      const [target] = params.webTurnQueueRef.current.splice(queuedIndex, 1);
      if (!target) {
        return;
      }
      params.setPendingWebTurn(target.turn);
      params.setWebResponseDraft("");
      params.setSuspendedWebTurn(null);
      params.setSuspendedWebResponseDraft("");
      params.webTurnResolverRef.current = target.resolve;
      params.webTurnPanel.setPosition({
        x: params.webTurnFloatingDefaultX,
        y: params.webTurnFloatingDefaultY,
      });
      params.setStatus(`${params.webProviderLabel(target.turn.provider)} 웹 응답 입력 창을 상단에 표시했습니다.`);
      return;
    }

    const activeProvider =
      params.activeWebProviderByNodeRef.current[nodeId] ??
      params.webProviderOptions.find((provider: any) => params.activeWebNodeByProviderRef.current[provider] === nodeId);
    if (activeProvider) {
      params.manualWebFallbackNodeRef.current[nodeId] = true;
      delete params.manualInputWaitNoticeByNodeRef.current[nodeId];
      const prompt = params.activeWebPromptByNodeRef.current[nodeId] ?? params.activeWebPromptRef.current[activeProvider] ?? "";
      if (!params.pendingWebTurn && !params.suspendedWebTurn) {
        params.setWebResponseDraft("");
        params.setPendingWebTurn({
          nodeId,
          provider: activeProvider,
          prompt,
          mode: "manualPasteText",
        });
        params.webTurnPanel.setPosition({
          x: params.webTurnFloatingDefaultX,
          y: params.webTurnFloatingDefaultY,
        });
        params.setStatus(`${params.webProviderLabel(activeProvider)} 수동 입력 창을 열고 자동 수집 중단을 요청했습니다.`);
      } else {
        params.setStatus(
          `${params.webProviderLabel(activeProvider)} 자동 수집 중단을 요청했습니다. 수동 입력 창에서 입력을 계속하세요.`,
        );
      }
      return;
    }

    const targetNode = params.graphNodes.find((node: any) => node.id === nodeId);
    if (targetNode?.type !== "turn") {
      params.setStatus("현재 해당 WEB 노드의 수동 입력 대기 항목이 없습니다.");
      return;
    }
    const provider = params.getWebProviderFromExecutor(params.getTurnExecutor(targetNode.config));
    if (!provider) {
      params.setStatus("현재 해당 WEB 노드의 수동 입력 대기 항목이 없습니다.");
      return;
    }

    const template = params.injectOutputLanguageDirective(
      String(targetNode.config?.promptTemplate ?? "{{input}}"),
      params.locale,
    );
    const directInput = params.workflowQuestion.trim();
    const prompt =
      params.activeWebPromptByNodeRef.current[nodeId] ??
      params.activeWebPromptRef.current[provider] ??
      (template.includes("{{input}}")
        ? params.replaceInputPlaceholder(template, directInput)
        : `${template}${directInput ? `\n${directInput}` : ""}`.trim()) ??
      "";

    params.setWebResponseDraft("");
    params.setPendingWebTurn({
      nodeId,
      provider,
      prompt,
      mode: "manualPasteText",
    });
    params.webTurnPanel.setPosition({
      x: params.webTurnFloatingDefaultX,
      y: params.webTurnFloatingDefaultY,
    });
    params.setStatus(`${params.webProviderLabel(provider)} 수동 입력 창을 열었습니다. 실행 연결 후 입력 완료가 반영됩니다.`);
  }

  function onCancelPendingWebTurn() {
    params.resolvePendingWebTurn({ ok: false, error: params.t("run.cancelledByUserShort") });
  }

  return {
    ensureWebWorkerReady,
    resolvePendingWebLogin,
    onCopyPendingWebPrompt,
    onSubmitPendingWebTurn,
    onDismissPendingWebTurn,
    onReopenPendingWebTurn,
    onOpenWebInputForNode,
    onCancelPendingWebTurn,
  };
}
