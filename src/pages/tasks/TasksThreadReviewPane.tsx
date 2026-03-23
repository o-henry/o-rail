import { useI18n } from "../../i18n";
import type { ThreadDetail } from "./threadTypes";

type TasksThreadReviewPaneProps = {
  activeThread: ThreadDetail | null;
  selectedFilePath: string;
  selectedFileDiff: string;
  onSelectFilePath: (path: string) => void;
};

export function TasksThreadReviewPane(props: TasksThreadReviewPaneProps) {
  const { t } = useI18n();
  const changedFiles = props.activeThread?.changedFiles ?? [];

  return (
    <aside aria-label="변경 파일 리뷰 패널" className="tasks-thread-detail-panel tasks-thread-review-panel" role="complementary">
      <div aria-label="리뷰 패널 내용" className="tasks-thread-review-shell" role="region">
        <div aria-label="리뷰 패널 도구막대" className="tasks-thread-review-toolbar" role="group">
          <div className="tasks-thread-section-head">
            <strong>{t("tasks.diff.title")}</strong>
            <span>{changedFiles.length}</span>
          </div>
          <small>{props.activeThread?.thread.branchLabel || props.activeThread?.task.branchName || t("tasks.workflow.local")}</small>
        </div>

        {changedFiles.length > 0 ? (
          <div aria-label="변경 파일 목록" className="tasks-thread-review-files" role="list">
            {changedFiles.map((path) => (
              <button
                aria-label={`${path} diff 보기`}
                className={props.selectedFilePath === path ? "is-active" : ""}
                key={path}
                onClick={() => props.onSelectFilePath(path)}
                role="listitem"
                type="button"
              >
                <span>{path}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="tasks-thread-review-empty">{t("tasks.files.empty")}</div>
        )}

        <div aria-label="선택 파일 diff" className="tasks-thread-review-diff" role="region">
          <div aria-label="diff 헤더" className="tasks-thread-review-diff-head" role="group">
            <strong>{props.selectedFilePath || t("tasks.diff.title")}</strong>
            <span>{changedFiles.length > 0 ? t("tasks.files.changed") : t("tasks.files.tracked")}</span>
          </div>
          <pre className={props.selectedFileDiff.trim() ? "" : "is-empty"}>
            {props.selectedFileDiff.trim() || t("tasks.files.empty")}
          </pre>
        </div>
      </div>
    </aside>
  );
}
