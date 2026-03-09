import WorkflowInspectorTools from "./WorkflowInspectorTools";
import WorkflowNodeInspector from "./WorkflowNodeInspector";
import type { WorkflowInspectorNodeProps, WorkflowInspectorToolsProps } from "../workflowInspectorTypes";
import { useI18n } from "../../../i18n";

type WorkflowInspectorPaneProps = {
  canvasFullscreen: boolean;
  toolsProps: WorkflowInspectorToolsProps;
  nodeProps: WorkflowInspectorNodeProps;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

export default function WorkflowInspectorPane({
  canvasFullscreen,
  toolsProps,
  nodeProps,
  collapsed = false,
  onToggleCollapsed,
}: WorkflowInspectorPaneProps) {
  const { t } = useI18n();
  if (canvasFullscreen) {
    return null;
  }

  const hasSelectedNode = Boolean(nodeProps.selectedNode);

  return (
    <aside className={`inspector-pane ${hasSelectedNode ? "is-node-selected" : ""} ${collapsed ? "is-collapsed" : ""}`.trim()}>
      <div className="inspector-head">
        <div className="inspector-head-title">
          {!hasSelectedNode ? <div className="inspector-title-chip">{nodeProps.nodeSettingsTitle}</div> : <div className="inspector-title-chip">{nodeProps.nodeSettingsTitle}</div>}
          <span
            aria-label={`${nodeProps.nodeSettingsTitle} ${t("common.help")}`}
            className="help-tooltip"
            role="note"
            tabIndex={0}
          >
            ?
          </span>
          <div className="help-tooltip-panel inspector-head-tooltip-panel" role="tooltip">
            {t("workflow.nodeSettings.help")}
          </div>
        </div>
        <button
          aria-label={collapsed ? "노드 설정 펼치기" : "노드 설정 축소"}
          className="workflow-island-collapse-button"
          onClick={onToggleCollapsed}
          type="button"
        >
          <img
            alt=""
            className="workflow-island-collapse-icon"
            src={collapsed ? "/down-arrow.svg" : "/up-arrow.svg"}
          />
        </button>
      </div>
      {!collapsed && <div className="inspector-content">
        <div className="inspector-section inspector-switcher">
          <div className={`inspector-panel inspector-panel-tools ${hasSelectedNode ? "is-hidden" : "is-visible"}`}>
            <div className="inspector-panel-inner">
              <WorkflowInspectorTools {...toolsProps} />
            </div>
          </div>
          <div className={`inspector-panel inspector-panel-node ${hasSelectedNode ? "is-visible" : "is-hidden"}`}>
            <div className="inspector-panel-inner">
              <WorkflowNodeInspector {...nodeProps} />
            </div>
          </div>
        </div>
      </div>}
    </aside>
  );
}
