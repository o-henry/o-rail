import type { GraphNode } from "../../../features/workflow/types";

export function createWorkflowPresetHandlers(params: any) {
  async function onRespondApproval(decision: any) {
    if (!params.activeApproval) {
      return;
    }

    const gateDecision = params.evaluateApprovalDecisionGate({
      approval: params.activeApproval,
      decision,
    });
    const isAcceptDecision = decision === "accept" || decision === "acceptForSession";
    if (isAcceptDecision && !gateDecision.allowed) {
      params.setError(`승인 게이트 차단: ${gateDecision.reason}`);
      return;
    }

    params.setError("");
    params.setApprovalSubmitting(true);
    try {
      await params.invokeFn("approval_respond", {
        requestId: params.activeApproval.requestId,
        result: {
          decision,
        },
      });
      params.setPendingApprovals((prev: any[]) => prev.slice(1));
      params.setStatus(`승인 응답 전송 (${params.approvalDecisionLabel(decision)})`);
    } catch (e) {
      params.setError(String(e));
    } finally {
      params.setApprovalSubmitting(false);
    }
  }

  function pickDefaultCanvasNodeId(nodes: GraphNode[]): string {
    if (!params.simpleWorkflowUi) {
      return nodes[0]?.id ?? "";
    }
    return nodes.find((node) => node.type === "turn")?.id ?? "";
  }

  function applyPreset(kind: any) {
    const builtPreset = params.buildPresetGraphByKind(kind);
    const presetWithPolicies = params.applyPresetOutputSchemaPolicies({
      ...builtPreset,
      nodes: params.applyPresetTurnPolicies(kind, builtPreset.nodes),
    });
    const preset = params.simplifyPresetForSimpleWorkflow(presetWithPolicies, params.simpleWorkflowUi);
    const localizedPreset = {
      ...preset,
      nodes: preset.nodes.map((node: any) => {
        if (node.type !== "turn") {
          return node;
        }
        const config = node.config as any;
        const localizedPromptTemplate = params.localizePresetPromptTemplate(
          kind,
          node,
          params.locale,
          String(config.promptTemplate ?? "{{input}}"),
        );
        return {
          ...node,
          config: {
            ...config,
            promptTemplate: params.injectOutputLanguageDirective(
              localizedPromptTemplate,
              params.locale,
            ),
          },
        };
      }),
    };
    const nextPreset = params.autoArrangeGraphLayout({
      ...localizedPreset,
      knowledge: params.normalizeKnowledgeConfig(params.graph.knowledge),
    });
    params.setGraph(params.cloneGraph(nextPreset));
    params.setUndoStack([]);
    params.setRedoStack([]);
    const initialNodeId = pickDefaultCanvasNodeId(nextPreset.nodes);
    params.setNodeSelection(initialNodeId ? [initialNodeId] : [], initialNodeId || undefined);
    params.setSelectedEdgeKey("");
    params.setNodeStates({});
    params.setConnectFromNodeId("");
    params.setConnectFromSide(null);
    params.setConnectPreviewStartPoint(null);
    params.setConnectPreviewPoint(null);
    params.setIsConnectingDrag(false);
    params.setMarqueeSelection(null);
    if (typeof params.setCanvasZoom === "function" && typeof params.clampCanvasZoom === "function") {
      params.setCanvasZoom((prev: number) => params.clampCanvasZoom(Math.min(prev, 0.86)));
    }
    params.lastAppliedPresetRef.current = { kind, graph: params.cloneGraph(nextPreset) };
    const templateMeta = params.presetTemplateMeta.find((row: any) => row.key === kind);
    params.setStatus(`${templateMeta?.statusLabel ?? "템플릿"} 로드됨`);
  }

  function applyCostPreset(preset: any) {
    const codexTurnNodes = params.graph.nodes.filter((node: any) => {
      if (node.type !== "turn") {
        return false;
      }
      const config = node.config as any;
      return params.getTurnExecutor(config) === "codex";
    });

    params.setCostPreset(preset);
    params.setModel(params.costPresetDefaultModel[preset]);

    if (codexTurnNodes.length === 0) {
      params.setStatus(`비용 프리셋(${params.costPresetLabel(preset)}) 적용 대상이 없습니다.`);
      return;
    }

    let changed = 0;
    const nextNodes = params.graph.nodes.map((node: any) => {
      if (node.type !== "turn") {
        return node;
      }
      const config = node.config as any;
      if (params.getTurnExecutor(config) !== "codex") {
        return node;
      }
      const targetModel = params.getCostPresetTargetModel(preset, params.isCriticalTurnNode(node));
      const currentModel = params.toTurnModelDisplayName(String(config.model ?? params.defaultTurnModel));
      if (currentModel === targetModel) {
        return node;
      }
      changed += 1;
      return {
        ...node,
        config: {
          ...config,
          model: targetModel,
        },
      };
    });

    if (changed === 0) {
      params.setStatus(`비용 프리셋(${params.costPresetLabel(preset)}) 이미 적용됨`);
      return;
    }

    params.applyGraphChange((prev: any) => ({ ...prev, nodes: nextNodes }));
    params.setStatus(`비용 프리셋(${params.costPresetLabel(preset)}) 적용: ${changed}/${codexTurnNodes.length}개 노드`);
  }

  return {
    onRespondApproval,
    pickDefaultCanvasNodeId,
    applyPreset,
    applyCostPreset,
  };
}
