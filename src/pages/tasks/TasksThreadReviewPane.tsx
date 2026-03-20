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
    <aside className="tasks-thread-detail-panel tasks-thread-review-panel">
      <div className="tasks-thread-review-shell">
        <div className="tasks-thread-review-toolbar">
          <div className="tasks-thread-section-head">
            <strong>{t("tasks.diff.title")}</strong>
            <span>{changedFiles.length}</span>
          </div>
          <small>{props.activeThread?.thread.branchLabel || props.activeThread?.task.branchName || t("tasks.workflow.local")}</small>
        </div>

        {changedFiles.length > 0 ? (
          <div className="tasks-thread-review-files">
            {changedFiles.map((path) => (
              <button
                className={props.selectedFilePath === path ? "is-active" : ""}
                key={path}
                onClick={() => props.onSelectFilePath(path)}
                type="button"
              >
                <span>{path}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="tasks-thread-review-empty">{t("tasks.files.empty")}</div>
        )}

        <div className="tasks-thread-review-diff">
          <div className="tasks-thread-review-diff-head">
            <strong>{props.selectedFilePath || t("tasks.diff.title")}</strong>
            <span>{changedFiles.length > 0 ? t("tasks.files.changed") : t("tasks.files.tracked")}</span>
          </div>
          <pre>{props.selectedFileDiff.trim() || t("tasks.files.empty")}</pre>
        </div>
      </div>
    </aside>
  );
}
