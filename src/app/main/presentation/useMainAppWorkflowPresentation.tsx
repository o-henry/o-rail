import { useMemo } from "react";
import WorkflowAgentTerminalIsland from "../../../pages/workflow/WorkflowAgentTerminalIsland";
import WorkflowRoleDock from "../../../pages/workflow/WorkflowRoleDock";
import WorkflowUnityAutomationIsland from "./WorkflowUnityAutomationIsland";
import WorkflowInspectorPane from "./WorkflowInspectorPane";
import { buildFeedPageVm, buildWorkflowInspectorPaneProps } from "./mainAppPropsBuilders";

export function useMainAppWorkflowPresentation(params: any) {
  const workflowInspectorPaneProps = buildWorkflowInspectorPaneProps({
    nodeProps: params.nodeProps,
    toolsProps: params.toolsProps,
  });

  const workflowInspectorPaneElement = (
    <WorkflowInspectorPane
      canvasFullscreen={params.canvasFullscreen}
      nodeProps={workflowInspectorPaneProps.nodeProps}
      toolsProps={workflowInspectorPaneProps.toolsProps}
    />
  );

  const workflowRoleDockElement = (
    <WorkflowRoleDock
      onChangePrompt={params.setWorkflowRolePrompt}
      onChangeTaskId={params.setWorkflowRoleTaskId}
      onRunRole={params.onRunRole}
      onSelectRoleId={params.setWorkflowRoleId}
      roleSelectionLockedTo={params.selectedNodeRoleLockId}
      roleStatusById={params.workflowRoleStatusByRole}
      selectedRoleBlockers={params.workflowSelectedRoleBlockers}
      selectedRoleHandoffs={params.workflowSelectedRoleHandoffs}
      prompt={params.workflowRolePrompt}
      roleId={params.workflowRoleId}
      runDisabled={params.isWorkflowBusy}
      taskId={params.workflowRoleTaskId}
      onClearRecentHandoffs={() => params.workflowHandoffPanel.clearHandoffsByRole(params.workflowRoleId)}
      onOpenKnowledge={() => {
        params.setWorkspaceTab("knowledge");
        params.setStatus("데이터베이스 탭으로 이동");
      }}
    />
  );

  const workflowUnityAutomationIslandElement = (
    <WorkflowUnityAutomationIsland
      applyPreset={params.applyPreset}
      cwd={params.cwd}
      isPresetKind={params.isPresetKind}
      presetTemplateOptions={[...params.presetTemplateOptions]}
    />
  );

  const workflowAgentTerminalIslandElement = (
    <WorkflowAgentTerminalIsland
      activeRoleId={params.selectedTerminalRoleLockId}
      cwd={params.cwd}
      graphFileName={params.graphFileName}
      graphNodes={params.graph.nodes}
      isGraphRunning={params.isGraphRunning}
      nodeStates={params.nodeStates}
      onInterruptNode={params.onInterruptWorkflowNode}
      openNodeId={params.openWorkflowAgentTerminalNodeId}
      onQueueNodeRequest={params.enqueueNodeRequest}
      pendingNodeRequests={params.pendingNodeRequests}
      selectedNode={params.selectedTerminalNode}
      workspaceEvents={params.workspaceEvents}
    />
  );

  const selectedNodeSourceKind = String((params.selectedNode?.config as Record<string, unknown> | undefined)?.sourceKind ?? "")
    .trim()
    .toLowerCase();
  const showInspectorFirst =
    !params.selectedNode || (params.selectedNode?.type === "turn" && selectedNodeSourceKind === "data_research");

  const feedPageVm = buildFeedPageVm(params.feedPageVmInput);

  return useMemo(
    () => ({
      feedPageVm,
      showInspectorFirst,
      workflowAgentTerminalIslandElement,
      workflowInspectorPaneElement,
      workflowRoleDockElement,
      workflowUnityAutomationIslandElement,
    }),
    [
      feedPageVm,
      showInspectorFirst,
      workflowAgentTerminalIslandElement,
      workflowInspectorPaneElement,
      workflowRoleDockElement,
      workflowUnityAutomationIslandElement,
    ],
  );
}
