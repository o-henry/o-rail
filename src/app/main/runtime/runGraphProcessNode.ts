import { handleRunGraphTurnNode } from "./runGraphProcessTurnNode";

export function createRunGraphProcessNode(params: any) {
  return async function processNode(nodeId: string): Promise<void> {
    const node = params.nodeMap.get(nodeId);
    if (!node) {
      return;
    }

    let nodeInputSources: unknown[] = [];
    let nodeInput: unknown;
    try {
      nodeInputSources = params.resolveFeedInputSourcesForNode({
        targetNodeId: nodeId,
        edges: params.graph.edges,
        nodeMap: params.nodeMap,
        workflowQuestion: params.workflowQuestion,
        latestFeedSourceByNodeId: params.latestFeedSourceByNodeId,
        turnRoleLabelFn: params.turnRoleLabel,
        nodeTypeLabelFn: params.nodeTypeLabel,
        nodeSelectionLabelFn: params.nodeSelectionLabel,
      });
      nodeInput = params.buildNodeInputForNode({
        node,
        nodeMap: params.nodeMap,
        edges: params.graph.edges,
        nodeId,
        outputs: params.outputs,
        rootInput: params.workflowQuestion,
        normalizedEvidenceByNodeId: params.normalizedEvidenceByNodeId,
        runMemory: params.getRunMemoryByNodeId(),
      });
    } catch (error) {
      const finishedAtIso = new Date().toISOString();
      const reason = `노드 입력 구성 실패: ${error instanceof Error ? error.message : String(error ?? "알 수 없는 오류")}`;
      params.addNodeLog(nodeId, `[입력] ${reason}`);
      params.setNodeStatus(nodeId, "failed", reason);
      params.setNodeRuntimeFields(nodeId, {
        status: "failed",
        error: reason,
        finishedAt: finishedAtIso,
        durationMs: 0,
      });
      params.appendRunTransition(params.runRecord, nodeId, "failed", reason);
      params.terminalStateByNodeId[nodeId] = "failed";
      params.scheduleChildren(nodeId);
      return;
    }
    const isFinalTurnNode = node.type === "turn" && (params.adjacency.get(nodeId)?.length ?? 0) === 0;

    if (params.pauseRequestedRef.current) {
      const pauseMessage = "사용자 일시정지 요청으로 대기열로 복귀";
      params.setNodeStatus(nodeId, "queued", pauseMessage);
      params.setNodeRuntimeFields(nodeId, {
        status: "queued",
        finishedAt: undefined,
        durationMs: undefined,
      });
      params.appendRunTransition(params.runRecord, nodeId, "queued", pauseMessage);
      if (!params.queue.includes(nodeId)) {
        params.queue.push(nodeId);
      }
      return;
    }

    if (params.cancelRequestedRef.current) {
      params.setNodeStatus(nodeId, "cancelled", "취소 요청됨");
      params.appendRunTransition(params.runRecord, nodeId, "cancelled", "취소 요청됨");
      const cancelledAt = new Date().toISOString();
      const cancelledEvidence = params.appendNodeEvidence({
        node,
        output: nodeInput,
        provider: "system",
        summary: params.t("run.cancelledByUser"),
        createdAt: cancelledAt,
      });
      const cancelledFeed = params.buildFeedPost({
        runId: params.runRecord.runId,
        node,
        isFinalDocument: isFinalTurnNode,
        status: "cancelled",
        createdAt: cancelledAt,
        summary: params.t("run.cancelledByUser"),
        logs: params.runLogCollectorRef.current[nodeId] ?? [],
        inputSources: nodeInputSources,
        inputData: nodeInput,
        verificationStatus: cancelledEvidence.verificationStatus,
        confidenceBand: cancelledEvidence.confidenceBand,
        dataIssues: cancelledEvidence.dataIssues,
      });
      params.runRecord.feedPosts?.push(cancelledFeed.post);
      params.rememberFeedSource(params.latestFeedSourceByNodeId, cancelledFeed.post);
      params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(cancelledFeed.post.id, "markdown")] =
        cancelledFeed.rawAttachments.markdown;
      params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(cancelledFeed.post.id, "json")] =
        cancelledFeed.rawAttachments.json;
      params.terminalStateByNodeId[nodeId] = "cancelled";
      params.scheduleChildren(nodeId);
      return;
    }

    if (params.skipSet.has(nodeId)) {
      params.setNodeStatus(nodeId, "skipped", "분기 결과로 건너뜀");
      params.setNodeRuntimeFields(nodeId, {
        status: "skipped",
        finishedAt: new Date().toISOString(),
      });
      params.appendRunTransition(params.runRecord, nodeId, "skipped", "분기 결과로 건너뜀");
      params.appendNodeEvidence({
        node,
        output: nodeInput,
        provider: "system",
        summary: "분기 결과로 건너뜀",
      });
      params.terminalStateByNodeId[nodeId] = "skipped";
      params.scheduleChildren(nodeId);
      return;
    }

    const parentIds = params.incoming.get(nodeId) ?? [];
    const missingParent = parentIds.find((parentId: string) => !(parentId in params.outputs));
    if (missingParent) {
      const blockedAtIso = new Date().toISOString();
      const blockedReason = `선행 노드(${missingParent}) 결과 없음으로 건너뜀`;
      params.setNodeStatus(nodeId, "skipped", blockedReason);
      params.setNodeRuntimeFields(nodeId, {
        status: "skipped",
        finishedAt: blockedAtIso,
      });
      params.appendRunTransition(params.runRecord, nodeId, "skipped", blockedReason);
      const blockedEvidence = params.appendNodeEvidence({
        node,
        output: nodeInput,
        provider: "system",
        summary: blockedReason,
        createdAt: blockedAtIso,
      });
      const blockedFeed = params.buildFeedPost({
        runId: params.runRecord.runId,
        node,
        isFinalDocument: isFinalTurnNode,
        status: "cancelled",
        createdAt: blockedAtIso,
        summary: blockedReason,
        logs: params.runLogCollectorRef.current[nodeId] ?? [],
        inputSources: nodeInputSources,
        inputData: nodeInput,
        verificationStatus: blockedEvidence.verificationStatus,
        confidenceBand: blockedEvidence.confidenceBand,
        dataIssues: blockedEvidence.dataIssues,
      });
      params.runRecord.feedPosts?.push(blockedFeed.post);
      params.rememberFeedSource(params.latestFeedSourceByNodeId, blockedFeed.post);
      params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(blockedFeed.post.id, "markdown")] =
        blockedFeed.rawAttachments.markdown;
      params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(blockedFeed.post.id, "json")] =
        blockedFeed.rawAttachments.json;
      params.terminalStateByNodeId[nodeId] = "skipped";
      params.scheduleChildren(nodeId);
      return;
    }

    const startedAtMs = Date.now();
    params.setNodeStatus(nodeId, "running", "노드 실행 시작");
    params.setNodeRuntimeFields(nodeId, {
      status: "running",
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: undefined,
      durationMs: undefined,
      usage: undefined,
    });
    params.appendRunTransition(params.runRecord, nodeId, "running");

    const input = isFinalTurnNode
      ? params.buildFinalTurnInputPacket({
          edges: params.graph.edges,
          nodeId,
          currentInput: nodeInput,
          outputs: params.outputs,
          rootInput: params.workflowQuestion,
          normalizedEvidenceByNodeId: params.normalizedEvidenceByNodeId,
          runMemory: params.getRunMemoryByNodeId(),
          nodeMap: params.nodeMap,
        })
      : nodeInput;

    const handledTurnNode = await handleRunGraphTurnNode({
      ...params,
      node,
      nodeId,
      input,
      isFinalTurnNode,
      turnConfig: node.config,
      startedAtMs,
      nodeInputSources,
      setLastDoneNodeId: params.setLastDoneNodeId,
    });
    if (handledTurnNode) {
      return;
    }

    if (node.type === "transform") {
      const result = await params.executeTransformNode(node, input);
      if (!result.ok) {
        const finishedAtIso = new Date().toISOString();
        params.setNodeStatus(nodeId, "failed", result.error ?? "변환 실패");
        params.setNodeRuntimeFields(nodeId, {
          status: "failed",
          error: result.error,
          finishedAt: finishedAtIso,
          durationMs: Date.now() - startedAtMs,
        });
        params.appendRunTransition(params.runRecord, nodeId, "failed", result.error ?? "변환 실패");
        const transformFailedEvidence = params.appendNodeEvidence({
          node,
          output: result.output ?? { error: result.error ?? "변환 실패", input },
          provider: "transform",
          summary: result.error ?? "변환 실패",
          createdAt: finishedAtIso,
        });
        const transformFailedFeed = params.buildFeedPost({
          runId: params.runRecord.runId,
          node,
          status: "failed",
          createdAt: finishedAtIso,
          summary: result.error ?? "변환 실패",
          logs: params.runLogCollectorRef.current[nodeId] ?? [],
          output: result.output,
          error: result.error ?? "변환 실패",
          durationMs: Date.now() - startedAtMs,
          inputSources: nodeInputSources,
          inputData: input,
          verificationStatus: transformFailedEvidence.verificationStatus,
          confidenceBand: transformFailedEvidence.confidenceBand,
          dataIssues: transformFailedEvidence.dataIssues,
        });
        params.runRecord.feedPosts?.push(transformFailedFeed.post);
        params.rememberFeedSource(params.latestFeedSourceByNodeId, transformFailedFeed.post);
        params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(transformFailedFeed.post.id, "markdown")] =
          transformFailedFeed.rawAttachments.markdown;
        params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(transformFailedFeed.post.id, "json")] =
          transformFailedFeed.rawAttachments.json;
        params.terminalStateByNodeId[nodeId] = "failed";
        params.scheduleChildren(nodeId);
        return;
      }

      const finishedAtIso = new Date().toISOString();
      params.outputs[nodeId] = result.output;
      params.setNodeRuntimeFields(nodeId, {
        status: "done",
        output: result.output,
        finishedAt: finishedAtIso,
        durationMs: Date.now() - startedAtMs,
      });
      params.setNodeStatus(nodeId, "done", "변환 완료");
      params.appendRunTransition(params.runRecord, nodeId, "done", "변환 완료");
      const transformDoneEvidence = params.appendNodeEvidence({
        node,
        output: result.output,
        provider: "transform",
        summary: "변환 완료",
        createdAt: finishedAtIso,
      });
      const transformDoneFeed = params.buildFeedPost({
        runId: params.runRecord.runId,
        node,
        status: "done",
        createdAt: finishedAtIso,
        summary: "변환 완료",
        logs: params.runLogCollectorRef.current[nodeId] ?? [],
        output: result.output,
        durationMs: Date.now() - startedAtMs,
        inputSources: nodeInputSources,
        inputData: input,
        verificationStatus: transformDoneEvidence.verificationStatus,
        confidenceBand: transformDoneEvidence.confidenceBand,
        dataIssues: transformDoneEvidence.dataIssues,
      });
      params.runRecord.feedPosts?.push(transformDoneFeed.post);
      params.rememberFeedSource(params.latestFeedSourceByNodeId, transformDoneFeed.post);
      params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(transformDoneFeed.post.id, "markdown")] =
        transformDoneFeed.rawAttachments.markdown;
      params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(transformDoneFeed.post.id, "json")] =
        transformDoneFeed.rawAttachments.json;
      params.setLastDoneNodeId(nodeId);
      params.terminalStateByNodeId[nodeId] = "done";
      params.scheduleChildren(nodeId);
      return;
    }

    const gateResult = params.executeGateNode({
      node,
      input,
      skipSet: params.skipSet,
      graph: params.graph,
      simpleWorkflowUi: params.simpleWorkflowUi,
      addNodeLog: params.addNodeLog,
      validateSimpleSchema: params.validateSimpleSchema,
    });

    if (!gateResult.ok) {
      const finishedAtIso = new Date().toISOString();
      params.setNodeStatus(nodeId, "failed", gateResult.error ?? "분기 실패");
      params.setNodeRuntimeFields(nodeId, {
        status: "failed",
        error: gateResult.error,
        finishedAt: finishedAtIso,
        durationMs: Date.now() - startedAtMs,
      });
      params.appendRunTransition(params.runRecord, nodeId, "failed", gateResult.error ?? "분기 실패");
      const gateFailedEvidence = params.appendNodeEvidence({
        node,
        output: gateResult.output ?? { error: gateResult.error ?? "분기 실패", input },
        provider: "gate",
        summary: gateResult.error ?? "분기 실패",
        createdAt: finishedAtIso,
      });
      const gateFailedFeed = params.buildFeedPost({
        runId: params.runRecord.runId,
        node,
        status: "failed",
        createdAt: finishedAtIso,
        summary: gateResult.error ?? "분기 실패",
        logs: params.runLogCollectorRef.current[nodeId] ?? [],
        output: gateResult.output,
        error: gateResult.error ?? "분기 실패",
        durationMs: Date.now() - startedAtMs,
        inputSources: nodeInputSources,
        inputData: input,
        verificationStatus: gateFailedEvidence.verificationStatus,
        confidenceBand: gateFailedEvidence.confidenceBand,
        dataIssues: gateFailedEvidence.dataIssues,
      });
      params.runRecord.feedPosts?.push(gateFailedFeed.post);
      params.rememberFeedSource(params.latestFeedSourceByNodeId, gateFailedFeed.post);
      params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(gateFailedFeed.post.id, "markdown")] =
        gateFailedFeed.rawAttachments.markdown;
      params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(gateFailedFeed.post.id, "json")] =
        gateFailedFeed.rawAttachments.json;
      params.terminalStateByNodeId[nodeId] = "failed";
      params.scheduleChildren(nodeId);
      return;
    }

    const finishedAtIso = new Date().toISOString();
    params.outputs[nodeId] = gateResult.output;
    params.setNodeRuntimeFields(nodeId, {
      status: "done",
      output: gateResult.output,
      finishedAt: finishedAtIso,
      durationMs: Date.now() - startedAtMs,
    });
    params.setNodeStatus(nodeId, "done", gateResult.message ?? "분기 완료");
    params.appendRunTransition(params.runRecord, nodeId, "done", gateResult.message ?? "분기 완료");
    const gateDoneEvidence = params.appendNodeEvidence({
      node,
      output: gateResult.output,
      provider: "gate",
      summary: gateResult.message ?? "분기 완료",
      createdAt: finishedAtIso,
    });
    const gateDoneFeed = params.buildFeedPost({
      runId: params.runRecord.runId,
      node,
      status: "done",
      createdAt: finishedAtIso,
      summary: gateResult.message ?? "분기 완료",
      logs: params.runLogCollectorRef.current[nodeId] ?? [],
      output: gateResult.output,
      durationMs: Date.now() - startedAtMs,
      inputSources: nodeInputSources,
      inputData: input,
      verificationStatus: gateDoneEvidence.verificationStatus,
      confidenceBand: gateDoneEvidence.confidenceBand,
      dataIssues: gateDoneEvidence.dataIssues,
    });
    params.runRecord.feedPosts?.push(gateDoneFeed.post);
    params.rememberFeedSource(params.latestFeedSourceByNodeId, gateDoneFeed.post);
    params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(gateDoneFeed.post.id, "markdown")] =
      gateDoneFeed.rawAttachments.markdown;
    params.feedRawAttachmentRef.current[params.feedAttachmentRawKey(gateDoneFeed.post.id, "json")] =
      gateDoneFeed.rawAttachments.json;
    params.setLastDoneNodeId(nodeId);
    params.terminalStateByNodeId[nodeId] = "done";
    params.scheduleChildren(nodeId);
  };
}
