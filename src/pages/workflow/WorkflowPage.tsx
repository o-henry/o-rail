import type { ReactNode } from "react";

type WorkflowPageProps = {
  canvasFullscreen: boolean;
  children: ReactNode;
  workspaceDock?: ReactNode;
};

export default function WorkflowPage({ canvasFullscreen, children, workspaceDock }: WorkflowPageProps) {
  return (
    <div className={`workflow-layout workspace-tab-panel ${canvasFullscreen ? "canvas-only-layout" : ""}`}>
      <div className="workflow-main-surface">{children}</div>
      {!canvasFullscreen && workspaceDock}
    </div>
  );
}
