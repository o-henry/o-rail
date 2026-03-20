import { useI18n } from "../../i18n";

type TasksThreadHeaderBarProps = {
  headerTitle: string;
  displayPath: string;
  isEditingThreadTitle: boolean;
  threadTitleDraft: string;
  hasActiveThread: boolean;
  isThreadNavHidden: boolean;
  isReviewPaneOpen: boolean;
  isMainSurfaceFullscreen: boolean;
  onStartEditingTitle: () => void;
  onChangeTitleDraft: (value: string) => void;
  onCommitTitle: () => void;
  onCancelTitleEdit: () => void;
  onToggleThreadNav: () => void;
  onToggleReviewPane: () => void;
  onToggleMainSurfaceFullscreen: () => void;
};

export function TasksThreadHeaderBar(props: TasksThreadHeaderBarProps) {
  const { t } = useI18n();

  return (
    <header className="tasks-thread-header">
      <div className="tasks-thread-header-leading">
        <button
          aria-label={props.isThreadNavHidden ? t("tasks.detailPanel.show") : t("tasks.detailPanel.hide")}
          className="tasks-thread-header-terminal-button tasks-thread-header-nav-toggle"
          onClick={props.onToggleThreadNav}
          type="button"
        >
          <img alt="" aria-hidden="true" src={props.isThreadNavHidden ? "/open-panel.svg" : "/close.svg"} />
        </button>
        <div className="tasks-thread-header-copy">
          {props.headerTitle ? (
            props.isEditingThreadTitle ? (
              <input
                autoFocus
                className="tasks-thread-title-input"
                onBlur={props.onCommitTitle}
                onChange={(event) => props.onChangeTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    props.onCommitTitle();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    props.onCancelTitleEdit();
                  }
                }}
                value={props.threadTitleDraft}
              />
            ) : (
              <button
                aria-label={t("tasks.aria.renameThread")}
                className="tasks-thread-title-button"
                onClick={props.onStartEditingTitle}
                type="button"
              >
                {props.headerTitle}
              </button>
            )
          ) : null}
          <p>{props.displayPath}</p>
        </div>
      </div>
      <div className="tasks-thread-header-actions">
        <button
          aria-label={props.isReviewPaneOpen ? t("tasks.diff.title") : t("tasks.diff.title")}
          className="tasks-thread-header-terminal-button tasks-thread-header-review-button"
          disabled={!props.hasActiveThread}
          onClick={props.onToggleReviewPane}
          type="button"
        >
          <img alt="" aria-hidden="true" src="/terminal-svgrepo-com.svg" />
        </button>
        <button
          aria-label={props.isMainSurfaceFullscreen ? t("tasks.fullscreen.exit") : t("tasks.fullscreen.enter")}
          className="tasks-thread-header-terminal-button"
          disabled={!props.hasActiveThread}
          onClick={props.onToggleMainSurfaceFullscreen}
          type="button"
        >
          <img alt="" aria-hidden="true" src="/canvas-fullscreen.svg" />
        </button>
      </div>
    </header>
  );
}
