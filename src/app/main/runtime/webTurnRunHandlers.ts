export function createWebTurnRunHandlers(params: any) {
  async function saveRunRecord(runRecord: any) {
    const fileName = `run-${runRecord.runId}.json`;
    try {
      await params.exportRunFeedMarkdownFiles({
        runRecord,
        cwd: params.cwd,
        invokeFn: params.invokeFn,
        feedRawAttachment: params.feedRawAttachmentRef.current,
        setError: params.setError,
      });
      await params.persistRunRecordFile(fileName, runRecord);
      params.setLastSavedRunFile(fileName);
      await params.refreshFeedTimeline();
    } catch (e) {
      params.setError(String(e));
    }
  }

  function resolvePendingWebTurn(result: { ok: boolean; output?: unknown; error?: string }) {
    params.resolvePendingWebTurnAction({
      result,
      pendingWebTurn: params.pendingWebTurn,
      webTurnResolverRef: params.webTurnResolverRef,
      webTurnQueueRef: params.webTurnQueueRef,
      webTurnPanel: params.webTurnPanel,
      manualInputWaitNoticeByNodeRef: params.manualInputWaitNoticeByNodeRef,
      setPendingWebTurn: params.setPendingWebTurn,
      setSuspendedWebTurn: params.setSuspendedWebTurn,
      setSuspendedWebResponseDraft: params.setSuspendedWebResponseDraft,
      setWebResponseDraft: params.setWebResponseDraft,
      setStatus: params.setStatus,
      webProviderLabelFn: params.webProviderLabel,
      webTurnFloatingDefaultX: params.webTurnFloatingDefaultX,
      webTurnFloatingDefaultY: params.webTurnFloatingDefaultY,
    });
  }

  function clearQueuedWebTurnRequests(reason: string) {
    params.clearQueuedWebTurnRequestsAction(reason, params.webTurnQueueRef);
  }

  function clearDetachedWebTurnResolver(reason: string) {
    params.clearDetachedWebTurnResolverAction({
      reason,
      pendingWebTurn: params.pendingWebTurn,
      suspendedWebTurn: params.suspendedWebTurn,
      webTurnResolverRef: params.webTurnResolverRef,
    });
  }

  async function requestWebTurnResponse(
    nodeId: string,
    provider: any,
    prompt: string,
    mode: any,
  ): Promise<{ ok: boolean; output?: unknown; error?: string }> {
    return params.requestWebTurnResponseAction({
      nodeId,
      provider,
      prompt,
      mode,
      pendingWebTurn: params.pendingWebTurn,
      suspendedWebTurn: params.suspendedWebTurn,
      suspendedWebResponseDraft: params.suspendedWebResponseDraft,
      webTurnResolverRef: params.webTurnResolverRef,
      webTurnQueueRef: params.webTurnQueueRef,
      webTurnPanel: params.webTurnPanel,
      manualInputWaitNoticeByNodeRef: params.manualInputWaitNoticeByNodeRef,
      setPendingWebTurn: params.setPendingWebTurn,
      setWebResponseDraft: params.setWebResponseDraft,
      setSuspendedWebTurn: params.setSuspendedWebTurn,
      setSuspendedWebResponseDraft: params.setSuspendedWebResponseDraft,
      setStatus: params.setStatus,
      addNodeLog: params.addNodeLog,
      webProviderLabelFn: params.webProviderLabel,
      clearDetachedWebTurnResolver,
      webTurnFloatingDefaultX: params.webTurnFloatingDefaultX,
      webTurnFloatingDefaultY: params.webTurnFloatingDefaultY,
    });
  }

  async function executeTurnNode(node: any, input: unknown) {
    return params.executeTurnNodeWithContext(node, input, {
      model: params.model,
      cwd: params.cwd,
      locale: params.locale,
      workflowQuestion: params.workflowQuestion,
      codexMultiAgentMode: params.codexMultiAgentMode,
      forceAgentRulesAllTurns: params.forceAgentRulesAllTurns,
      turnOutputSchemaEnabled: params.turnOutputSchemaEnabled,
      pauseErrorToken: params.pauseErrorToken,
      nodeStates: params.nodeStates,
      activeRunPresetKindRef: params.activeRunPresetKindRef,
      internalMemoryCorpusRef: params.internalMemoryCorpusRef,
      activeWebNodeByProviderRef: params.activeWebNodeByProviderRef,
      activeWebPromptRef: params.activeWebPromptRef,
      activeWebProviderByNodeRef: params.activeWebProviderByNodeRef,
      activeWebPromptByNodeRef: params.activeWebPromptByNodeRef,
      manualWebFallbackNodeRef: params.manualWebFallbackNodeRef,
      pauseRequestedRef: params.pauseRequestedRef,
      cancelRequestedRef: params.cancelRequestedRef,
      activeTurnNodeIdRef: params.activeTurnNodeIdRef,
      activeTurnThreadByNodeIdRef: params.activeTurnThreadByNodeIdRef,
      activeRunDeltaRef: params.activeRunDeltaRef,
      turnTerminalResolverRef: params.turnTerminalResolverRef,
      consumeNodeRequests: params.consumeNodeRequests,
      addNodeLog: params.addNodeLog,
      setStatus: params.setStatus,
      setNodeStatus: params.setNodeStatus,
      setNodeRuntimeFields: params.setNodeRuntimeFields,
      requestWebTurnResponse,
      ensureWebWorkerReady: params.ensureWebWorkerReady,
      clearWebBridgeStageWarnTimer: params.clearWebBridgeStageWarnTimer,
      loadAgentRuleDocs: async (nodeCwd: string) =>
        params.loadAgentRuleDocs({
          nodeCwd,
          cwd: params.cwd,
          cacheTtlMs: params.agentRuleCacheTtlMs,
          maxDocs: params.agentRuleMaxDocs,
          maxDocChars: params.agentRuleMaxDocChars,
          agentRulesCacheRef: params.agentRulesCacheRef,
          invokeFn: params.invokeFn,
        }),
      injectKnowledgeContext: (injectParams: any) =>
        params.injectKnowledgeContext({
          ...injectParams,
          workflowQuestion: params.workflowQuestion,
          activeRunPresetKind: params.activeRunPresetKindRef.current,
          internalMemoryCorpus: params.internalMemoryCorpusRef.current,
          enabledKnowledgeFiles: params.enabledKnowledgeFiles,
          graphKnowledge: params.graphKnowledge,
          addNodeLog: params.addNodeLog,
          invokeFn: params.invokeFn,
        }),
      invokeFn: params.invokeFn,
      openUrlFn: params.openUrlFn,
      t: params.t,
    });
  }

  return {
    saveRunRecord,
    resolvePendingWebTurn,
    clearQueuedWebTurnRequests,
    clearDetachedWebTurnResolver,
    requestWebTurnResponse,
    executeTurnNode,
  };
}
