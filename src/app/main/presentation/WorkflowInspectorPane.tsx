import WorkflowInspectorTools from "./WorkflowInspectorTools";
import WorkflowNodeInspector from "./WorkflowNodeInspector";
import type { WorkflowInspectorNodeProps, WorkflowInspectorToolsProps } from "../workflowInspectorTypes";
import { useI18n } from "../../../i18n";

type WorkflowInspectorPaneProps = {
  canvasFullscreen: boolean;
  toolsProps: WorkflowInspectorToolsProps;
  nodeProps: WorkflowInspectorNodeProps;
};

export default function WorkflowInspectorPane({ canvasFullscreen, toolsProps, nodeProps }: WorkflowInspectorPaneProps) {
  const { t } = useI18n();
  if (canvasFullscreen) {
    return null;
  }

  const hasSelectedNode = Boolean(nodeProps.selectedNode);

  return (
    <aside className={`inspector-pane ${hasSelectedNode ? "is-node-selected" : ""}`.trim()}>
      {!hasSelectedNode ? (
        <div className="inspector-head">
          <div className="inspector-head-title">
            <div className="inspector-title-chip">{nodeProps.nodeSettingsTitle}</div>
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
        </div>
      ) : null}
      <div className="inspector-content">
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
      </div>
    </aside>
  );
}
