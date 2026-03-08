import { useEffect, useMemo } from "react";
import type { StudioRoleId } from "../../features/studio/handoffTypes";
import type { GraphNode } from "../../features/workflow/types";
import { useWorkflowWorkspaceTerminalGrid } from "./useWorkflowWorkspaceTerminalGrid";
import type { WorkflowWorkspaceNodeState, WorkflowWorkspaceEvent } from "./workflowWorkspaceRuntimeTypes";

type WorkflowAgentTerminalIslandProps = {
  activeRoleId: StudioRoleId | null;
  cwd: string;
  graphFileName: string;
  graphNodes: GraphNode[];
  isGraphRunning: boolean;
  nodeStates: Record<string, WorkflowWorkspaceNodeState & { threadId?: string }>;
  onInterruptNode: (nodeId: string) => Promise<void>;
  onQueueNodeRequest: (nodeId: string, text: string) => void;
  selectedNode: GraphNode | null;
  workspaceEvents: WorkflowWorkspaceEvent[];
};

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nodeHeading(node: GraphNode | null): string {
  if (!node) {
    return "역할 노드를 선택하세요.";
  }
  const config = node.config as Record<string, unknown>;
  return cleanLine(config.role) || cleanLine(config.label) || node.id;
}

function buildViewportText(input: {
  graphFileName: string;
  paneBuffer: string;
  paneTitle: string;
  selectedNode: GraphNode | null;
  selectedNodeState?: WorkflowWorkspaceNodeState;
  workspaceEvents: WorkflowWorkspaceEvent[];
}) {
  const lines = [
    `[graph] ${cleanLine(input.graphFileName) || "default"}`,
    `[agent] ${input.paneTitle}`,
    `[node] ${nodeHeading(input.selectedNode)}`,
  ];
  if (input.selectedNodeState?.status) {
    lines.push(`[status] ${cleanLine(input.selectedNodeState.status)}`);
  }
  lines.push("");

  const paneBuffer = cleanLine(input.paneBuffer);
  if (paneBuffer) {
    lines.push(input.paneBuffer.trim());
    return lines.join("\n");
  }

  const nodeLogs = input.selectedNodeState?.logs ?? [];
  if (nodeLogs.length > 0) {
    lines.push("[graph trace]");
    nodeLogs.slice(-16).forEach((log) => lines.push(String(log ?? "")));
  }

  const recentEvents = input.workspaceEvents.slice(-8);
  if (recentEvents.length > 0) {
    lines.push("");
    lines.push("[workspace events]");
    recentEvents.forEach((event) => lines.push(`[${event.source}/${event.level ?? "info"}] ${event.message}`));
  }

  if (nodeLogs.length === 0 && recentEvents.length === 0) {
    lines.push("아직 실행 로그가 없습니다.");
    lines.push("그래프에서 역할 노드를 실행하거나 Codex 세션을 시작하면 이 창에 출력이 쌓입니다.");
  }

  return lines.join("\n");
}

export default function WorkflowAgentTerminalIsland(props: WorkflowAgentTerminalIslandProps) {
  const runtime = useWorkflowWorkspaceTerminalGrid({
    cwd: props.cwd,
    graphFileName: props.graphFileName,
    graphNodes: props.graphNodes,
    nodeStates: props.nodeStates,
    workspaceEvents: props.workspaceEvents,
  });
  const {
    clearPane,
    panes,
    selectPaneByRoleId,
    sendPaneInput,
    setPaneInput,
    startPane,
    statusMessage,
    stopPane,
  } = runtime;

  useEffect(() => {
    if (!props.activeRoleId) {
      return;
    }
    selectPaneByRoleId(props.activeRoleId);
  }, [props.activeRoleId, selectPaneByRoleId]);

  const pane = useMemo(() => {
    if (!props.activeRoleId) {
      return null;
    }
    return panes.find((row) => row.roleId === props.activeRoleId) ?? null;
  }, [panes, props.activeRoleId]);

  const visible = Boolean(props.selectedNode && props.activeRoleId && pane);
  const selectedNodeState = props.selectedNode ? props.nodeStates[props.selectedNode.id] : undefined;
  const viewportText = useMemo(
    () =>
      buildViewportText({
        graphFileName: props.graphFileName,
        paneBuffer: pane?.buffer ?? "",
        paneTitle: pane?.title ?? "Codex",
        selectedNode: props.selectedNode,
        selectedNodeState,
        workspaceEvents: props.workspaceEvents,
      }),
    [pane?.buffer, pane?.title, props.graphFileName, props.selectedNode, props.workspaceEvents, selectedNodeState],
  );

  const submitQueuedRequest = async () => {
    if (!pane || !props.selectedNode) {
      return;
    }
    const next = cleanLine(pane.input);
    if (!next) {
      return;
    }
    props.onQueueNodeRequest(props.selectedNode.id, next);
    if (pane.status === "running" || pane.status === "starting") {
      await sendPaneInput(pane.id);
      return;
    }
    setPaneInput(pane.id, "");
  };

  return (
    <div className={`canvas-agent-terminal-slot${visible ? " is-visible" : ""}`} aria-hidden={!visible}>
      <aside className="workflow-agent-terminal-island" aria-label="에이전트 실행 터미널">
        <header className="workflow-agent-terminal-head">
          <div>
            <strong>{pane?.title ?? "에이전트 터미널"}</strong>
            <span>{nodeHeading(props.selectedNode)}</span>
          </div>
          <div className="workflow-agent-terminal-meta">
            <code>{props.selectedNode?.id ?? "no-node"}</code>
            <span>{statusMessage(pane?.status ?? "idle", pane?.exitCode)}</span>
          </div>
        </header>

        <div className="workflow-agent-terminal-path">~/{props.cwd ? props.cwd.split("/").slice(-2).join("/") : "workspace"}</div>

        <pre className="workflow-agent-terminal-body">{viewportText}</pre>

        <div className="workflow-agent-terminal-actions">
          <button
            className="mini-action-button"
            disabled={!pane}
            onClick={() => pane && void startPane(pane.id)}
            type="button"
          >
            <span className="mini-action-button-label">Codex 시작</span>
          </button>
          <button
            className="mini-action-button"
            disabled={!props.selectedNode || !selectedNodeState?.threadId || !props.isGraphRunning}
            onClick={() => props.selectedNode && void props.onInterruptNode(props.selectedNode.id)}
            type="button"
          >
            <span className="mini-action-button-label">그래프 중단</span>
          </button>
          <button
            className="mini-action-button"
            disabled={!pane || (pane.status !== "running" && pane.status !== "starting")}
            onClick={() => pane && void stopPane(pane.id)}
            type="button"
          >
            <span className="mini-action-button-label">CLI 중단</span>
          </button>
          <button
            className="mini-action-button"
            disabled={!pane}
            onClick={() => pane && clearPane(pane.id)}
            type="button"
          >
            <span className="mini-action-button-label">비우기</span>
          </button>
        </div>

        <div className="workflow-agent-terminal-composer">
          <input
            className="workflow-agent-terminal-input"
            onChange={(event) => pane && setPaneInput(pane.id, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitQueuedRequest();
              }
            }}
            placeholder="추가 요구사항 또는 수정 지시"
            value={pane?.input ?? ""}
          />
          <button className="mini-action-button" disabled={!pane} onClick={() => void submitQueuedRequest()} type="button">
            <span className="mini-action-button-label">요구 반영</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
