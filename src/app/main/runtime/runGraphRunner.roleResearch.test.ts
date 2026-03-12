import { describe, expect, it, vi } from "vitest";
import { createRunGraphRunner } from "./runGraphRunner";
import {
  appendNodeEvidenceWithMemory,
  buildFinalNodeFailureReason,
  buildGraphExecutionIndex,
  createRunNodeStateSnapshot,
  createRunRecord,
  enqueueZeroIndegreeNodes,
  findDirectInputNodeIds,
  graphRequiresCodexEngine,
  rememberFeedSource,
  resolveFeedInputSources,
  resolveFinalNodeId,
  resolveGraphDagMaxThreads,
  scheduleChildrenWhenReady,
  scheduleRunnableGraphNodes,
} from "./runGraphFlowUtils";
import { buildNodeInputForNode, buildFinalTurnInputPacket, appendRunTransition } from "./runGraphExecutionUtils";
import { buildRoleNodeScaffold } from "./roleNodeScaffold";
import { executeTurnNodeWithOutputSchemaRetry } from "./turnExecutionUtils";
import { normalizeEvidenceEnvelope, updateRunMemoryByEnvelope, buildConflictLedger, computeFinalConfidence } from "../../mainAppRuntimeHelpers";
import {
  extractFinalAnswer,
  nodeSelectionLabel,
  nodeStatusLabel,
  nodeTypeLabel,
  turnRoleLabel,
} from "../../../features/workflow/labels";
import { defaultNodeConfig, makeNodeId } from "../../../features/workflow/graph-utils/shared";

