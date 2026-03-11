export async function finalizeRunGraphExecution(params: any) {
  const {
    cancelRequestedRef,
    graph,
    setNodeStates,
    runRecord,
    runLogCollectorRef,
    normalizedEvidenceByNodeId,
    runMemoryByNodeId,
    buildConflictLedger,
    computeFinalConfidence,
    summarizeQualityMetrics,
    resolveFinalNodeId,
    lastDoneNodeId,
    terminalStateByNodeId,
    outputs,
    extractFinalAnswer,
    setStatus,
    t,
    buildFinalNodeFailureReason,
    nodeStatusLabel,
    setError,
    buildRegressionSummary,
    invokeFn,
    saveRunRecord,
    normalizeRunRecord,
    feedRunCacheRef,
    buildRunMissionFlow,
    buildRunApprovalSnapshot,
    buildRunUnityArtifacts,
    finalizeAdaptiveRun,
  } = params;

  if (cancelRequestedRef.current) {
    graph.nodes.forEach((node: any) => {
      setNodeStates((prev: any) => {
        const current = prev[node.id];
        if (!current || ["done", "low_quality", "failed", "skipped", "cancelled"].includes(current.status)) {
          return prev;
        }
        return {
          ...prev,
          [node.id]: {
            ...current,
            status: "cancelled",
          },
        };
      });
    });
  }

  runRecord.nodeLogs = runLogCollectorRef.current;
  const allEvidencePackets = Object.values(normalizedEvidenceByNodeId).flat();
  runRecord.normalizedEvidenceByNodeId = normalizedEvidenceByNodeId;
  runRecord.runMemory = runMemoryByNodeId;
  runRecord.conflictLedger = buildConflictLedger(allEvidencePackets);
  runRecord.finalConfidence = computeFinalConfidence(allEvidencePackets, runRecord.conflictLedger);
  if (runRecord.nodeMetrics && Object.keys(runRecord.nodeMetrics).length > 0) {
    runRecord.qualitySummary = summarizeQualityMetrics(runRecord.nodeMetrics);
  }

  const finalNodeId = resolveFinalNodeId({
    graph,
    transitions: runRecord.transitions,
    lastDoneNodeId,
  });
  const finalNodeState = finalNodeId ? terminalStateByNodeId[finalNodeId] : undefined;
  if (finalNodeId && (finalNodeState === "done" || finalNodeState === "low_quality") && finalNodeId in outputs) {
    runRecord.finalAnswer = extractFinalAnswer(outputs[finalNodeId]);
    setStatus(finalNodeState === "low_quality" ? t("run.graphCompletedLowQuality") : "그래프 실행 완료");
  } else {
    const reason = buildFinalNodeFailureReason({
      finalNodeId,
      finalNodeState,
      nodeStatusLabelFn: nodeStatusLabel,
    });
    setStatus(`그래프 실행 실패 (${reason})`);
    setError(`최종 노드 실패: ${reason}`);
  }

  runRecord.approvalQueueSnapshot = buildRunApprovalSnapshot(runRecord.transitions);
  const pendingApprovals = (runRecord.approvalQueueSnapshot ?? []).filter((row: any) => row.status === "pending").length;
  runRecord.missionFlow = buildRunMissionFlow({
    hasDecomposed: graph.nodes.length > 0,
    pendingApprovals,
    hasExecutionStarted: runRecord.transitions.some((row: any) => row.status === "running"),
    hasExecutionCompleted: true,
    hasSummary: Boolean(runRecord.finalAnswer),
  });
  const unityArtifacts = buildRunUnityArtifacts(runRecord);
  runRecord.unityTaskBundle = unityArtifacts.unityTaskBundle;
  runRecord.patchBundle = unityArtifacts.patchBundle;
  runRecord.batchRuns = runRecord.batchRuns ?? [];
  runRecord.collaborationTrace = [
    ...(runRecord.collaborationTrace ?? []),
    {
      at: new Date().toISOString(),
      kind: "collaboration",
      summary: runRecord.finalAnswer ? "summary completed" : "summary failed",
      payload: {
        finalNodeId,
        finalNodeState,
      },
    },
  ];

  runRecord.finishedAt = new Date().toISOString();
  runRecord.regression = await buildRegressionSummary({
    currentRun: runRecord,
    invokeFn,
  });
  await saveRunRecord(runRecord);
  if (typeof finalizeAdaptiveRun === "function") {
    await finalizeAdaptiveRun(runRecord);
  }
  const normalizedRunRecord = normalizeRunRecord(runRecord);
  const runFileName = `run-${runRecord.runId}.json`;
  feedRunCacheRef.current[runFileName] = normalizedRunRecord;
}
