import { useEffect, useMemo, useState } from "react";

import FancySelect from "../../../components/FancySelect";
import { batchActionsForUnityPreset } from "../../../features/unityAutomation/presetCommands";
import { filterUnityAutomationPresetOptions } from "../../../features/unityAutomation/presetOptions";
import type {
  UnityBatchCommandPreview,
  UnityGuardInspection,
  UnityGuardPrepareResult,
} from "../../../features/unityAutomation/types";
import { useI18n } from "../../../i18n";
import { invoke } from "../../../shared/tauri";
import type { WorkflowUnityAutomationProps } from "../workflowInspectorTypes";

export default function WorkflowUnityAutomationIsland(props: WorkflowUnityAutomationProps) {
  const { tp } = useI18n();
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
    <aside className="panel-card workflow-unity-automation-island" aria-label="유니티 자동화">
      <header className="workflow-unity-automation-head">
        <div className="workflow-unity-automation-head-text">
          <strong>{tp("유니티 자동화")}</strong>
          <span>{tp("안전한 진단 · 빌드 · 테스트 보드")}</span>
        </div>
        <button
          aria-label={props.collapsed ? "유니티 자동화 펼치기" : "유니티 자동화 축소"}
          className="workflow-island-collapse-button"
          onClick={props.onToggleCollapsed}
          type="button"
        >
          <img
            alt=""
            className="workflow-island-collapse-icon"
            src={props.collapsed ? "/down-arrow.svg" : "/up-arrow.svg"}
          />
        </button>
      </header>
      {!props.collapsed && (
        <>
          <div className="tool-dropdown-group">
            <h4>{tp("유니티 자동화")}</h4>
            <div className="workflow-template-create-row">
              <FancySelect
                ariaLabel={tp("유니티 자동화")}
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
            <h4>{tp("유니티 자동화 보호")}</h4>
            {unityLoading === "auto" && (
              <div className="workflow-unity-guard-notice">{tp("보호 확인과 샌드박스 준비를 자동으로 진행 중입니다.")}</div>
            )}
            <input
              className="workflow-unity-path-input"
              onChange={(event) => setUnityPathDraft(event.target.value)}
              placeholder={tp("유니티 실행 파일 경로를 입력하세요. 예: /Applications/Unity/Hub/Editor/.../Unity")}
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
            <div
              className={`workflow-unity-preview-actions${
                unityBatchActions.length === 1
                  ? " is-single"
                  : unityBatchActions.length === 2
                    ? " is-double"
                    : ""
              }`}
            >
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
        </>
      )}
    </aside>
  );
}
