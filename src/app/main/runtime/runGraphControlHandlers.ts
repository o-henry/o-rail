function isViaOnlyGraph(graph: any): boolean {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (nodes.length === 0) {
    return false;
  }
  return nodes.every((node: any) => {
    if (!node || typeof node !== "object") {
      return false;
    }
    if (node.type !== "turn") {
      return false;
    }
    const config = node.config && typeof node.config === "object" ? node.config : {};
    return String((config as Record<string, unknown>).executor ?? "").trim() === "via_flow";
  });
}

export function createRunGraphControlHandlers(params: any) {
  async function prepareRunGraphStart(skipWebConnectPreflight: boolean): Promise<any | null> {
    const resolvedCwd = String(params.cwd ?? "").trim();
    if (!resolvedCwd || resolvedCwd === ".") {
      params.setError("작업 경로(CWD)를 먼저 선택하세요.");
      params.setStatus("그래프 실행 대기");
      return null;
    }

    if (!skipWebConnectPreflight) {
      const requiredWebProviders = params.collectRequiredWebProviders(params.graph.nodes);
      if (requiredWebProviders.length > 0) {
        const bridgeStatusLatest = (await params.refreshWebBridgeStatus(true, true)) ?? params.webBridgeStatus;
        const connectedProviderSet = new Set(
          (bridgeStatusLatest.connectedProviders ?? []).map((row: any) => row.provider),
        );
        const missingProviders = requiredWebProviders.filter((provider: string) => !connectedProviderSet.has(provider));
        const reasons = params.buildWebConnectPreflightReasons({
          bridgeRunning: Boolean(bridgeStatusLatest.running),
          tokenMasked: Boolean(bridgeStatusLatest.tokenMasked),
          extensionOriginPolicy: bridgeStatusLatest.extensionOriginPolicy,
          extensionOriginAllowlistConfigured: bridgeStatusLatest.extensionOriginAllowlistConfigured,
          missingProviders,
          webProviderLabelFn: params.webProviderLabel,
          t: params.t,
        });

        if (reasons.length > 0) {
          params.setPendingWebConnectCheck({
            providers: requiredWebProviders,
            reason: reasons.join("\n"),
          });
          params.setError("");
          params.setStatus("웹 연결 확인 필요");
          return null;
        }
      }
    }

    const runGroup = params.inferRunGroupMeta(params.graph, params.lastAppliedPresetRef.current, params.locale);
    if (!isViaOnlyGraph(params.graph)) {
      const directInputNodeIds = params.findDirectInputNodeIds(params.graph);
      if (directInputNodeIds.length === 0) {
        params.setError(
          "질문 직접 입력으로 시작되는 노드가 없습니다. 최소 1개 노드를 질문에서 시작되게 연결하세요.",
        );
        params.setStatus("그래프 실행 대기");
        return null;
      }
    }
    return runGroup;
  }

  function cleanupRunGraphExecutionState() {
    for (const timerId of Object.values(params.webBridgeStageWarnTimerRef.current)) {
      window.clearTimeout(timerId as number);
    }
    params.webBridgeStageWarnTimerRef.current = {};
    params.activeWebPromptRef.current = {};
    params.activeWebNodeByProviderRef.current = {};
    params.turnTerminalResolverRef.current = null;
    params.webTurnResolverRef.current = null;
    params.webLoginResolverRef.current = null;
    params.clearQueuedWebTurnRequests("실행이 종료되어 대기 중인 웹 응답 입력을 취소했습니다.");
    params.manualInputWaitNoticeByNodeRef.current = {};
    params.setPendingWebTurn(null);
    params.setSuspendedWebTurn(null);
    params.setSuspendedWebResponseDraft("");
    params.setPendingWebLogin(null);
    params.setWebResponseDraft("");
    params.internalMemoryCorpusRef.current = [];
    params.activeRunPresetKindRef.current = undefined;
    params.activeTurnNodeIdRef.current = "";
    params.activeTurnThreadByNodeIdRef.current = {};
    params.setIsGraphRunning(false);
    params.setIsGraphPaused(false);
    params.setIsRunStarting(false);
    params.runStartGuardRef.current = false;
    params.cancelRequestedRef.current = false;
    params.pauseRequestedRef.current = false;
    params.collectingRunRef.current = false;
    params.setActiveFeedRunMeta(null);
  }

  async function handleRunPauseIfNeeded(
    activeTasks: Map<string, Promise<void>>,
    pauseStatusShown: boolean,
  ): Promise<{ handled: boolean; pauseStatusShown: boolean }> {
    if (!params.pauseRequestedRef.current) {
      return { handled: false, pauseStatusShown };
    }
    if (activeTasks.size > 0) {
      await Promise.race(activeTasks.values());
      return { handled: true, pauseStatusShown };
    }
    if (!pauseStatusShown) {
      pauseStatusShown = true;
      params.setIsGraphPaused(true);
      params.setStatus("그래프 실행 일시정지됨");
    }
    await new Promise<void>((resolve) => {
      const intervalId = window.setInterval(() => {
        if (!params.pauseRequestedRef.current) {
          window.clearInterval(intervalId);
          resolve();
        }
      }, 120);
    });
    params.setIsGraphPaused(false);
    params.setStatus("그래프 실행 재개");
    return { handled: true, pauseStatusShown: false };
  }

  async function onCancelGraphRun() {
    params.pauseRequestedRef.current = true;
    await params.cancelGraphRun({
      isGraphRunning: params.isGraphRunning,
      setIsGraphPaused: params.setIsGraphPaused,
      setStatus: params.setStatus,
      pendingWebLogin: Boolean(params.pendingWebLogin),
      resolvePendingWebLogin: params.resolvePendingWebLogin,
      activeWebNodeByProvider: params.activeWebNodeByProviderRef.current,
      invokeFn: params.invokeFn,
      addNodeLog: params.addNodeLog,
      clearWebBridgeStageWarnTimer: params.clearWebBridgeStageWarnTimer,
      activeWebPromptByProvider: params.activeWebPromptRef.current,
      setError: params.setError,
      pendingWebTurn: params.pendingWebTurn,
      suspendedWebTurn: params.suspendedWebTurn,
      clearQueuedWebTurnRequests: params.clearQueuedWebTurnRequests,
      resolvePendingWebTurn: params.resolvePendingWebTurn,
      pauseErrorToken: params.pauseErrorToken,
      activeTurnThreadByNodeId: params.activeTurnThreadByNodeIdRef.current,
    });
  }

  return {
    prepareRunGraphStart,
    cleanupRunGraphExecutionState,
    handleRunPauseIfNeeded,
    onCancelGraphRun,
  };
}
