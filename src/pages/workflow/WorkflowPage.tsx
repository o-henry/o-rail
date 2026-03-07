import type { ReactNode } from "react";

type WorkflowPageProps = {
  canvasFullscreen: boolean;
  children: ReactNode;
};

export default function WorkflowPage({ canvasFullscreen, children }: WorkflowPageProps) {
  return (
    <div className={`workflow-layout workspace-tab-panel ${canvasFullscreen ? "canvas-only-layout" : ""}`}>
      {children}
    </div>
  );
}
