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
  pendingNodeRequests: Record<string, string[]>;
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

function promptPreview(node: GraphNode | null): string {
  if (!node) {
    return "";
  }
  const config = node.config as Record<string, unknown>;
  const raw = cleanLine(config.promptTemplate);
  if (!raw) {
    return "";
  }
  return raw.length > 520 ? `${raw.slice(0, 520)}...` : raw;
}

export function buildViewportText(input: {
  graphFileName: string;
  paneBuffer: string;
  paneTitle: string;
  selectedNode: GraphNode | null;
  selectedNodeState?: WorkflowWorkspaceNodeState;
  pendingRequests: string[];
}) {
  const config = (input.selectedNode?.config ?? {}) as Record<string, unknown>;
  const lines = [
    `[graph] ${cleanLine(input.graphFileName) || "default"}`,
    `[agent] ${input.paneTitle}`,
    `[node] ${nodeHeading(input.selectedNode)}`,
  ];
  const taskId = cleanLine(config.taskId) || cleanLine(config.handoffTaskId);
  const sourceKind = cleanLine(config.sourceKind);
  if (taskId) {
    lines.push(`[task] ${taskId}`);
  }
  if (sourceKind) {
    lines.push(`[mode] ${sourceKind}`);
  }
  if (input.selectedNodeState?.status) {
    lines.push(`[status] ${cleanLine(input.selectedNodeState.status)}`);
  }
  lines.push("");

  const requestPreview = promptPreview(input.selectedNode);
  if (requestPreview) {
    lines.push("[current request]");
    lines.push(requestPreview);
    lines.push("");
  }

  if (input.pendingRequests.length > 0) {
    lines.push("[queued follow-ups]");
    input.pendingRequests.slice(-4).forEach((request, index) => {
      lines.push(`${index + 1}. ${cleanLine(request)}`);
    });
    lines.push("");
  }

  const paneBuffer = cleanLine(input.paneBuffer);
  if (paneBuffer) {
    lines.push(input.paneBuffer.trim());
    return lines.join("\n");
  }

  const nodeLogs = input.selectedNodeState?.logs ?? [];
  if (nodeLogs.length > 0) {
    lines.push("[graph trace]");
    nodeLogs.slice(-16).forEach((log) => lines.push(String(log ?? "")));
    return lines.join("\n");
  }
  lines.push("이 역할의 실행 로그가 아직 없습니다.");
  lines.push("Codex 시작을 누르면 선택한 역할 전용 CLI 세션이 이 창에 연결됩니다.");

  return lines.join("\n");
}

export function canSubmitNodeFollowup(paneInput: string | null | undefined, hasPane: boolean): boolean {
  return hasPane && cleanLine(paneInput).length > 0;
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
  const pendingRequests = props.selectedNode ? props.pendingNodeRequests[props.selectedNode.id] ?? [] : [];
  const viewportText = useMemo(
    () =>
      buildViewportText({
        graphFileName: props.graphFileName,
        paneBuffer: pane?.buffer ?? "",
        paneTitle: pane?.title ?? "Codex",
        selectedNode: props.selectedNode,
        selectedNodeState,
        pendingRequests,
      }),
    [pane?.buffer, pane?.title, props.graphFileName, props.selectedNode, selectedNodeState, pendingRequests],
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

  const canStopGraph = Boolean(props.selectedNode && selectedNodeState?.threadId && props.isGraphRunning);
  const canStopCli = Boolean(pane && (pane.status === "running" || pane.status === "starting"));
  const canSubmitFollowup = canSubmitNodeFollowup(pane?.input, Boolean(pane));

  const stopAll = async () => {
    const tasks: Promise<unknown>[] = [];
    if (props.selectedNode && canStopGraph) {
      tasks.push(props.onInterruptNode(props.selectedNode.id));
    }
    if (pane && canStopCli) {
      tasks.push(stopPane(pane.id));
    }
    await Promise.allSettled(tasks);
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

        <div className="workflow-agent-terminal-panel workflow-agent-terminal-log-panel">
          <pre className="workflow-agent-terminal-body">{viewportText}</pre>
        </div>

        <div className="workflow-agent-terminal-panel workflow-agent-terminal-composer-panel">
          <div className="question-input agents-composer workflow-question-input workflow-agent-terminal-composer">
          <textarea
            className="workflow-agent-terminal-input"
            onChange={(event) => pane && setPaneInput(pane.id, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitQueuedRequest();
              }
            }}
            placeholder="추가 요구사항 또는 수정 지시"
            rows={1}
            value={pane?.input ?? ""}
          />
          <div className="question-input-footer workflow-agent-terminal-composer-footer">
            <div className="agents-composer-left workflow-agent-terminal-left-actions">
              <button
                className="mini-action-button"
                disabled={!pane}
                onClick={() => pane && void startPane(pane.id)}
                type="button"
              >
                <span className="mini-action-button-label">시작</span>
              </button>
              <button
                className="mini-action-button"
                disabled={!canStopGraph && !canStopCli}
                onClick={() => void stopAll()}
                type="button"
              >
                <span className="mini-action-button-label">중단</span>
              </button>
            </div>
            <button
              className="primary-action question-create-button agents-send-button"
              disabled={!canSubmitFollowup}
              onClick={() => void submitQueuedRequest()}
              type="button"
            >
              <img alt="" aria-hidden="true" className="question-create-icon" src="/up.svg" />
            </button>
          </div>
        </div>
        </div>
      </aside>
    </div>
  );
}
