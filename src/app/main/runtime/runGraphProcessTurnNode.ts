import type { QualityReport } from "../types";
import { storeGraphRoleKnowledge } from "../../../features/studio/graphRoleKnowledgeMemory";
import { toStudioRoleId } from "../../../features/studio/roleUtils";

function applyViaArtifactPathsToFeedPost(post: any, output: unknown): any {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return post;
  }
  const row = output as Record<string, unknown>;
  const via = row.via;
  if (!via || typeof via !== "object" || Array.isArray(via)) {
    return post;
  }
  const viaRecord = via as Record<string, unknown>;
  const artifacts = Array.isArray(viaRecord.artifacts) ? viaRecord.artifacts : [];
  if (artifacts.length === 0) {
    return post;
  }

  let markdownPath = "";
  let jsonPath = "";
  for (const item of artifacts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const artifact = item as Record<string, unknown>;
    const format = String(artifact.format ?? "").trim().toLowerCase();
    const path = String(artifact.path ?? "").trim();
    if (!path) {
      continue;
    }
    if (!markdownPath && (format === "md" || format === "markdown")) {
      markdownPath = path;
    } else if (!jsonPath && format === "json") {
      jsonPath = path;
    }
  }

  if (!markdownPath && !jsonPath) {
    return post;
  }

  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  const nextAttachments = attachments.map((attachment: any) => {
    if (!attachment || typeof attachment !== "object") {
      return attachment;
    }
    if (attachment.kind === "markdown" && markdownPath) {
      return { ...attachment, filePath: markdownPath };
    }
    if (attachment.kind === "json" && jsonPath) {
      return { ...attachment, filePath: jsonPath };
    }
    return attachment;
  });
  return { ...post, attachments: nextAttachments };
}

