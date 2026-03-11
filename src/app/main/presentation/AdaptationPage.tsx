import { formatAdaptiveFamilyLabel } from "../../adaptation/families";
import type { AdaptiveWorkspaceData } from "../../adaptation/types";

type AdaptationPageProps = {
  data: AdaptiveWorkspaceData;
  loading: boolean;
  onFreeze: () => void;
  onResume: () => void;
  onReset: () => void;
};

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

export default function AdaptationPage(props: AdaptationPageProps) {
  const recentComparisons = props.data.comparisons.slice(0, 6);
  const shadowCandidates = props.data.candidates
    .filter((row) => row.candidateKind !== "current")
    .slice(0, 6);

  return (
    <section className="panel-card settings-view adaptation-view workspace-tab-panel">
      <section className="adaptation-island">
        <div className="adaptation-island-head">
          <div>
            <h2>현재 승격 기본값</h2>
            <p>워크스페이스별 champion만 미래 자동 생성 기본값에 반영됩니다.</p>
          </div>
          <div className="settings-badges">
            <span className={`status-tag ${props.data.profile.learningState === "active" ? "on" : "off"}`}>
              {props.data.profile.learningState === "active" ? "학습 활성화" : "학습 동결"}
            </span>
            <span className="status-tag neutral">family {props.data.champions.length}</span>
          </div>
        </div>
        <div className="adaptation-card-list">
          {props.data.champions.length === 0 ? (
            <div className="adaptation-empty">아직 승격된 기본값이 없습니다.</div>
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
                  <span>weighted {row.weightedTotal.toFixed(2)}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="adaptation-island">
        <div className="adaptation-island-head">
          <div>
            <h2>최근 비교</h2>
            <p>winner, floor 실패, 승격 여부만 구조화해 보여줍니다.</p>
          </div>
        </div>
        <div className="adaptation-card-list">
          {recentComparisons.length === 0 ? (
            <div className="adaptation-empty">아직 비교 이력이 없습니다.</div>
          ) : (
            recentComparisons.map((row) => (
              <article className="adaptation-card" key={row.id}>
                <div className="adaptation-card-head">
                  <strong>{formatAdaptiveFamilyLabel(row.family)}</strong>
                  <small>{formatStamp(row.createdAt)}</small>
                </div>
                <div className="adaptation-card-lines">
                  <span>winner {row.winner}</span>
                  <span>candidate {row.weightedTotal.candidate.toFixed(2)}</span>
                  <span>champion {row.weightedTotal.champion?.toFixed(2) ?? "-"}</span>
                </div>
                <div className="adaptation-card-lines">
                  <span>floor {row.floorFailures.candidate.join(", ") || "pass"}</span>
                  <span>{row.promoted ? "promoted" : "kept"}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="adaptation-island">
        <div className="adaptation-island-head">
          <div>
            <h2>후보 비교</h2>
            <p>실행 후보와 shadow candidate의 graph/prompt/tuning 차이만 요약합니다.</p>
          </div>
        </div>
        <div className="adaptation-card-list">
          {shadowCandidates.length === 0 ? (
            <div className="adaptation-empty">아직 후보 diff가 없습니다.</div>
          ) : (
            shadowCandidates.map((row) => (
              <article className="adaptation-card" key={row.id}>
                <div className="adaptation-card-head">
                  <strong>{formatAdaptiveFamilyLabel(row.family)}</strong>
                  <small>{row.candidateKind === "topology_shadow" ? "topology" : "prompt+tuning"}</small>
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
            <h2>제어</h2>
            <p>내부 루프는 숨기고, 학습 상태와 초기화만 수동 제어합니다.</p>
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
            onClick={props.onReset}
            type="button"
          >
            <span className="settings-button-label">워크스페이스 학습 초기화</span>
          </button>
        </div>
      </section>
    </section>
  );
}
