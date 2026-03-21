import { formatAdaptiveFamilyLabel } from "../../adaptation/families";
import type { AdaptiveWorkspaceData } from "../../adaptation/types";
import { formatTaskRoleLearningRoleLabel } from "../../adaptation/taskRoleLearning";

type AdaptationPageProps = {
  data: AdaptiveWorkspaceData;
  loading: boolean;
  taskLearningLoading?: boolean;
  taskRoleSummaries?: Array<{
    roleId: string;
    successCount: number;
    failureCount: number;
    lastFailureReason: string;
    lastFailureKind: string;
  }>;
  taskRoleImprovementSummaries?: Array<{
    roleId: string;
    currentSuccessRate: number;
    previousSuccessRate: number | null;
    successRateDelta: number | null;
    recentSampleSize: number;
    previousSampleSize: number;
  }>;
  onFreeze: () => void;
  onResume: () => void;
  onReset: () => void;
};

export const ADAPTATION_RESET_CONFIRM_MESSAGE =
  "워크스페이스 학습 기록을 초기화할까요?\n현재까지 쌓인 추천 기본값과 비교 기록이 삭제됩니다.";

export function confirmAdaptiveReset(confirmFn: (message: string) => boolean = window.confirm): boolean {
  return confirmFn(ADAPTATION_RESET_CONFIRM_MESSAGE);
}

function formatWinnerLabel(value: string): string {
  if (value === "candidate") {
    return "이번 방식 우세";
  }
  if (value === "champion") {
    return "현재 기본값 유지";
  }
  return "기본값 생성";
}

function formatCandidateKindLabel(value: string): string {
  if (value === "topology_shadow") {
    return "연결 방식 실험";
  }
  return "지시문·실행값 실험";
}

function formatFloorLabel(value: string[]): string {
  if (value.length === 0) {
    return "최소 기준 통과";
  }
  const labels = value.map((item) => {
    if (item === "goalFit") {
      return "요청 적합성";
    }
    if (item === "feasibility") {
      return "실행 가능성";
    }
    if (item === "groundedness") {
      return "근거 충실도";
    }
    return item;
  });
  return `최소 기준 미달: ${labels.join(", ")}`;
}

