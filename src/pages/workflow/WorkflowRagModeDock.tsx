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
  const [nextTemplateId, setNextTemplateId] = useState<string>(props.ragTemplateOptions[0]?.value ?? "rag.full");

  useEffect(() => {
    props.ragNodes.forEach((node) => {
      if (!String(node.flowId ?? "").trim()) {
        props.onUpdateFlowId(node.id, "1");
      }
    });
  }, [props.ragNodes, props.onUpdateFlowId]);

  return (
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
  );
}
