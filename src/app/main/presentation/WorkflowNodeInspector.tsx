import FancySelect from "../../../components/FancySelect";
import {
  getWebProviderFromExecutor,
  normalizeWebResultMode,
  toTurnModelDisplayName,
  type TurnConfig,
} from "../../../features/workflow/domain";
import { turnRoleLabel } from "../../../features/workflow/labels";
import type { GateConfig, TransformConfig } from "../../../features/workflow/types";
import { useI18n } from "../../../i18n";
import { InspectorSectionTitle } from "../../mainAppGraphHelpers";
import type { WorkflowInspectorNodeProps } from "../workflowInspectorTypes";
import { STUDIO_ROLE_TEMPLATES } from "../../../features/studio/roleTemplates";

export default function WorkflowNodeInspector({
  simpleWorkflowUI,
  selectedNode,
  selectedTurnExecutor,
  updateSelectedNodeConfig,
  turnExecutorOptions,
  turnExecutorLabel,
  turnModelOptions,
  model,
  selectedTurnConfig,
  selectedQualityProfile,
  qualityProfileOptions,
  selectedQualityThresholdOption,
  qualityThresholdOptions,
  normalizeQualityThreshold,
  artifactTypeOptions,
  selectedArtifactType,
  outgoingNodeOptions,
}: WorkflowInspectorNodeProps) {
  const { t } = useI18n();

  if (!selectedNode) {
    return null;
  }

  const selectedConfig = selectedNode.config as TurnConfig & Record<string, unknown>;
  const isHandoffTurnNode =
    selectedNode.type === "turn" && String(selectedConfig.sourceKind ?? "").trim().toLowerCase() === "handoff";
  const studioRoleOptions = STUDIO_ROLE_TEMPLATES.map((row) => ({
    value: row.id,
    label: row.label,
  }));
  const handoffStageValue = String(selectedConfig.handoffStage ?? "analyze");

  return (
    <>
      {isHandoffTurnNode && (
        <section className="inspector-block form-grid">
          <InspectorSectionTitle
            className="workflow-handoff-section-title"
            help="핸드오프 노드는 역할 간 인수인계 전용입니다. 실행기/모델/역할/요청사항만 유지해 협업 흐름을 단순화합니다."
            title="핸드오프 노드 설정"
          />
          <label>
            에이전트
            <FancySelect
              ariaLabel="에이전트"
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("executor", next)}
              options={turnExecutorOptions.map((option) => ({
                value: option,
                label: turnExecutorLabel(option),
              }))}
              value={selectedTurnExecutor}
            />
          </label>
          {selectedTurnExecutor === "codex" && (
            <label>
              모델
              <FancySelect
                ariaLabel="모델"
                className="modern-select"
                onChange={(next) => updateSelectedNodeConfig("model", next)}
                options={turnModelOptions.map((option) => ({ value: option, label: option }))}
                value={toTurnModelDisplayName(String(selectedConfig.model ?? model))}
              />
            </label>
          )}
          <label>
            담당 역할
            <FancySelect
              ariaLabel="담당 역할"
              className="modern-select"
              onChange={(next) => {
                const role = String(next);
                updateSelectedNodeConfig("handoffRoleId", role);
                const matched = STUDIO_ROLE_TEMPLATES.find((row) => row.id === role);
                if (matched) {
                  updateSelectedNodeConfig("role", `${matched.label} AGENT`);
                }
              }}
              options={studioRoleOptions}
              value={String(selectedConfig.handoffRoleId ?? "pm_planner")}
            />
          </label>
          <label>
            인수인계 대상
            <FancySelect
              ariaLabel="인수인계 대상"
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("handoffToRoleId", next)}
              options={studioRoleOptions}
              value={String(selectedConfig.handoffToRoleId ?? "client_programmer")}
            />
          </label>
          <label>
            단계
            <FancySelect
              ariaLabel="핸드오프 단계"
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("handoffStage", next)}
              options={[
                { value: "analyze", label: "분석" },
                { value: "implement", label: "구현" },
                { value: "test", label: "테스트" },
                { value: "verify", label: "검증" },
                { value: "document", label: "문서화" },
              ]}
              value={handoffStageValue}
            />
          </label>
          <label>
            역할 표시명
            <input
              onChange={(e) => updateSelectedNodeConfig("role", e.currentTarget.value)}
              value={String(selectedConfig.role ?? "")}
            />
          </label>
          <label>
            요청사항
            <textarea
              className="prompt-template-textarea"
              onChange={(e) => updateSelectedNodeConfig("promptTemplate", e.currentTarget.value)}
              rows={5}
              value={String(selectedConfig.promptTemplate ?? "{{input}}")}
            />
          </label>
          <label>
            완료 산출물 체크
            <textarea
              className="prompt-template-textarea"
              onChange={(e) => updateSelectedNodeConfig("handoffChecklist", e.currentTarget.value)}
              rows={3}
              value={String(selectedConfig.handoffChecklist ?? "완료 기준과 인수인계 파일 경로를 함께 보고")}
            />
          </label>
          <div className="inspector-empty">
            핸드오프 노드는 역할 간 전달을 위한 전용 노드입니다. 일반 노드 설정(품질 프로필/출력 스키마)은 최소화되어 표시됩니다.
          </div>
        </section>
      )}

      {selectedNode.type === "turn" && !isHandoffTurnNode && (
        <section className="inspector-block form-grid">
          <InspectorSectionTitle
            help={t("workflow.inspector.agent.help")}
            title={t("workflow.inspector.agent.title")}
          />
          <label>
            {t("feed.agent")}
            <FancySelect
              ariaLabel={t("feed.agent")}
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("executor", next)}
              options={turnExecutorOptions.map((option) => ({
                value: option,
                label: turnExecutorLabel(option),
              }))}
              value={selectedTurnExecutor}
            />
          </label>
          {selectedTurnExecutor === "codex" && (
            <label>
              {t("feed.model")}
              <FancySelect
                ariaLabel={t("feed.model")}
                className="modern-select"
                onChange={(next) => updateSelectedNodeConfig("model", next)}
                options={turnModelOptions.map((option) => ({ value: option, label: option }))}
                value={toTurnModelDisplayName(String((selectedNode.config as TurnConfig).model ?? model))}
              />
            </label>
          )}
          {selectedTurnExecutor === "ollama" && (
            <label>
              {t("feed.ollamaModel")}
              <input
                onChange={(e) => updateSelectedNodeConfig("ollamaModel", e.currentTarget.value)}
                placeholder={t("feed.ollamaPlaceholder")}
                value={String((selectedNode.config as TurnConfig).ollamaModel ?? "llama3.1:8b")}
              />
            </label>
          )}
          {getWebProviderFromExecutor(selectedTurnExecutor) && (
            <>
              <label>
                {t("feed.webResultMode")}
                <FancySelect
                  ariaLabel={t("feed.webResultMode")}
                  className="modern-select"
                  onChange={(next) => updateSelectedNodeConfig("webResultMode", next)}
                  options={[
                    { value: "bridgeAssisted", label: t("feed.webMode.bridge") },
                    { value: "manualPasteText", label: t("feed.webMode.text") },
                    { value: "manualPasteJson", label: t("feed.webMode.json") },
                  ]}
                  value={String(normalizeWebResultMode((selectedNode.config as TurnConfig).webResultMode))}
                />
              </label>
              <label>
                {t("feed.webTimeoutMs")}
                <input
                  onChange={(e) =>
                    updateSelectedNodeConfig("webTimeoutMs", Number(e.currentTarget.value) || 180_000)
                  }
                  type="number"
                  value={String((selectedNode.config as TurnConfig).webTimeoutMs ?? 180_000)}
                />
              </label>
              <div className="inspector-empty">
                {t("workflow.inspector.web.help")}
              </div>
            </>
          )}
          <label>
            {t("feed.role")}
            <input
              onChange={(e) => updateSelectedNodeConfig("role", e.currentTarget.value)}
              placeholder={turnRoleLabel(selectedNode)}
              value={String((selectedNode.config as TurnConfig).role ?? "")}
            />
          </label>
          <label>
            {t("workflow.inspector.knowledgeEnabled")}
            <FancySelect
              ariaLabel={t("workflow.inspector.knowledgeEnabled")}
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("knowledgeEnabled", next === "true")}
              options={[
                { value: "true", label: t("feed.option.enabled") },
                { value: "false", label: t("feed.option.disabled") },
              ]}
              value={String((selectedNode.config as TurnConfig).knowledgeEnabled !== false)}
            />
          </label>
          <label>
            {t("feed.qualityProfile")}
            <FancySelect
              ariaLabel={t("feed.qualityProfile")}
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("qualityProfile", next)}
              options={qualityProfileOptions}
              value={selectedQualityProfile}
            />
          </label>
          <label>
            {t("feed.qualityThreshold")}
            <FancySelect
              ariaLabel={t("feed.qualityThreshold")}
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("qualityThreshold", normalizeQualityThreshold(next))}
              options={qualityThresholdOptions}
              value={selectedQualityThresholdOption}
            />
          </label>
          {selectedQualityProfile === "code_implementation" && (
            <>
              <label>
                {t("feed.qualityCommand.enabled")}
                <FancySelect
                  ariaLabel={t("feed.qualityCommand.enabled")}
                  className="modern-select"
                  onChange={(next) => updateSelectedNodeConfig("qualityCommandEnabled", next === "true")}
                  options={[
                    { value: "false", label: t("feed.option.disabled") },
                    { value: "true", label: t("feed.option.enabled") },
                  ]}
                  value={String(selectedTurnConfig?.qualityCommandEnabled === true)}
                />
              </label>
              <label>
                {t("workflow.inspector.qualityCommands")}
                <textarea
                  className="prompt-template-textarea"
                  onChange={(e) => updateSelectedNodeConfig("qualityCommands", e.currentTarget.value)}
                  rows={3}
                  value={String(selectedTurnConfig?.qualityCommands ?? "npm run build")}
                />
              </label>
            </>
          )}
          {!simpleWorkflowUI && (
            <label>
              {t("workflow.inspector.artifactType")}
              <FancySelect
                ariaLabel={t("workflow.inspector.artifactType")}
                className="modern-select"
                onChange={(next) => updateSelectedNodeConfig("artifactType", next)}
                options={artifactTypeOptions}
                value={selectedArtifactType}
              />
            </label>
          )}
          <label>
            {t("feed.promptTemplate")}
            <textarea
              className="prompt-template-textarea"
              onChange={(e) => updateSelectedNodeConfig("promptTemplate", e.currentTarget.value)}
              rows={6}
              value={String((selectedNode.config as TurnConfig).promptTemplate ?? "{{input}}")}
            />
          </label>
          <label>
            {t("workflow.inspector.outputSchemaOptional")}
            <textarea
              className="prompt-template-textarea"
              onChange={(e) => updateSelectedNodeConfig("outputSchemaJson", e.currentTarget.value)}
              rows={4}
              value={String((selectedNode.config as TurnConfig).outputSchemaJson ?? "")}
            />
          </label>
        </section>
      )}

      {!simpleWorkflowUI && selectedNode.type === "transform" && (
        <section className="inspector-block form-grid">
          <InspectorSectionTitle
            help={t("workflow.inspector.transform.help")}
            title={t("workflow.inspector.transform.title")}
          />
          <label>
            {t("workflow.inspector.transform.mode")}
            <FancySelect
              ariaLabel={t("workflow.inspector.transform.mode")}
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("mode", next)}
              options={[
                { value: "pick", label: t("transform.mode.pick") },
                { value: "merge", label: t("transform.mode.merge") },
                { value: "template", label: t("transform.mode.template") },
              ]}
              value={String((selectedNode.config as TransformConfig).mode ?? "pick")}
            />
          </label>
          <label>
            {t("workflow.inspector.transform.pickPath")}
            <input
              onChange={(e) => updateSelectedNodeConfig("pickPath", e.currentTarget.value)}
              placeholder={t("workflow.inspector.transform.pickPathPlaceholder")}
              value={String((selectedNode.config as TransformConfig).pickPath ?? "")}
            />
          </label>
          <div className="inspector-empty">{t("workflow.inspector.transform.pickPathHelp")}</div>
          <label>
            {t("workflow.inspector.transform.mergeJson")}
            <textarea
              onChange={(e) => updateSelectedNodeConfig("mergeJson", e.currentTarget.value)}
              placeholder={t("workflow.inspector.transform.mergeJsonPlaceholder")}
              rows={3}
              value={String((selectedNode.config as TransformConfig).mergeJson ?? "{}")}
            />
          </label>
          <div className="inspector-empty">{t("workflow.inspector.transform.mergeJsonHelp")}</div>
          <label>
            {t("workflow.inspector.transform.template")}
            <textarea
              className="transform-template-textarea"
              onChange={(e) => updateSelectedNodeConfig("template", e.currentTarget.value)}
              rows={5}
              value={String((selectedNode.config as TransformConfig).template ?? "{{input}}")}
            />
          </label>
          <div className="inspector-empty">
            {t("workflow.inspector.transform.templateHelp")}
          </div>
        </section>
      )}

      {!simpleWorkflowUI && selectedNode.type === "gate" && (
        <section className="inspector-block form-grid">
          <InspectorSectionTitle
            help={t("workflow.inspector.gate.help")}
            title={t("workflow.inspector.gate.title")}
          />
          <label>
            {t("workflow.inspector.gate.decisionPath")}
            <input
              onChange={(e) => updateSelectedNodeConfig("decisionPath", e.currentTarget.value)}
              value={String((selectedNode.config as GateConfig).decisionPath ?? "DECISION")}
            />
          </label>
          <div className="inspector-empty">{t("workflow.inspector.gate.decisionPathHelp")}</div>
          <label>
            {t("workflow.inspector.gate.passNext")}
            <FancySelect
              ariaLabel={t("workflow.inspector.gate.passNext")}
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("passNodeId", next)}
              options={[{ value: "", label: t("common.none") }, ...outgoingNodeOptions]}
              value={String((selectedNode.config as GateConfig).passNodeId ?? "")}
            />
          </label>
          <div className="inspector-empty">{t("workflow.inspector.gate.passHelp")}</div>
          <label>
            {t("workflow.inspector.gate.rejectNext")}
            <FancySelect
              ariaLabel={t("workflow.inspector.gate.rejectNext")}
              className="modern-select"
              onChange={(next) => updateSelectedNodeConfig("rejectNodeId", next)}
              options={[{ value: "", label: t("common.none") }, ...outgoingNodeOptions]}
              value={String((selectedNode.config as GateConfig).rejectNodeId ?? "")}
            />
          </label>
          <div className="inspector-empty">{t("workflow.inspector.gate.rejectHelp")}</div>
          <label>
            {t("workflow.inspector.gate.schemaOptional")}
            <textarea
              onChange={(e) => updateSelectedNodeConfig("schemaJson", e.currentTarget.value)}
              rows={4}
              value={String((selectedNode.config as GateConfig).schemaJson ?? "")}
            />
          </label>
          <div className="inspector-empty">{t("workflow.inspector.gate.schemaHelp")}</div>
        </section>
      )}

      {simpleWorkflowUI && selectedNode.type !== "turn" && (
        <section className="inspector-block form-grid">
          <InspectorSectionTitle
            help={t("workflow.inspector.internal.help")}
            title={t("workflow.inspector.internal.title")}
          />
          <div className="inspector-empty">{t("workflow.inspector.internal.readonly")}</div>
        </section>
      )}
    </>
  );
}
