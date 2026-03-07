import type { GraphNode } from "../../features/workflow/types";
import type { WorkflowWorkspaceNodeState, WorkflowWorkspaceEvent } from "./workflowWorkspaceRuntimeTypes";

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function nodeTitle(node: GraphNode): string {
  const config = node.config as Record<string, unknown>;
  for (const key of ["label", "title", "name", "promptLabel"]) {
    const value = String(config[key] ?? "").trim();
    if (value) {
      return value;
    }
  }
  return node.id;
}

export function appendWorkflowWorkspaceChunk(current: string, chunk: string): string {
  const next = `${current}${stripAnsi(chunk)}`;
  return next.length > 60000 ? next.slice(-60000) : next;
}

export function buildWorkflowWorkspaceObserver(input: {
  graphFileName: string;
  graphNodes: GraphNode[];
  nodeStates: Record<string, WorkflowWorkspaceNodeState>;
  workspaceEvents: WorkflowWorkspaceEvent[];
}): string {
  const lines: string[] = [];
  const graphName = String(input.graphFileName ?? "").trim() || "default";
  lines.push(`[graph] ${graphName}`);

  const activeNodes = input.graphNodes
    .map((node) => {
      const state = input.nodeStates[node.id];
      return {
        id: node.id,
        title: nodeTitle(node),
        status: state?.status ?? "idle",
        logs: state?.logs ?? [],
      };
    })
    .filter((node) => node.status !== "idle" || node.logs.length > 0)
    .slice(0, 24);

  for (const node of activeNodes) {
    lines.push(`[node:${node.status}] ${node.title}`);
    for (const log of node.logs.slice(-4)) {
      lines.push(`  ${stripAnsi(String(log ?? ""))}`);
    }
  }

  for (const event of input.workspaceEvents.slice(0, 48).reverse()) {
    lines.push(`[${event.source}/${event.level ?? "info"}] ${stripAnsi(event.message)}`);
  }

  return lines.join("\n");
}
