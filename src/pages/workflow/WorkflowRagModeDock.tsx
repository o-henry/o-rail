import { useEffect, useState } from "react";
import FancySelect from "../../components/FancySelect";
import type { ViaNodeType } from "../../features/workflow/viaCatalog";

type RagNodeSummary = {
  id: string;
  flowId: string;
  viaNodeType: string;
  viaNodeLabel: string;
};

type WorkflowRagModeDockProps = {
  ragNodes: RagNodeSummary[];
  ragNodeProgress: Array<{
    id: string;
    viaNodeLabel: string;
    status: string;
    statusLabel: string;
    recentLogs: string[];
  }>;
  isGraphRunning: boolean;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onUpdateFlowId: (nodeId: string, nextFlowId: string) => void;
  onAddRagNode: (nodeType: ViaNodeType) => void;
  onApplyTemplate: (templateId: string) => void;
  viaNodeOptions: Array<{ value: ViaNodeType; label: string }>;
  ragTemplateOptions: Array<{ value: string; label: string }>;
};

export default function WorkflowRagModeDock(props: WorkflowRagModeDockProps) {
  const [nextNodeType, setNextNodeType] = useState<ViaNodeType>(props.viaNodeOptions[0]?.value ?? "source.news");
  const [nextTemplateId, setNextTemplateId] = useState<string>(props.ragTemplateOptions[0]?.value ?? "rag.market");
  const showProgressIsland =
    props.ragNodes.length > 0 ||
    props.isGraphRunning ||
    props.ragNodeProgress.some((row) => row.recentLogs.length > 0 || row.status !== "idle");

  useEffect(() => {
    props.ragNodes.forEach((node) => {
      if (!String(node.flowId ?? "").trim()) {
        props.onUpdateFlowId(node.id, "1");
      }
    });
  }, [props.ragNodes, props.onUpdateFlowId]);

  return (
    <>
      <aside className="panel-card workflow-rag-dock" aria-label="RAG 워크스페이스">
        <header className="workflow-rag-dock-head">
          <strong>RAG 워크스페이스</strong>
        </header>

        <section className="workflow-rag-template-row" aria-label="RAG 템플릿">
          <FancySelect
            ariaLabel="RAG 템플릿"
            className="modern-select"
            onChange={(next) => setNextTemplateId(String(next))}
            options={props.ragTemplateOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={nextTemplateId}
          />
          <button
            className="mini-action-button"
            onClick={() => props.onApplyTemplate(nextTemplateId)}
            type="button"
          >
            <span className="mini-action-button-label">적용</span>
          </button>
        </section>

        <section className="workflow-rag-add-row" aria-label="RAG 노드 추가">
          <FancySelect
            ariaLabel="RAG 노드 타입"
            className="modern-select"
            onChange={(next) => setNextNodeType(next as ViaNodeType)}
            options={props.viaNodeOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={nextNodeType}
          />
          <button
            className="mini-action-button"
            onClick={() => props.onAddRagNode(nextNodeType)}
            type="button"
          >
            <span className="mini-action-button-label">추가</span>
          </button>
        </section>
      </aside>

      {showProgressIsland && (
        <aside className="panel-card workflow-rag-progress-dock" aria-label="RAG 실행 진행">
          <section className="workflow-rag-progress-island" aria-label="RAG 실행 진행">
            <header className="workflow-rag-progress-head">
              <strong>실행 진행</strong>
              <span>{props.isGraphRunning ? "RUNNING" : "RECENT"}</span>
            </header>
            <ul className="workflow-rag-progress-list">
              {props.ragNodeProgress.length === 0 ? (
                <li className="workflow-rag-progress-empty">실행 로그가 아직 없습니다.</li>
              ) : (
                props.ragNodeProgress.map((row) => (
                  <li
                    className={`workflow-rag-progress-item ${row.id === props.selectedNodeId ? "is-selected" : ""} status-${row.status.replace(/[^a-z0-9_-]+/gi, "-")}`}
                    key={row.id}
                  >
                    <div className="workflow-rag-progress-item-head">
                      <strong>{row.viaNodeLabel}</strong>
                      <span>{row.statusLabel}</span>
                    </div>
                    {row.recentLogs.length > 0 ? (
                      <ul className="workflow-rag-progress-log-lines">
                        {row.recentLogs
                          .slice(-(row.id === props.selectedNodeId ? 4 : 2))
                          .map((line, index) => (
                            <li key={`${row.id}-${index}`}>{line}</li>
                          ))}
                      </ul>
                    ) : (
                      <p className="workflow-rag-progress-log-empty">대기 중</p>
                    )}
                  </li>
                ))
              )}
            </ul>
          </section>
        </aside>
      )}
    </>
  );
}
