import { useEffect, useState } from "react";
import FancySelect from "../../components/FancySelect";
import type { ViaNodeType } from "../../features/workflow/viaCatalog";
import { RAG_SOURCE_PRESETS, type RagSourcePresetId } from "../../features/workflow/ragSourcePresets";

type RagNodeSummary = {
  id: string;
  flowId: string;
  viaNodeType: string;
  viaNodeLabel: string;
  viaCustomKeywords: string;
  viaCustomCountries: string;
  viaCustomSites: string;
  viaCustomMaxItems: number;
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
  onUpdateSourceOptions: (
    nodeId: string,
    patch: {
      viaCustomKeywords?: string;
      viaCustomCountries?: string;
      viaCustomSites?: string;
      viaCustomMaxItems?: number;
    },
  ) => void;
  onAddRagNode: (nodeType: ViaNodeType) => void;
  onApplyTemplate: (templateId: string) => void;
  viaNodeOptions: Array<{ value: ViaNodeType; label: string }>;
  ragTemplateOptions: Array<{ value: string; label: string }>;
};

export default function WorkflowRagModeDock(props: WorkflowRagModeDockProps) {
  const [nextNodeType, setNextNodeType] = useState<ViaNodeType>(props.viaNodeOptions[0]?.value ?? "source.news");
  const [nextTemplateId, setNextTemplateId] = useState<string>(props.ragTemplateOptions[0]?.value ?? "rag.market");
  const [nextSourcePresetId, setNextSourcePresetId] = useState<RagSourcePresetId>(RAG_SOURCE_PRESETS[0]?.id ?? "rag.source.market_hot");
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

  const selectedRagNode =
    props.ragNodes.find((node) => node.id === props.selectedNodeId) ?? props.ragNodes[0] ?? null;
  const selectedSourceNode =
    selectedRagNode && String(selectedRagNode.viaNodeType ?? "").startsWith("source.")
      ? selectedRagNode
      : null;

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

        {selectedSourceNode ? (
          <section className="workflow-rag-custom-section" aria-label="동적 크롤링 옵션">
            <header className="workflow-rag-custom-head">
              <strong>동적 크롤링 옵션</strong>
              <span>{selectedSourceNode.viaNodeLabel}</span>
            </header>
            <section className="workflow-rag-template-row" aria-label="동적 크롤링 프리셋">
              <FancySelect
                ariaLabel="동적 크롤링 프리셋"
                className="modern-select"
                onChange={(next) => setNextSourcePresetId(next as RagSourcePresetId)}
                options={RAG_SOURCE_PRESETS.map((preset) => ({
                  value: preset.id,
                  label: preset.label,
                }))}
                value={nextSourcePresetId}
              />
              <button
                className="mini-action-button"
                onClick={() => {
                  const preset = RAG_SOURCE_PRESETS.find((row) => row.id === nextSourcePresetId) ?? RAG_SOURCE_PRESETS[0];
                  if (!preset) {
                    return;
                  }
                  props.onUpdateSourceOptions(selectedSourceNode.id, {
                    viaCustomKeywords: preset.keywords,
                    viaCustomCountries: preset.countries,
                    viaCustomSites: preset.sites,
                    viaCustomMaxItems: preset.maxItems,
                  });
                }}
                type="button"
              >
                <span className="mini-action-button-label">적용</span>
              </button>
            </section>
            <label className="workflow-rag-custom-field">
              키워드 (쉼표)
              <input
                onChange={(event) =>
                  props.onUpdateSourceOptions(selectedSourceNode.id, {
                    viaCustomKeywords: event.currentTarget.value,
                  })}
                placeholder="예: unity, indie game, steam"
                value={String(selectedSourceNode.viaCustomKeywords ?? "")}
              />
            </label>
            <label className="workflow-rag-custom-field">
              국가 코드 (쉼표)
              <input
                onChange={(event) =>
                  props.onUpdateSourceOptions(selectedSourceNode.id, {
                    viaCustomCountries: event.currentTarget.value,
                  })}
                placeholder="예: KR,US,JP"
                value={String(selectedSourceNode.viaCustomCountries ?? "")}
              />
            </label>
            <label className="workflow-rag-custom-field">
              사이트/URL (쉼표 또는 줄바꿈)
              <textarea
                onChange={(event) =>
                  props.onUpdateSourceOptions(selectedSourceNode.id, {
                    viaCustomSites: event.currentTarget.value,
                  })}
                placeholder={"예: reddit.com, gamasutra.com\n또는 https://example.com/feed"}
                rows={3}
                value={String(selectedSourceNode.viaCustomSites ?? "")}
              />
            </label>
            <label className="workflow-rag-custom-field">
              최대 수집 건수
              <input
                onChange={(event) =>
                  {
                    const digitsOnly = event.currentTarget.value.replace(/[^0-9]/g, "");
                    const parsed = Number(digitsOnly || "24");
                    props.onUpdateSourceOptions(selectedSourceNode.id, {
                      viaCustomMaxItems: Math.max(1, parsed),
                    });
                  }
                }
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="예: 24"
                type="text"
                value={String(selectedSourceNode.viaCustomMaxItems || 24)}
              />
            </label>
          </section>
        ) : null}
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
                        {row.recentLogs.map((line, index) => (
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