function formatStamp(value?: string): string {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return new Date(parsed).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSuccessDelta(value: number | null): string {
  if (value === null) {
    return "비교 표본 부족";
  }
  const rounded = Math.round(value * 100);
  if (rounded === 0) {
    return "이전 대비 변화 없음";
  }
  return `이전 대비 ${rounded > 0 ? "+" : ""}${rounded}%p`;
}

export default function AdaptationPage(props: AdaptationPageProps) {
  const recentComparisons = props.data.comparisons.slice(0, 6);
  const shadowCandidates = props.data.candidates
    .filter((row) => row.candidateKind !== "current")
    .slice(0, 6);
  const handleReset = () => {
    if (!confirmAdaptiveReset()) {
      return;
    }
    props.onReset();
  };
  const taskImprovementByRole = new Map(
    (props.taskRoleImprovementSummaries ?? []).map((row) => [row.roleId, row]),
  );

  return (
    <section className="panel-card settings-view adaptation-view workspace-tab-panel">
      <section className="adaptation-island">
        <div className="adaptation-island-head">
          <div>
            <h2>현재 추천 기본값</h2>
            <p>이 워크스페이스에서 잘 맞았던 방식만 다음 자동 생성 기본값에 반영됩니다.</p>
          </div>
          <div className="settings-badges">
            <span className={`status-tag ${props.data.profile.learningState === "active" ? "on" : "off"}`}>
              {props.data.profile.learningState === "active" ? "학습 활성화" : "학습 동결"}
            </span>
            <span className="status-tag neutral">기본값 {props.data.champions.length}</span>
          </div>
        </div>
        <div className="adaptation-card-list">
          {props.data.champions.length === 0 ? (
            <div className="adaptation-empty">아직 추천 기본값이 없습니다.</div>
          ) : (
            props.data.champions.map((row) => (
              <article className="adaptation-card" key={row.family}>
                <div className="adaptation-card-head">
                  <strong>{formatAdaptiveFamilyLabel(row.family)}</strong>
                  <small>{formatStamp(row.updatedAt)}</small>
                </div>
                <p>{row.recipe.graphSummary}</p>
                <div className="adaptation-card-lines">
                  <span>{row.recipe.promptSummary}</span>
                  <span>{row.recipe.tuningSummary}</span>
                  <span>종합 점수 {row.weightedTotal.toFixed(2)}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="adaptation-island">
        <div className="adaptation-island-head">
          <div>
            <h2>Tasks 학습 메모리</h2>
            <p>Tasks 실행의 성공/실패를 구조화해서 다음 비슷한 요청에 자동으로 반영합니다.</p>
          </div>
          <div className="settings-badges">
            <span className="status-tag neutral">
              {props.taskLearningLoading ? "불러오는 중" : `역할 ${props.taskRoleSummaries?.length ?? 0}`}
            </span>
          </div>
        </div>
        <div className="adaptation-card-list">
          {props.taskRoleSummaries && props.taskRoleSummaries.length > 0 ? (
            props.taskRoleSummaries.slice(0, 6).map((row) => {
              const improvement = taskImprovementByRole.get(row.roleId);
              return (
                <article className="adaptation-card" key={row.roleId}>
                <div className="adaptation-card-head">
                  <strong>{formatTaskRoleLearningRoleLabel(row.roleId)}</strong>
                  <small>{row.roleId}</small>
                </div>
                <div className="adaptation-card-lines">
                  <span>성공 {row.successCount}</span>
                  <span>실패 {row.failureCount}</span>
                  <span>{row.failureCount > 0 ? "다음 실행에 실패 회피 힌트 적용" : "최근 실패 없음"}</span>
                </div>
                {improvement ? (
                  <div className="adaptation-card-lines">
                    <span>최근 성공률 {formatPercent(improvement.currentSuccessRate)}</span>
                    <span>{formatSuccessDelta(improvement.successRateDelta)}</span>
                    <span>최근 표본 {improvement.recentSampleSize}</span>
                  </div>
                ) : null}
                {row.lastFailureReason ? <p>{row.lastFailureReason}</p> : null}
                </article>
              );
            })
          ) : (
            <div className="adaptation-empty">아직 Tasks 학습 기록이 없습니다.</div>
          )}
        </div>
      </section>

      <section className="adaptation-island">
        <div className="adaptation-island-head">
          <div>
            <h2>최근 평가 결과</h2>
            <p>최근 실행이 현재 기본값보다 더 나았는지, 최소 기준을 넘었는지만 보여줍니다.</p>
          </div>
        </div>
        <div className="adaptation-card-list">
          {recentComparisons.length === 0 ? (
            <div className="adaptation-empty">아직 평가 이력이 없습니다.</div>
          ) : (
            recentComparisons.map((row) => (
              <article className="adaptation-card" key={row.id}>
                <div className="adaptation-card-head">
                  <strong>{formatAdaptiveFamilyLabel(row.family)}</strong>
                  <small>{formatStamp(row.createdAt)}</small>
                </div>
                <div className="adaptation-card-lines">
                  <span>{formatWinnerLabel(row.winner)}</span>
                  <span>이번 방식 {row.weightedTotal.candidate.toFixed(2)}</span>
                  <span>현재 기본값 {row.weightedTotal.champion?.toFixed(2) ?? "-"}</span>
                </div>
                <div className="adaptation-card-lines">
                  <span>{formatFloorLabel(row.floorFailures.candidate)}</span>
                  <span>{row.promoted ? "기본값 교체" : "현재 상태 유지"}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="adaptation-island">
        <div className="adaptation-island-head">
          <div>
            <h2>시험한 다른 방식</h2>
            <p>앱이 내부적으로 시험한 대안 중 최근 것만 간단히 보여줍니다.</p>
          </div>
        </div>
        <div className="adaptation-card-list">
          {shadowCandidates.length === 0 ? (
            <div className="adaptation-empty">아직 시험한 대안이 없습니다.</div>
          ) : (
            shadowCandidates.map((row) => (
              <article className="adaptation-card" key={row.id}>
                <div className="adaptation-card-head">
                  <strong>{formatAdaptiveFamilyLabel(row.family)}</strong>
                  <small>{formatCandidateKindLabel(row.candidateKind)}</small>
                </div>
                <div className="adaptation-card-lines">
                  <span>{row.graphSummary}</span>
                  <span>{row.promptSummary}</span>
                  <span>{row.tuningSummary}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="adaptation-island">
        <div className="adaptation-island-head">
          <div>
            <h2>관리</h2>
            <p>학습을 잠시 멈추거나 다시 켜고, 지금까지 쌓인 기록을 초기화할 수 있습니다.</p>
          </div>
        </div>
        <div className="button-row adaptation-control-row">
          <button
            className="settings-account-button"
            disabled={props.loading || props.data.profile.learningState === "frozen"}
            onClick={props.onFreeze}
            type="button"
          >
            <span className="settings-button-label">학습 동결</span>
          </button>
          <button
            className="settings-account-button"
            disabled={props.loading || props.data.profile.learningState === "active"}
            onClick={props.onResume}
            type="button"
          >
            <span className="settings-button-label">학습 재개</span>
          </button>
          <button
            className="settings-account-button"
            disabled={props.loading}
            onClick={handleReset}
            type="button"
          >
            <span className="settings-button-label">워크스페이스 학습 초기화</span>
          </button>
        </div>
      </section>
    </section>
  );
}
