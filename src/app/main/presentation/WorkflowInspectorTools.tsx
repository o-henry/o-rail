import FancySelect from "../../../components/FancySelect";
import { knowledgeStatusMeta } from "../../../features/workflow/labels";
import { useI18n } from "../../../i18n";
import type { WorkflowInspectorToolsProps } from "../workflowInspectorTypes";

export default function WorkflowInspectorTools({
  ...props
}: WorkflowInspectorToolsProps) {
  const { t, tp } = useI18n();

  return (
    <section className="inspector-block">
      <div className="tool-dropdown-group">
        <h4>{tp("에이전트 추가")}</h4>
        <button className="mini-action-button workflow-add-agent-button" onClick={() => props.addNode("turn")} type="button">
          <span className="mini-action-button-label">{tp("에이전트 추가")}</span>
        </button>
        <button className="mini-action-button workflow-add-agent-button" onClick={props.addCrawlerNode} type="button">
          <span className="mini-action-button-label">{tp("크롤러 추가")}</span>
        </button>
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
