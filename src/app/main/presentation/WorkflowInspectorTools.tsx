import { useEffect, useMemo, useState } from "react";
import FancySelect from "../../../components/FancySelect";
import { batchActionsForUnityPreset } from "../../../features/unityAutomation/presetCommands";
import { filterUnityAutomationPresetOptions } from "../../../features/unityAutomation/presetOptions";
import type {
  UnityBatchCommandPreview,
  UnityGuardInspection,
  UnityGuardPrepareResult,
} from "../../../features/unityAutomation/types";
import { knowledgeStatusMeta } from "../../../features/workflow/labels";
import { useI18n } from "../../../i18n";
import { invoke } from "../../../shared/tauri";
import type { WorkflowInspectorToolsProps } from "../workflowInspectorTypes";

export default function WorkflowInspectorTools({
  ...props
}: WorkflowInspectorToolsProps) {
  const { t, tp } = useI18n();
  const unityAutomationOptions = filterUnityAutomationPresetOptions(props.presetTemplateOptions);
  const [selectedPresetKind, setSelectedPresetKind] = useState(unityAutomationOptions[0]?.value ?? "");
  const [unityPathDraft, setUnityPathDraft] = useState("");
  const [guardInspection, setGuardInspection] = useState<UnityGuardInspection | null>(null);
  const [guardPrepared, setGuardPrepared] = useState<UnityGuardPrepareResult | null>(null);
  const [batchPreview, setBatchPreview] = useState<UnityBatchCommandPreview | null>(null);
  const [unityLoading, setUnityLoading] = useState<"auto" | "preview" | null>(null);
  const [unityError, setUnityError] = useState("");

  useEffect(() => {
    if (!unityAutomationOptions.some((option) => option.value === selectedPresetKind)) {
      setSelectedPresetKind(unityAutomationOptions[0]?.value ?? "");
    }
  }, [unityAutomationOptions, selectedPresetKind]);

  useEffect(() => {
    setBatchPreview(null);
    setUnityError("");
  }, [selectedPresetKind]);

  useEffect(() => {
    let cancelled = false;

    const prepareGuard = async () => {
      if (!props.isPresetKind(selectedPresetKind)) {
        return;
      }
      setUnityLoading("auto");
      setUnityError("");
      setBatchPreview(null);
      try {
        const inspection = await invoke<UnityGuardInspection>("unity_guard_inspect", {
          projectPath: props.cwd,
        });
        if (cancelled) {
          return;
        }
        setGuardInspection(inspection);
        const prepared = await invoke<UnityGuardPrepareResult>("unity_guard_prepare", {
          projectPath: props.cwd,
        });
        if (cancelled) {
          return;
        }
        setGuardPrepared(prepared);
      } catch (error) {
        if (!cancelled) {
          setGuardPrepared(null);
          setUnityError(String(error ?? "unity guard auto prepare failed"));
        }
      } finally {
        if (!cancelled) {
          setUnityLoading(null);
        }
      }
    };

    void prepareGuard();
    return () => {
      cancelled = true;
    };
  }, [props.cwd, props.isPresetKind, selectedPresetKind]);

  const unityBatchActions = useMemo(
    () => batchActionsForUnityPreset(selectedPresetKind),
    [selectedPresetKind],
  );

  const canPreviewUnityBatch = Boolean(guardPrepared?.sandboxPath && unityPathDraft.trim());

  const handlePreviewBatchCommand = async (action: "build" | "tests_edit" | "tests_play") => {
    if (!guardPrepared?.sandboxPath || !unityPathDraft.trim()) {
      return;
    }
    setUnityLoading("preview");
    setUnityError("");
    try {
      const result = await invoke<UnityBatchCommandPreview>("unity_batch_command_preview", {
        request: {
          projectPath: props.cwd,
          sandboxPath: guardPrepared.sandboxPath,
          unityPath: unityPathDraft.trim(),
          action,
        },
      });
      setBatchPreview(result);
    } catch (error) {
      setUnityError(String(error ?? "unity batch preview failed"));
    } finally {
      setUnityLoading(null);
    }
  };

  return (
    <section className="inspector-block">
      <div className="tool-dropdown-group">
        <h4>{tp("Unity 자동화")}</h4>
        <div className="workflow-template-create-row">
          <FancySelect
            ariaLabel={tp("Unity 자동화")}
            className="modern-select"
            emptyMessage={tp("선택 가능한 템플릿이 없습니다.")}
            onChange={(next) => setSelectedPresetKind(next)}
            options={unityAutomationOptions}
            value={selectedPresetKind}
          />
          <button
            className="mini-action-button workflow-handoff-create-button"
            disabled={!props.isPresetKind(selectedPresetKind)}
            onClick={() => {
              if (props.isPresetKind(selectedPresetKind)) {
                props.applyPreset(selectedPresetKind);
              }
            }}
            type="button"
          >
            <span className="mini-action-button-label">{tp("추가")}</span>
          </button>
        </div>
      </div>

      <div className="tool-dropdown-group">
        <h4>{tp("Unity 자동화 보호")}</h4>
        {unityLoading === "auto" && (
          <div className="workflow-unity-guard-notice">{tp("보호 확인과 샌드박스 준비를 자동으로 진행 중입니다.")}</div>
        )}
        <input
          className="workflow-unity-path-input"
          onChange={(event) => setUnityPathDraft(event.target.value)}
          placeholder={tp("Unity 실행 파일 경로를 입력하세요. 예: /Applications/Unity/Hub/Editor/.../Unity")}
          type="text"
          value={unityPathDraft}
        />
        {guardInspection && (
          <div className="workflow-unity-guard-summary">
            <div className="workflow-unity-guard-row">
              <strong>{tp("추천 모드")}</strong>
              <span>{guardInspection.recommendedMode}</span>
            </div>
            <div className="workflow-unity-guard-row">
              <strong>{tp("브랜치")}</strong>
              <span>{guardInspection.currentBranch || tp("없음")}</span>
            </div>
            <div className="workflow-unity-guard-row">
              <strong>{tp("작업 트리")}</strong>
              <span>
                {guardInspection.dirty == null ? tp("확인 불가") : guardInspection.dirty ? tp("변경 있음") : tp("깨끗함")}
              </span>
            </div>
            <div className="workflow-unity-guard-row">
              <strong>{tp("보호 경로")}</strong>
              <span>{guardInspection.protectedPaths.length}{tp("개")}</span>
            </div>
            {guardInspection.warnings.length > 0 && (
              <div className="workflow-unity-guard-notice">
                {guardInspection.warnings.join(" / ")}
              </div>
            )}
          </div>
        )}
        {guardPrepared && (
          <div className="workflow-unity-guard-summary">
            <div className="workflow-unity-guard-row">
              <strong>{tp("준비 방식")}</strong>
              <span>{guardPrepared.strategy}</span>
            </div>
            <div className="workflow-unity-guard-row">
              <strong>{tp("샌드박스")}</strong>
              <span>{guardPrepared.sandboxPath || tp("읽기 전용")}</span>
            </div>
          </div>
        )}
        <div className="workflow-unity-preview-actions">
          {unityBatchActions.map((action) => (
            <button
              className="mini-action-button"
              disabled={!canPreviewUnityBatch || unityLoading !== null}
              key={action.action}
              onClick={() => handlePreviewBatchCommand(action.action)}
              type="button"
            >
              <span className="mini-action-button-label">{action.label}</span>
            </button>
          ))}
        </div>
        {batchPreview && (
          <div className="workflow-unity-preview-panel">
            <div className="workflow-unity-guard-row">
              <strong>{tp("로그 파일")}</strong>
              <span>{batchPreview.logPath}</span>
            </div>
            {batchPreview.testResultsPath && (
              <div className="workflow-unity-guard-row">
                <strong>{tp("테스트 결과")}</strong>
                <span>{batchPreview.testResultsPath}</span>
              </div>
            )}
            <pre className="workflow-unity-preview-command">{batchPreview.command}</pre>
          </div>
        )}
        {unityError && <div className="workflow-unity-guard-error">{unityError}</div>}
      </div>

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
        </div>
        <div className="workflow-handoff-actions">
          <button
            className="mini-action-button workflow-handoff-create-button"
            onClick={() => props.addRoleNode(props.handoffFromRole, true)}
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
          {tp("역할 노드를 추가하면 앞단에 조사용 RAG 체인을 함께 생성합니다. 연결은 자동으로 구성되지만 이후 편집은 직접 할 수 있습니다.")}
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