export async function handleRunGraphTurnNode(params: any): Promise<boolean> {
  const {
    node,
    nodeId,
    input,
    isFinalTurnNode,
    executeTurnNodeWithOutputSchemaRetry,
    executeTurnNode,
    addNodeLog,
    validateSimpleSchema,
    turnOutputSchemaEnabled,
    turnOutputSchemaMaxRetry,
    pauseRequestedRef,
    isPauseSignalError,
    setNodeStatus,
    setNodeRuntimeFields,
    appendRunTransition,
    runRecord,
    queue,
    startedAtMs,
    runLogCollectorRef,
    buildFeedPost,
    rememberFeedSource,
    feedRawAttachmentRef,
    feedAttachmentRawKey,
    latestFeedSourceByNodeId,
    appendNodeEvidence,
    terminalStateByNodeId,
    scheduleChildren,
    cancelRequestedRef,
    t,
    buildQualityReport,
    cwd,
    outputs,
  } = params;

  if (node.type !== "turn") {
    return false;
  }

  const hasOutputSchema = String((node.config as any).outputSchemaJson ?? "").trim().length > 0;
  const turnExecution = await executeTurnNodeWithOutputSchemaRetry({
    node,
    input,
    executeTurnNode,
    addNodeLog,
    validateSimpleSchema,
    outputSchemaEnabled: turnOutputSchemaEnabled,
    maxRetryDefault: turnOutputSchemaMaxRetry,
    options: {
      maxRetry: isFinalTurnNode || hasOutputSchema ? 1 : 0,
    },
  });

  const result = turnExecution.result;
  if (!result.ok && pauseRequestedRef.current && isPauseSignalError(result.error)) {
    const pauseMessage = "사용자 일시정지 요청으로 노드 실행을 보류했습니다.";
    addNodeLog(nodeId, `[중지] ${pauseMessage}`);
    setNodeStatus(nodeId, "queued", pauseMessage);
    setNodeRuntimeFields(nodeId, {
      status: "queued",
      finishedAt: undefined,
      durationMs: undefined,
    });
    appendRunTransition(runRecord, nodeId, "queued", pauseMessage);
    if (!queue.includes(nodeId)) {
      queue.push(nodeId);
    }
    return true;
  }

  if (result.knowledgeTrace && result.knowledgeTrace.length > 0) {
    runRecord.knowledgeTrace?.push(...result.knowledgeTrace);
  }
  if (result.memoryTrace && result.memoryTrace.length > 0) {
    runRecord.internalMemoryTrace?.push(...result.memoryTrace);
  }

  if (!result.ok) {
    const finishedAtIso = new Date().toISOString();
    setNodeStatus(nodeId, "failed", result.error ?? "턴 실행 실패");
    setNodeRuntimeFields(nodeId, {
      error: result.error,
      status: "failed",
      threadId: result.threadId,
      turnId: result.turnId,
      usage: result.usage,
      finishedAt: finishedAtIso,
      durationMs: Date.now() - startedAtMs,
    });
    runRecord.providerTrace?.push({
      nodeId,
      executor: result.executor,
      provider: result.provider,
      status: cancelRequestedRef.current ? "cancelled" : "failed",
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: finishedAtIso,
      summary: result.error ?? "턴 실행 실패",
    });
    appendRunTransition(runRecord, nodeId, "failed", result.error ?? "턴 실행 실패");
    const failedEvidence = appendNodeEvidence({
      node,
      output: result.output ?? { error: result.error ?? "턴 실행 실패", input },
      provider: result.provider,
      summary: result.error ?? "턴 실행 실패",
      createdAt: finishedAtIso,
    });
    const failedFeed = buildFeedPost({
      runId: runRecord.runId,
      node,
      isFinalDocument: isFinalTurnNode,
      status: "failed",
      createdAt: finishedAtIso,
      summary: result.error ?? "턴 실행 실패",
      logs: runLogCollectorRef.current[nodeId] ?? [],
      output: result.output,
      error: result.error,
      durationMs: Date.now() - startedAtMs,
      usage: result.usage,
      inputSources: params.nodeInputSources,
      inputData: input,
      verificationStatus: failedEvidence.verificationStatus,
      confidenceBand: failedEvidence.confidenceBand,
      dataIssues: failedEvidence.dataIssues,
    });
    const failedPost = applyViaArtifactPathsToFeedPost(failedFeed.post, result.output);
    runRecord.feedPosts?.push(failedPost);
    rememberFeedSource(latestFeedSourceByNodeId, failedPost);
    feedRawAttachmentRef.current[feedAttachmentRawKey(failedPost.id, "markdown")] = failedFeed.rawAttachments.markdown;
    feedRawAttachmentRef.current[feedAttachmentRawKey(failedPost.id, "json")] = failedFeed.rawAttachments.json;
    terminalStateByNodeId[nodeId] = "failed";
    scheduleChildren(nodeId);
    return true;
  }

  const config = node.config as any;
  const graphRoleId = toStudioRoleId(String(config.handoffRoleId ?? ""));
  for (const warning of turnExecution.artifactWarnings) {
    addNodeLog(nodeId, `[아티팩트] ${warning}`);
  }
  const normalizedOutput = turnExecution.normalizedOutput ?? result.output;
  let qualityReport: QualityReport | undefined;

  if (isFinalTurnNode) {
    const finalQualityReport = await buildQualityReport({
      node,
      config,
      output: normalizedOutput,
      cwd: String(config.cwd ?? cwd).trim() || cwd,
    });
    qualityReport = finalQualityReport;
    runRecord.nodeMetrics = {
      ...(runRecord.nodeMetrics ?? {}),
      [nodeId]: {
        nodeId,
        profile: finalQualityReport.profile,
        score: finalQualityReport.score,
        decision: finalQualityReport.decision,
        threshold: finalQualityReport.threshold,
        failedChecks: finalQualityReport.failures.length,
        warningCount: finalQualityReport.warnings.length,
      },
    };
    for (const warning of finalQualityReport.warnings) {
      addNodeLog(nodeId, `[품질] ${warning}`);
    }
    if (finalQualityReport.decision !== "PASS") {
      const finishedAtIso = new Date().toISOString();
      const lowQualitySummary = t("run.qualityLowSummary", {
        score: finalQualityReport.score,
        threshold: finalQualityReport.threshold,
      });
      addNodeLog(
        nodeId,
        t("run.qualityRejectLog", {
          score: finalQualityReport.score,
          threshold: finalQualityReport.threshold,
        }),
      );
      outputs[nodeId] = normalizedOutput;
      setNodeStatus(nodeId, "low_quality", lowQualitySummary);
      setNodeRuntimeFields(nodeId, {
        status: "low_quality",
        output: normalizedOutput,
        qualityReport: finalQualityReport,
        threadId: result.threadId,
        turnId: result.turnId,
        usage: result.usage,
        finishedAt: finishedAtIso,
        durationMs: Date.now() - startedAtMs,
      });
      runRecord.threadTurnMap[nodeId] = {
        threadId: result.threadId,
        turnId: result.turnId,
      };
      runRecord.providerTrace?.push({
        nodeId,
        executor: result.executor,
        provider: result.provider,
        status: "done",
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: finishedAtIso,
        summary: lowQualitySummary,
      });
      appendRunTransition(runRecord, nodeId, "low_quality", lowQualitySummary);
      const lowQualityEvidence = appendNodeEvidence({
        node,
        output: normalizedOutput,
        provider: result.provider,
        summary: lowQualitySummary,
        createdAt: finishedAtIso,
      });
      const lowQualityFeed = buildFeedPost({
        runId: runRecord.runId,
        node,
        isFinalDocument: isFinalTurnNode,
        status: "low_quality",
        createdAt: finishedAtIso,
        summary: lowQualitySummary,
        logs: runLogCollectorRef.current[nodeId] ?? [],
        output: normalizedOutput,
        durationMs: Date.now() - startedAtMs,
        usage: result.usage,
        qualityReport: finalQualityReport,
        inputSources: params.nodeInputSources,
        inputData: input,
        verificationStatus: lowQualityEvidence.verificationStatus,
        confidenceBand: lowQualityEvidence.confidenceBand,
        dataIssues: lowQualityEvidence.dataIssues,
      });
      const lowQualityPost = applyViaArtifactPathsToFeedPost(lowQualityFeed.post, normalizedOutput);
      runRecord.feedPosts?.push(lowQualityPost);
      rememberFeedSource(latestFeedSourceByNodeId, lowQualityPost);
      feedRawAttachmentRef.current[feedAttachmentRawKey(lowQualityPost.id, "markdown")] =
        lowQualityFeed.rawAttachments.markdown;
      feedRawAttachmentRef.current[feedAttachmentRawKey(lowQualityPost.id, "json")] =
        lowQualityFeed.rawAttachments.json;
      params.setLastDoneNodeId(nodeId);
      terminalStateByNodeId[nodeId] = "low_quality";
      scheduleChildren(nodeId);
      return true;
    }
  } else {
    addNodeLog(nodeId, "[품질] 중간 노드는 품질 게이트를 생략합니다. (최종 노드만 검증)");
  }

  const finishedAtIso = new Date().toISOString();
  outputs[nodeId] = normalizedOutput;
  if (qualityReport) {
    addNodeLog(
      nodeId,
      t("run.qualityPassLog", {
        score: qualityReport.score,
        threshold: qualityReport.threshold,
      }),
    );
  }
  setNodeRuntimeFields(nodeId, {
    status: "done",
    output: normalizedOutput,
    qualityReport,
    threadId: result.threadId,
    turnId: result.turnId,
    usage: result.usage,
    finishedAt: finishedAtIso,
    durationMs: Date.now() - startedAtMs,
  });
  setNodeStatus(nodeId, "done", t("run.turnCompleted"));
  runRecord.threadTurnMap[nodeId] = {
    threadId: result.threadId,
    turnId: result.turnId,
  };
  runRecord.providerTrace?.push({
    nodeId,
    executor: result.executor,
    provider: result.provider,
    status: "done",
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: finishedAtIso,
    summary: t("run.turnCompleted"),
  });
  appendRunTransition(runRecord, nodeId, "done", t("run.turnCompleted"));
  const doneEvidence = appendNodeEvidence({
    node,
    output: normalizedOutput,
    provider: result.provider,
    summary: t("run.turnCompleted"),
    createdAt: finishedAtIso,
  });
  const doneFeed = buildFeedPost({
    runId: runRecord.runId,
    node,
    isFinalDocument: isFinalTurnNode,
    status: "done",
    createdAt: finishedAtIso,
    summary: t("run.turnCompleted"),
    logs: runLogCollectorRef.current[nodeId] ?? [],
    output: normalizedOutput,
    durationMs: Date.now() - startedAtMs,
    usage: result.usage,
    qualityReport,
    inputSources: params.nodeInputSources,
    inputData: input,
    verificationStatus: doneEvidence.verificationStatus,
    confidenceBand: doneEvidence.confidenceBand,
    dataIssues: doneEvidence.dataIssues,
  });
  const donePost = applyViaArtifactPathsToFeedPost(doneFeed.post, normalizedOutput);
  runRecord.feedPosts?.push(donePost);
  if (graphRoleId) {
    storeGraphRoleKnowledge({
      roleId: graphRoleId,
      runId: runRecord.runId,
      taskId: String(config.taskId ?? config.handoffTaskId ?? ""),
      output: normalizedOutput,
      logs: runLogCollectorRef.current[nodeId] ?? [],
      roleInstanceId: String(config.roleInstanceId ?? ""),
      pmPlanningMode: config.pmPlanningMode,
    });
  }
  rememberFeedSource(latestFeedSourceByNodeId, donePost);
  feedRawAttachmentRef.current[feedAttachmentRawKey(donePost.id, "markdown")] = doneFeed.rawAttachments.markdown;
  feedRawAttachmentRef.current[feedAttachmentRawKey(donePost.id, "json")] = doneFeed.rawAttachments.json;
  params.setLastDoneNodeId(nodeId);
  terminalStateByNodeId[nodeId] = "done";
  scheduleChildren(nodeId);
  return true;
}