describe("createRunGraphRunner role research chain", () => {
  it("runs internal research synthesis and verification through to a final document", async () => {
    const pm = buildRoleNodeScaffold({
      roleId: "pm_planner",
      anchorX: 640,
      anchorY: 180,
      includeResearch: true,
      pmPlanningMode: "creative",
    });
    const documentNodeId = makeNodeId("turn");
    const documentNode = {
      id: documentNodeId,
      type: "turn" as const,
      position: { x: 980, y: 180 },
      config: {
        ...defaultNodeConfig("turn"),
        role: "문서화 AGENT",
        promptTemplate: "이전 결과를 한 페이지 문서로 정리합니다.",
        qualityProfile: "synthesis_final",
        artifactType: "DesignArtifact",
      },
    };
    const graph = {
      version: 1 as const,
      nodes: [...pm.nodes, documentNode],
      edges: [
        ...pm.edges,
        {
          from: { nodeId: pm.roleNodeId, port: "out" as const },
          to: { nodeId: documentNodeId, port: "in" as const },
        },
      ],
      knowledge: { files: [], topK: 0, maxChars: 0 },
    };

    const savedRuns: any[] = [];
    const activeFeedRunMeta: any[] = [];
    const statusMessages: string[] = [];
    const nodeStates: Record<string, any> = {};
    const params = {
      isGraphRunning: false,
      isGraphPaused: false,
      runStartGuardRef: { current: false },
      pauseRequestedRef: { current: false },
      cancelRequestedRef: { current: false },
      collectingRunRef: { current: false },
      graph,
      workflowQuestion: "1인 인디게임 개발자를 위한 창의적인 유니티 게임 아이디어 문서를 만들어줘.",
      locale: "ko",
      prepareRunGraphStart: vi.fn(async () => ({ name: "TEST", kind: "workflow", presetKind: "development" })),
      validateUnifiedRunInput: vi.fn((question: string) => ({
        ok: true as const,
        value: { normalizedText: question.trim() },
      })),
      setError: vi.fn(),
      setStatus: vi.fn((message: string) => statusMessages.push(message)),
      setPendingWebConnectCheck: vi.fn(),
      setIsRunStarting: vi.fn(),
      setIsGraphRunning: vi.fn(),
      setIsGraphPaused: vi.fn(),
      setNodeStates: vi.fn((next: any) => {
        const resolved = typeof next === "function" ? next(nodeStates) : next;
        Object.assign(nodeStates, resolved);
      }),
      createRunNodeStateSnapshot: vi.fn(() => createRunNodeStateSnapshot(graph.nodes)),
      runLogCollectorRef: { current: {} as Record<string, string[]> },
      internalMemoryCorpusRef: { current: [] as any[] },
      loadInternalMemoryCorpus: vi.fn(async () => []),
      graphRequiresCodexEngine,
      ensureEngineStarted: vi.fn(async () => {}),
      buildGraphExecutionIndex,
      enqueueZeroIndegreeNodes,
      resolveFeedInputSourcesForNode: resolveFeedInputSources,
      buildNodeInputForNode,
      buildFinalTurnInputPacket,
      appendRunTransition,
      executeTurnNodeWithOutputSchemaRetry,
      executeTurnNode: vi.fn(async (node: any) => {
        const role = String(node.config?.role ?? "");
        if (role.includes("프로젝트 맥락 정리")) {
          return {
            ok: true,
            output: {
              text: "현재 프로젝트는 1인 인디 개발자 기준 빠른 프로토타이핑이 중요하다.",
              meta: { citations: ["repo-context.md"] },
            },
            executor: "codex",
            provider: "codex",
          };
        }
        if (role.includes("플레이어 동기·리스크 조사")) {
          return {
            ok: true,
            output: {
              text: "플레이어는 첫 30초 훅과 짧은 반복 루프에 민감하다.",
              meta: { citations: ["player-motivation.md"] },
            },
            executor: "via_flow",
            provider: "via_flow",
          };
        }
        if (role.includes("조사 종합")) {
          return {
            ok: true,
            output: {
              artifact: {
                payload: {
                  text: "조사 종합 결과: 짧은 프로토타입 범위와 강한 첫 훅이 핵심이다.",
                },
              },
            },
            executor: "codex",
            provider: "codex",
          };
        }
        if (role.includes("조사 검증")) {
          return {
            ok: true,
            output: {
              artifact: {
                payload: {
                  text: "검증 결과: 범위는 2~3개월 MVP로 제한해야 하며 근거는 충분하다.",
                },
              },
            },
            executor: "codex",
            provider: "codex",
          };
        }
        if (role.includes("기획(PM)")) {
          return {
            ok: true,
            output: {
              artifact: {
                payload: {
                  text: "기획안: 이동 손맛과 짧은 전투 루프를 결합한 1인 개발용 아이디어 2개.",
                },
              },
            },
            executor: "codex",
            provider: "codex",
          };
        }
        return {
          ok: true,
          output: {
            artifact: {
              payload: {
                finalDraft:
                  "# 최종 문서\n\n## 후보 1\n- 짧은 이동 루프\n\n## MVP\n- 첫 주 프로토타입 계획 포함",
              },
            },
          },
          executor: "codex",
          provider: "codex",
        };
      }),
      addNodeLog: (nodeId: string, message: string) => {
        const rows = params.runLogCollectorRef.current[nodeId] ?? [];
        rows.push(message);
        params.runLogCollectorRef.current[nodeId] = rows;
      },
      setNodeStatus: (nodeId: string, status: string, message?: string) => {
        nodeStates[nodeId] = { ...(nodeStates[nodeId] ?? { logs: [] }), status, message };
      },
      setNodeRuntimeFields: (nodeId: string, patch: Record<string, unknown>) => {
        nodeStates[nodeId] = { ...(nodeStates[nodeId] ?? { logs: [] }), ...patch };
      },
      validateSimpleSchema: vi.fn(() => []),
      turnOutputSchemaEnabled: true,
      turnOutputSchemaMaxRetry: 0,
      isPauseSignalError: vi.fn(() => false),
      buildQualityReport: vi.fn(async () => ({
        profile: "synthesis_final",
        threshold: 70,
        score: 95,
        decision: "PASS",
        checks: [],
        failures: [],
        warnings: [],
      })),
      cwd: "/tmp/rail-role-research-test",
      executeTransformNode: vi.fn(),
      executeGateNode: vi.fn(),
      simpleWorkflowUi: true,
      handleRunPauseIfNeeded: vi.fn(async () => ({ handled: false, pauseStatusShown: false })),
      scheduleChildrenWhenReady,
      scheduleRunnableGraphNodes,
      t: (key: string) => key,
      buildFeedPost: vi.fn(({ node, status, output, summary, logs, inputSources, inputData }: any) => ({
        post: {
          id: `${node.id}-${status}`,
          nodeId: node.id,
          status,
          summary,
          logs,
          inputSources,
          inputData,
          output,
        },
        rawAttachments: {
          markdown: "",
          json: "",
        },
      })),
      rememberFeedSource,
      feedRawAttachmentRef: { current: {} as Record<string, string> },
      feedAttachmentRawKey: (id: string, kind: string) => `${id}:${kind}`,
      appendNodeEvidenceWithMemory,
      turnRoleLabel,
      nodeTypeLabel,
      nodeSelectionLabel,
      normalizeEvidenceEnvelope,
      updateRunMemoryByEnvelope,
      findDirectInputNodeIds,
      resolveGraphDagMaxThreads,
      codexMultiAgentMode: "balanced",
      createRunRecord,
      buildRailCompatibleDagSnapshot: vi.fn(() => ({})),
      buildAdaptiveRecipeSnapshot: vi.fn(() => undefined),
      lastAppliedPresetRef: { current: null },
      setActiveFeedRunMeta: vi.fn((meta: any) => activeFeedRunMeta.push(meta)),
      activeRunPresetKindRef: { current: null as string | null },
      buildConflictLedger,
      computeFinalConfidence,
      summarizeQualityMetrics: vi.fn(() => ({
        avgScore: 95,
        passRate: 1,
        totalNodes: graph.nodes.length,
        passNodes: graph.nodes.length,
      })),
      resolveFinalNodeId,
      extractFinalAnswer,
      buildFinalNodeFailureReason,
      nodeStatusLabel,
      buildRegressionSummary: vi.fn(async () => ({ status: "unknown" })),
      invokeFn: vi.fn(async () => null),
      saveRunRecord: vi.fn(async (run: any) => {
        savedRuns.push(run);
      }),
      normalizeRunRecord: vi.fn((run: any) => run),
      feedRunCacheRef: { current: {} as Record<string, unknown> },
      buildRunMissionFlow: vi.fn(() => ({})),
      buildRunApprovalSnapshot: vi.fn(() => []),
      buildRunUnityArtifacts: vi.fn(() => ({ unityTaskBundle: null, patchBundle: null })),
      finalizeAdaptiveRun: vi.fn(async () => {}),
      markCodexNodesStatusOnEngineIssue: vi.fn(),
      cleanupRunGraphExecutionState: vi.fn(),
    } as any;

    const runGraph = createRunGraphRunner(params);
    await runGraph(true);

    expect(
      params.setError.mock.calls.filter(([message]: [unknown]) => String(message ?? "").trim().length > 0),
    ).toEqual([]);
    expect(savedRuns).toHaveLength(1);
    const run = savedRuns[0];
    const transitionsByNode = new Map<string, string[]>();
    for (const row of run.transitions) {
      const rows = transitionsByNode.get(row.nodeId) ?? [];
      rows.push(row.status);
      transitionsByNode.set(row.nodeId, rows);
    }

    const synthesisNode = graph.nodes.find((node) => String((node.config as any)?.role ?? "").includes("조사 종합"));
    const verificationNode = graph.nodes.find((node) => String((node.config as any)?.role ?? "").includes("조사 검증"));
    const finalDocumentNode = graph.nodes.find((node) => node.id === documentNodeId);

    expect(transitionsByNode.get(synthesisNode?.id ?? "")).toEqual(expect.arrayContaining(["queued", "running", "done"]));
    expect(transitionsByNode.get(verificationNode?.id ?? "")).toEqual(expect.arrayContaining(["queued", "running", "done"]));
    expect(transitionsByNode.get(finalDocumentNode?.id ?? "")).toEqual(expect.arrayContaining(["queued", "running", "done"]));
    expect(run.finalAnswer).toContain("# 최종 문서");
    expect(statusMessages).toContain("그래프 실행 완료");
  });
});
