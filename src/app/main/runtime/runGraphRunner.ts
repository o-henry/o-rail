import { createRunGraphProcessNode } from "./runGraphProcessNode";
import { finalizeRunGraphExecution } from "./runGraphFinalize";
import { rememberUserMemoryFromText } from "../../../features/studio/userMemoryStore";

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

export function createRunGraphRunner(params: any) {
  return async function onRunGraph(skipWebConnectPreflight = false, questionOverride?: string) {
    if (params.isGraphRunning && params.isGraphPaused) {
      params.pauseRequestedRef.current = false;
      params.setIsGraphPaused(false);
      params.setStatus("그래프 실행 재개");
      return;
    }

    if (params.isGraphRunning || params.runStartGuardRef.current) {
      return;
    }

    const runGroup = await params.prepareRunGraphStart(skipWebConnectPreflight);
    if (!runGroup) {
      return;
    }

    const viaOnlyGraph = isViaOnlyGraph(params.graph);
    const directInputNodeCount = viaOnlyGraph ? 0 : params.findDirectInputNodeIds(params.graph).length;
    const requestedQuestion = typeof questionOverride === "string" ? questionOverride : params.workflowQuestion;
    const seededQuestion =
      viaOnlyGraph && String(requestedQuestion ?? "").trim().length === 0
        ? "RAG 파이프라인 자동 실행"
        : requestedQuestion;
    const unifiedInputResult = params.validateUnifiedRunInput(seededQuestion, params.locale);
    if (!unifiedInputResult.ok) {
      params.setError(unifiedInputResult.errors.join("\n"));
      params.setStatus("그래프 실행 대기");
      return;
    }
    const workflowQuestion = unifiedInputResult.value.normalizedText;
    rememberUserMemoryFromText(workflowQuestion);

    params.runStartGuardRef.current = true;
    params.setPendingWebConnectCheck(null);
    params.setIsRunStarting(true);
    params.setError("");
    params.setStatus("그래프 실행 시작");
    params.setIsGraphRunning(true);
    params.setIsGraphPaused(false);
    params.cancelRequestedRef.current = false;
    params.pauseRequestedRef.current = false;
    params.collectingRunRef.current = true;

    const runStateSnapshot = params.createRunNodeStateSnapshot(params.graph.nodes);
    params.runLogCollectorRef.current = runStateSnapshot.runLogs;
    params.setNodeStates(runStateSnapshot.nodeStates);

    const runRecord = params.createRunRecord({
      graph: params.graph,
      question: workflowQuestion,
      workflowGroupName: runGroup.name,
      workflowGroupKind: runGroup.kind,
      workflowPresetKind: runGroup.presetKind,
      adaptiveRecipeSnapshot:
        typeof params.buildAdaptiveRecipeSnapshot === "function"
          ? params.buildAdaptiveRecipeSnapshot({
              graph: params.graph,
              workflowPresetKind: runGroup.presetKind,
              presetHint: params.lastAppliedPresetRef?.current?.kind,
            })
          : undefined,
    });
    runRecord.collaborationTrace = [
      {
        at: runRecord.startedAt,
        kind: "decompose",
        summary: "rail compatible dag snapshot",
        payload: params.buildRailCompatibleDagSnapshot(params.graph),
      },
    ];
    runRecord.missionFlow = params.buildRunMissionFlow({
      hasDecomposed: params.graph.nodes.length > 0,
      pendingApprovals: 0,
      hasExecutionStarted: true,
      hasExecutionCompleted: false,
      hasSummary: false,
    });
    runRecord.approvalQueueSnapshot = [];
    runRecord.batchRuns = [];
    params.setActiveFeedRunMeta({
      runId: runRecord.runId,
      question: workflowQuestion,
      startedAt: runRecord.startedAt,
      groupName: runGroup.name,
      groupKind: runGroup.kind,
      presetKind: runGroup.presetKind,
    });
    params.activeRunPresetKindRef.current = runGroup.presetKind;

    try {
      params.internalMemoryCorpusRef.current = await params.loadInternalMemoryCorpus({
        invokeFn: params.invokeFn,
        presetKind: runGroup.presetKind,
        onError: params.setError,
      });
      if (params.internalMemoryCorpusRef.current.length > 0) {
        params.setStatus(`그래프 실행 시작 (내부 메모리 ${params.internalMemoryCorpusRef.current.length}개 로드)`);
      }
      const requiresCodexEngine = params.graphRequiresCodexEngine(params.graph.nodes);
      if (requiresCodexEngine) {
        await params.ensureEngineStarted();
      }

      const { nodeMap, indegree, adjacency, incoming } = params.buildGraphExecutionIndex(params.graph);
      const terminalStateByNodeId: Record<string, any> = {};
      const latestFeedSourceByNodeId = new Map<string, any>();

      const outputs: Record<string, unknown> = {};
      const normalizedEvidenceByNodeId: Record<string, any[]> = {};
      let runMemoryByNodeId: Record<string, any> = {};
      const skipSet = new Set<string>();
      let lastDoneNodeId = "";

      const appendNodeEvidence = (payload: any) => {
        const result = params.appendNodeEvidenceWithMemory({
          ...payload,
          normalizedEvidenceByNodeId,
          runMemoryByNodeId,
          runRecord,
          turnRoleLabelFn: params.turnRoleLabel,
          nodeTypeLabelFn: params.nodeTypeLabel,
          normalizeEvidenceEnvelopeFn: params.normalizeEvidenceEnvelope,
          updateRunMemoryByEnvelopeFn: params.updateRunMemoryByEnvelope,
        });
        runMemoryByNodeId = result.runMemoryByNodeId;
        return result.envelope;
      };

      const queue: string[] = [];
      params.enqueueZeroIndegreeNodes({
        indegree,
        queue,
        onQueued: (nodeId: string) => {
          params.setNodeStatus(nodeId, "queued");
          params.appendRunTransition(runRecord, nodeId, "queued");
        },
      });

      const dagMaxThreads = params.resolveGraphDagMaxThreads(params.codexMultiAgentMode, directInputNodeCount);
      const activeTasks = new Map<string, Promise<void>>();
      let activeTurnTasks = 0;
      let pauseStatusShown = false;

      const scheduleChildren = (nodeId: string) => {
        params.scheduleChildrenWhenReady({
          nodeId,
          adjacency,
          indegree,
          queue,
          prioritizeNodeId: (childId: string) => {
            const childNode = nodeMap.get(childId);
            if (!childNode) {
              return false;
            }
            const config =
              childNode.config && typeof childNode.config === "object"
                ? (childNode.config as Record<string, unknown>)
                : {};
            const internalParentNodeId = String(config.internalParentNodeId ?? "").trim();
            const internalNodeKind = String(config.internalNodeKind ?? "").trim();
            return (
              Boolean(internalParentNodeId) &&
              (internalNodeKind === "synthesis" || internalNodeKind === "verification")
            );
          },
          onQueued: (childId: string) => {
            params.setNodeStatus(childId, "queued");
            params.appendRunTransition(runRecord, childId, "queued");
          },
        });
      };

      const getRunMemoryByNodeId = () => runMemoryByNodeId;
      const setLastDoneNodeId = (nodeId: string) => {
        lastDoneNodeId = nodeId;
      };

      const processNode = createRunGraphProcessNode({
        nodeMap,
        graph: params.graph,
        workflowQuestion,
        latestFeedSourceByNodeId,
        turnRoleLabel: params.turnRoleLabel,
        nodeTypeLabel: params.nodeTypeLabel,
        nodeSelectionLabel: params.nodeSelectionLabel,
        resolveFeedInputSourcesForNode: params.resolveFeedInputSourcesForNode,
        buildNodeInputForNode: params.buildNodeInputForNode,
        adjacency,
        pauseRequestedRef: params.pauseRequestedRef,
        cancelRequestedRef: params.cancelRequestedRef,
        skipSet,
        incoming,
        outputs,
        normalizedEvidenceByNodeId,
        getRunMemoryByNodeId,
        buildFinalTurnInputPacket: params.buildFinalTurnInputPacket,
        runRecord,
        runLogCollectorRef: params.runLogCollectorRef,
        buildFeedPost: params.buildFeedPost,
        rememberFeedSource: params.rememberFeedSource,
        feedRawAttachmentRef: params.feedRawAttachmentRef,
        feedAttachmentRawKey: params.feedAttachmentRawKey,
        terminalStateByNodeId,
        scheduleChildren,
        appendRunTransition: params.appendRunTransition,
        appendNodeEvidence,
        setNodeStatus: params.setNodeStatus,
        setNodeRuntimeFields: params.setNodeRuntimeFields,
        t: params.t,
        executeTurnNodeWithOutputSchemaRetry: params.executeTurnNodeWithOutputSchemaRetry,
        executeTurnNode: params.executeTurnNode,
        addNodeLog: params.addNodeLog,
        validateSimpleSchema: params.validateSimpleSchema,
        turnOutputSchemaEnabled: params.turnOutputSchemaEnabled,
        turnOutputSchemaMaxRetry: params.turnOutputSchemaMaxRetry,
        isPauseSignalError: params.isPauseSignalError,
        queue,
        buildQualityReport: params.buildQualityReport,
        cwd: params.cwd,
        executeTransformNode: params.executeTransformNode,
        executeGateNode: params.executeGateNode,
        simpleWorkflowUi: params.simpleWorkflowUi,
        setLastDoneNodeId,
      });

      while (queue.length > 0 || activeTasks.size > 0) {
        const pauseResult: { handled: boolean; pauseStatusShown: boolean } =
          await params.handleRunPauseIfNeeded(activeTasks, pauseStatusShown);
        pauseStatusShown = pauseResult.pauseStatusShown;
        if (pauseResult.handled) {
          continue;
        }

        if (!params.cancelRequestedRef.current) {
          activeTurnTasks = params.scheduleRunnableGraphNodes({
            queue,
            activeTasks,
            dagMaxThreads,
            nodeMap,
            activeTurnTasks,
            processNode,
            reportSoftError: params.reportSoftError,
          });
        }

        if (activeTasks.size > 0) {
          await Promise.race(activeTasks.values());
          continue;
        }

        if (queue.length === 0) {
          break;
        }

        const fallbackNodeId = queue.shift() as string;
        await processNode(fallbackNodeId);
      }

      await finalizeRunGraphExecution({
        cancelRequestedRef: params.cancelRequestedRef,
        graph: params.graph,
        setNodeStates: params.setNodeStates,
        runRecord,
        runLogCollectorRef: params.runLogCollectorRef,
        normalizedEvidenceByNodeId,
        runMemoryByNodeId,
        buildConflictLedger: params.buildConflictLedger,
        computeFinalConfidence: params.computeFinalConfidence,
        summarizeQualityMetrics: params.summarizeQualityMetrics,
        resolveFinalNodeId: params.resolveFinalNodeId,
        lastDoneNodeId,
        terminalStateByNodeId,
        outputs,
        extractFinalAnswer: params.extractFinalAnswer,
        setStatus: params.setStatus,
        t: params.t,
        buildFinalNodeFailureReason: params.buildFinalNodeFailureReason,
        nodeStatusLabel: params.nodeStatusLabel,
        setError: params.setError,
        buildRegressionSummary: params.buildRegressionSummary,
        invokeFn: params.invokeFn,
        saveRunRecord: params.saveRunRecord,
        normalizeRunRecord: params.normalizeRunRecord,
        feedRunCacheRef: params.feedRunCacheRef,
        buildRunMissionFlow: params.buildRunMissionFlow,
        buildRunApprovalSnapshot: params.buildRunApprovalSnapshot,
        buildRunUnityArtifacts: params.buildRunUnityArtifacts,
        finalizeAdaptiveRun: params.finalizeAdaptiveRun,
      });
    } catch (e) {
      params.markCodexNodesStatusOnEngineIssue("failed", `그래프 실행 실패: ${String(e)}`, true);
      params.setError(String(e));
      params.setStatus("그래프 실행 실패");
    } finally {
      params.cleanupRunGraphExecutionState();
    }
  };
}
