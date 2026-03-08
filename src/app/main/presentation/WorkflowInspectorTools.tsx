import { useState } from "react";
import FancySelect from "../../../components/FancySelect";
import { knowledgeStatusMeta } from "../../../features/workflow/labels";
import { useI18n } from "../../../i18n";
import type { WorkflowInspectorToolsProps } from "../workflowInspectorTypes";

export default function WorkflowInspectorTools({
  ...props
}: WorkflowInspectorToolsProps) {
  const { t, tp } = useI18n();
  const [autoResearchEnabled, setAutoResearchEnabled] = useState(true);

  return (
    <section className="inspector-block">
      <div className="tool-dropdown-group">
        <h4>{tp("역할 노드")}</h4>
        <div className="workflow-handoff-create workflow-role-node-create">
          <FancySelect
            ariaLabel={tp("역할 노드")}
            className="modern-select workflow-handoff-select"
            onChange={(next) => props.setHandoffFromRole(next as typeof props.handoffFromRole)}
            options={props.handoffRoleOptions}
            value={props.handoffFromRole}
          />
          <button
            aria-pressed={autoResearchEnabled}
            className={`mini-action-button workflow-handoff-create-button${autoResearchEnabled ? " is-enabled" : ""}`}
            onClick={() => setAutoResearchEnabled((prev) => !prev)}
            type="button"
          >
            <span className="mini-action-button-label">
              {autoResearchEnabled ? tp("자동 리서치 연결 켜짐") : tp("자동 리서치 연결 꺼짐")}
            </span>
          </button>
        </div>
        <div className="workflow-handoff-actions">
          <button
            className="mini-action-button workflow-handoff-create-button"
            onClick={() => props.addRoleNode(props.handoffFromRole, autoResearchEnabled)}
            type="button"
          >
            <span className="mini-action-button-label">{tp("역할 노드 추가")}</span>
          </button>
          <button
            className="mini-action-button workflow-handoff-create-button workflow-research-node-create-button"
            onClick={props.addCrawlerNode}
            type="button"
          >
            <span className="mini-action-button-label">{tp("데이터 노드 추가")}</span>
          </button>
        </div>
        <div className="inspector-empty">
          {autoResearchEnabled
            ? tp("역할 노드를 추가하면 앞단에 조사용 RAG 체인을 함께 생성합니다. 연결은 자동으로 구성되지만 이후 편집은 직접 할 수 있습니다.")
            : tp("역할 노드만 단독으로 추가합니다. 연결은 캔버스에서 직접 이어주세요.")}
        </div>
      </div>

      <div className="tool-dropdown-group">
        <h4>{t("workflow.costPreset")}</h4>
        <FancySelect
          ariaLabel={t("workflow.costPreset")}
          className="modern-select"
          emptyMessage={tp("선택 가능한 프리셋이 없습니다.")}
          onChange={(value) => {
            if (props.isCostPreset(value)) {
              props.applyCostPreset(value);
            }
          }}
          options={props.costPresetOptions}
          value={props.costPreset}
        />
      </div>

      <div className="tool-dropdown-group">
        <h4>{t("workflow.knowledge.attachments")}</h4>
        <div className="graph-file-actions">
          <button className="mini-action-button" onClick={props.onOpenKnowledgeFilePicker} type="button">
            <span className="mini-action-button-label">{t("workflow.knowledge.addFile")}</span>
          </button>
        </div>
        <div className="knowledge-file-list">
          {props.graphKnowledge.files.length === 0 && (
            <div className="knowledge-file-empty">{t("workflow.knowledge.empty")}</div>
          )}
          {props.graphKnowledge.files.map((file) => {
            const statusMeta = knowledgeStatusMeta(file.status);
            return (
              <div className="knowledge-file-item" key={file.id}>
                <div className="knowledge-file-main">
                  <span className="knowledge-file-name" title={file.path}>
                    {file.name}
                  </span>
                  <span className={`knowledge-status-pill ${statusMeta.tone}`}>
                    {statusMeta.label}
                  </span>
                </div>
                <div className="knowledge-file-actions">
                  <button
                    className={`mini-action-button ${file.enabled ? "is-enabled" : ""}`}
                    onClick={() => props.onToggleKnowledgeFileEnabled(file.id)}
                    type="button"
                  >
                    <span className="mini-action-button-label">
                      {file.enabled ? t("workflow.knowledge.inUse") : t("workflow.knowledge.exclude")}
                    </span>
                  </button>
                  <button
                    className="mini-action-button"
                    onClick={() => props.onRemoveKnowledgeFile(file.id)}
                    type="button"
                  >
                    <span className="mini-action-button-label">{t("common.delete")}</span>
                  </button>
                </div>
                {file.statusMessage && <div className="knowledge-file-message">{file.statusMessage}</div>}
              </div>
            );
          })}
        </div>
        <label className="knowledge-config-label">
          {t("workflow.knowledge.length")}
          <FancySelect
            ariaLabel={t("workflow.knowledge.length")}
            className="modern-select"
            onChange={(next) => {
              const parsed = Number(next) || props.knowledgeDefaultMaxChars;
              props.applyGraphChange((prev) => ({
                ...prev,
                knowledge: {
                  ...(prev.knowledge ?? props.defaultKnowledgeConfig()),
                  maxChars: Math.max(300, Math.min(20_000, parsed)),
                },
              }));
            }}
            options={props.knowledgeMaxCharsOptions}
            value={props.selectedKnowledgeMaxCharsOption}
          />
        </label>
        <div className="inspector-empty">{tp("길이를 길게 할수록 근거는 늘고, 응답 속도와 사용량은 증가할 수 있습니다.")}</div>
      </div>

    </section>
  );
}
