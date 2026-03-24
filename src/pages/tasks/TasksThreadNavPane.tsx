import { useI18n } from "../../i18n";
import {
  getTaskAgentLabel,
  getThreadStageLabel,
  type ThreadStageId,
} from "./taskAgentPresets";
import type { ThreadAgentDetail, ThreadDetail } from "./threadTypes";
import type { ProjectThreadGroup } from "./threadTree";
import type { ThreadFileTreeNode } from "./threadFileTree";

type TasksThreadNavPaneProps = {
  projectGroups: ProjectThreadGroup[];
  projectPath: string;
  cwd: string;
  loading: boolean;
  hasActiveThread: boolean;
  activeThreadId: string;
  activeThread: ThreadDetail | null;
  isReviewPaneOpen: boolean;
  isThreadNavHidden: boolean;
  selectedFilePath: string;
  selectedStage: ThreadDetail["workflow"]["stages"][number] | null;
  currentStageLabel: string;
  pendingApprovalsCount: number;
  selectedAgentDetail: ThreadAgentDetail | null;
  isFilesExpanded: boolean;
  collapsedProjects: Record<string, boolean>;
  collapsedDirectories: Record<string, boolean>;
  fileTree: ThreadFileTreeNode[];
  onNewThread: () => void;
  onOpenProjectDirectory: () => void;
  onSelectProject: (projectPath: string) => void;
  onToggleProject: (projectPath: string) => void;
  onRequestDeleteProject: (projectPath: string) => void;
  onSelectThread: (threadId: string) => void;
  onRequestDeleteThread: (threadId: string) => void;
  onSetSelectedStageId: (stageId: ThreadStageId) => void;
  onToggleReviewPane: () => void;
  onToggleThreadNav: () => void;
  onToggleFilesExpanded: () => void;
  onSelectFilePath: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onCompactSelectedAgentCodexThread: () => void;
};

function displayThreadTitle(input: string | null | undefined, fallback: string) {
  const value = String(input ?? "").trim();
  if (!value) {
    return fallback;
  }
  return value;
}

function displayStageStatus(input: string | null | undefined, t: (key: string) => string) {
  const normalized = String(input ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    idle: t("tasks.stage.idle"),
    active: t("tasks.stage.active"),
    running: t("tasks.stage.running"),
    queued: t("tasks.stage.queued"),
    blocked: t("tasks.stage.blocked"),
    ready: t("tasks.stage.ready"),
    done: t("tasks.stage.done"),
    completed: t("tasks.stage.done"),
    failed: t("tasks.stage.failed"),
    error: t("tasks.stage.failed"),
    low_quality: t("tasks.stage.lowQuality"),
    degraded: t("tasks.stage.lowQuality"),
    thinking: t("tasks.stage.thinking"),
    awaiting_approval: t("tasks.stage.awaitingApproval"),
  };
  return labels[normalized] ?? String(input ?? "").trim().replace(/_/g, " ");
}

function isThreadListFailureStatus(input: string | null | undefined) {
  const normalized = String(input ?? "").trim().toLowerCase();
  return normalized === "failed" || normalized === "error";
}

function isThreadListDegradedStatus(input: string | null | undefined) {
  const normalized = String(input ?? "").trim().toLowerCase();
  return normalized === "low_quality" || normalized === "degraded";
}

function renderFileTree(
  nodes: ThreadFileTreeNode[],
  selectedFilePath: string,
  onSelectFilePath: (path: string) => void,
  collapsedDirectories: Record<string, boolean>,
  onToggleDirectory: (path: string) => void,
  t: (key: string) => string,
  depth = 0,
): React.ReactNode {
  return nodes.map((node) => {
    if (node.kind === "directory") {
      const isCollapsed = Boolean(collapsedDirectories[node.path]);
      return (
        <div className="tasks-thread-file-tree-branch" key={node.id}>
          <button
            aria-label={`${node.name} 폴더 ${isCollapsed ? "펼치기" : "접기"}`}
            className={`tasks-thread-file-tree-node is-directory${node.changed ? " is-changed" : ""}`}
            onClick={() => onToggleDirectory(node.path)}
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            type="button"
          >
            <span className="tasks-thread-file-tree-caret">{isCollapsed ? "▸" : "▾"}</span>
            <span className="tasks-thread-file-tree-name">{node.name}</span>
          </button>
          {!isCollapsed && node.children
            ? renderFileTree(node.children, selectedFilePath, onSelectFilePath, collapsedDirectories, onToggleDirectory, t, depth + 1)
            : null}
        </div>
      );
    }
    return (
      <button
        aria-label={`${node.name} 파일 선택`}
        className={`tasks-thread-file-tree-node is-file${selectedFilePath === node.path ? " is-active" : ""}${node.changed ? " is-changed" : ""}`}
        key={node.id}
        onClick={() => onSelectFilePath(node.path)}
        style={{ paddingLeft: `${28 + depth * 14}px` }}
        type="button"
      >
        <span className="tasks-thread-file-tree-name">{node.name}</span>
        <small>{node.changed ? t("tasks.files.changed") : t("tasks.files.tracked")}</small>
      </button>
    );
  });
}

export function TasksThreadNavPane(props: TasksThreadNavPaneProps) {
  const { t } = useI18n();

  if (props.isThreadNavHidden) {
    return null;
  }

  return (
    <aside aria-label="Tasks 스레드 탐색" className="tasks-thread-nav" role="navigation">
      <section aria-label="프로젝트 및 스레드 탐색" className="tasks-thread-nav-island" role="region">
        <div className="tasks-thread-nav-actions">
          <button aria-label={t("tasks.thread.new")} className="tasks-thread-new-button" onClick={props.onNewThread} type="button">
            {t("tasks.thread.new")}
          </button>
          <button aria-label={t("tasks.project.open")} className="tasks-thread-new-button" onClick={props.onOpenProjectDirectory} type="button">
            {t("tasks.project.open")}
          </button>
          <div aria-label="현재 프로젝트 경로" className="tasks-thread-project-card" role="group">
            <strong>{t("tasks.project.label")}</strong>
            <span title={props.projectPath || ""}>{props.projectPath || "-"}</span>
          </div>
        </div>
        <div aria-label="프로젝트 트리 요약" className="tasks-thread-nav-copy" role="group">
          <strong>{t("tasks.projectTree.label")}</strong>
          <span>{props.loading ? t("tasks.syncing") : t("tasks.count", { count: props.projectGroups.length })}</span>
        </div>
        <div aria-label="프로젝트 트리" className="tasks-thread-project-tree" role="tree">
          {props.projectGroups.map((group) => (
            <section
              aria-label={`${group.label} 프로젝트`}
              className={`tasks-thread-project-node${group.isSelected ? " is-selected" : ""}`}
              key={group.projectPath}
              role="group"
            >
              <div aria-label={`${group.label} 프로젝트 헤더`} className="tasks-thread-project-node-head" role="group">
                <button
                  aria-label={`${group.label} 프로젝트 선택`}
                  className="tasks-thread-project-node-select"
                  onClick={() => props.onSelectProject(group.projectPath)}
                  type="button"
                >
                  <strong>{group.label}</strong>
                  <span>{props.loading && group.isSelected ? t("tasks.syncing") : t("tasks.count", { count: group.threads.length })}</span>
                </button>
                <button
                  aria-label={t(props.collapsedProjects[group.projectPath] ? "tasks.aria.projectExpand" : "tasks.aria.projectCollapse", {
                    label: group.label,
                  })}
                  className="tasks-thread-project-node-toggle"
                  onClick={() => props.onToggleProject(group.projectPath)}
                  type="button"
                >
                  <img
                    alt=""
                    aria-hidden="true"
                    className={props.collapsedProjects[group.projectPath] ? "" : "is-expanded"}
                    src="/down-arrow.svg"
                  />
                </button>
                <button
                  aria-label={t("tasks.aria.projectRemove", { label: group.label })}
                  className="tasks-thread-project-node-remove"
                  onClick={() => props.onRequestDeleteProject(group.projectPath)}
                  type="button"
                >
                  <img alt="" aria-hidden="true" src="/xmark-small-svgrepo-com.svg" />
                </button>
              </div>
              <small className="tasks-thread-project-node-path" title={group.projectPath}>
                {group.projectPath}
              </small>
              {!props.collapsedProjects[group.projectPath] ? (
                <div aria-label={`${group.label} 스레드 목록`} className="tasks-thread-list" role="list">
                  {group.threads.length === 0 ? (
                    <p className="tasks-thread-empty-copy">{t("tasks.empty.projectThreads")}</p>
                  ) : (
                    group.threads.map((item) => (
                      <article
                        aria-label={displayThreadTitle(item.thread.title, t("tasks.thread.new"))}
                        className={`tasks-thread-list-row${props.activeThreadId === item.thread.threadId ? " is-active" : ""}`}
                        key={item.thread.threadId}
                        role="listitem"
                      >
                        <button
                          aria-label={`${displayThreadTitle(item.thread.title, t("tasks.thread.new"))} 선택`}
                          className={`tasks-thread-list-item${props.activeThreadId === item.thread.threadId ? " is-active" : ""}`}
                          onClick={() => props.onSelectThread(item.thread.threadId)}
                          type="button"
                        >
                          <div className="tasks-thread-list-title-row">
                            <strong>{displayThreadTitle(item.thread.title, t("tasks.thread.new"))}</strong>
                          </div>
                          {item.workflowSummary ? (
                            <div className="tasks-thread-list-meta-row">
                              <span className={`tasks-thread-list-stage is-${item.workflowSummary.status}`}>
                                {getThreadStageLabel(item.workflowSummary.currentStageId)}
                              </span>
                              {item.workflowSummary.degraded || isThreadListDegradedStatus(item.thread.status) ? (
                                <span className="tasks-thread-list-state-badge is-quality">{t("tasks.stage.lowQuality")}</span>
                              ) : null}
                              {item.workflowSummary.failed
                              || isThreadListFailureStatus(item.thread.status)
                              || isThreadListFailureStatus(item.workflowSummary.status) ? (
                                <span className="tasks-thread-list-state-badge is-fail">{t("tasks.stage.failed")}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </button>
                        <button
                          aria-label={t("tasks.aria.deleteThread", { title: displayThreadTitle(item.thread.title, t("tasks.thread.new")) })}
                          className="tasks-thread-list-delete"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onRequestDeleteThread(item.thread.threadId);
                          }}
                          type="button"
                        >
                          <img alt="" aria-hidden="true" className="tasks-thread-list-delete-icon" src="/xmark-small-svgrepo-com.svg" />
                        </button>
                      </article>
                    ))
                  )}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </section>

      {props.activeThread ? (
        <>
          <section aria-label="워크플로우 단계" className="tasks-thread-stage-shell tasks-thread-stage-shell-dock" role="region">
            <header className="tasks-thread-stage-shell-head">
              <div className="tasks-thread-stage-shell-head-text">
                <strong>{t("tasks.workflow.title")}</strong>
                <span>{getThreadStageLabel(props.activeThread.workflow.currentStageId)}</span>
              </div>
              <div aria-label="워크플로우 단계 목록" className="tasks-thread-stage-rail is-dock" role="group">
                {props.activeThread.workflow.stages.map((stage) => (
                  <button
                    aria-label={`${getThreadStageLabel(stage.id)} 단계 선택`}
                    className={`tasks-thread-stage-chip is-${stage.status}${props.selectedStage?.id === stage.id ? " is-selected" : ""}`}
                    key={stage.id}
                    onClick={() => props.onSetSelectedStageId(stage.id)}
                    type="button"
                  >
                    <span>{getThreadStageLabel(stage.id)}</span>
                    <small>{displayStageStatus(stage.status, t)}</small>
                  </button>
                ))}
              </div>
            </header>

            <div aria-label="현재 단계 준비 상태" className="tasks-thread-readiness-card" role="group">
              <div className="tasks-thread-section-head">
                <strong>{t("tasks.workflow.readiness")}</strong>
                <span>{props.activeThread.workflow.readinessSummary}</span>
              </div>
              <pre>{props.selectedStage?.summary || props.activeThread.workflow.nextAction}</pre>
              {props.selectedStage?.summary !== props.activeThread.workflow.nextAction ? (
                <pre>{props.activeThread.workflow.nextAction}</pre>
              ) : null}
            </div>

            <section
              aria-label="스레드 파일 패널"
              className={`tasks-thread-files-panel${(props.activeThread.files.length ?? 0) === 0 ? " is-empty" : ""}${props.isFilesExpanded ? " is-expanded" : ""}`}
              role="region"
            >
              <div aria-label="파일 패널 헤더" className="tasks-thread-section-head tasks-thread-section-head-with-tools" role="group">
                <strong>{t("tasks.files.title")}</strong>
                <div className="tasks-thread-section-tools">
                  <span className="tasks-thread-section-count">{props.activeThread.files.length ?? 0}</span>
                  <button
                    aria-label={props.isFilesExpanded ? t("tasks.files.collapse") : t("tasks.files.expand")}
                    className="tasks-thread-section-toggle"
                    onClick={props.onToggleFilesExpanded}
                    type="button"
                  >
                    <img alt="" aria-hidden="true" src={props.isFilesExpanded ? "/up-arrow.svg" : "/down-arrow.svg"} />
                  </button>
                </div>
              </div>
              {props.activeThread.changedFiles.length ? (
                <div className="tasks-thread-changed-files-strip">
                  <div aria-label="변경 파일 헤더" className="tasks-thread-section-head" role="group">
                    <strong>{t("tasks.files.changed")}</strong>
                    <span>{props.activeThread.changedFiles.length}</span>
                  </div>
                  <div className="tasks-thread-changed-file-tags">
                    {props.activeThread.changedFiles.map((path) => (
                      <button aria-label={`${path} 변경 파일 선택`} key={path} onClick={() => props.onSelectFilePath(path)} type="button">
                        {path}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {props.activeThread.files.length > 0 ? (
                <div aria-label="파일 트리" className="tasks-thread-file-tree" role="tree">
                  {renderFileTree(
                    props.fileTree,
                    props.selectedFilePath,
                    props.onSelectFilePath,
                    props.collapsedDirectories,
                    props.onToggleDirectory,
                    t,
                  )}
                </div>
              ) : (
                <div className="tasks-thread-files-empty">{t("tasks.files.empty")}</div>
              )}
            </section>
          </section>

          <section aria-label="선택 단계 상세" className="tasks-thread-workflow-panel" role="region">
            <div aria-label="선택 단계 헤더" className="tasks-thread-section-head" role="group">
              <strong>{props.currentStageLabel}</strong>
              <span>{displayStageStatus(props.selectedStage?.status || "idle", t)}</span>
            </div>
            <div aria-label="선택 단계 메타데이터" className="tasks-thread-workflow-meta" role="group">
              <div>
                <span>{t("tasks.workflow.status")}</span>
                <strong>{displayStageStatus(props.selectedStage?.status || props.activeThread.thread.status || "idle", t)}</strong>
              </div>
              <div>
                <span>{t("tasks.workflow.owner")}</span>
                <strong>{props.selectedStage?.ownerPresetIds.map((roleId) => getTaskAgentLabel(roleId)).join(", ") || "-"}</strong>
              </div>
              <div>
                <span>{t("tasks.workflow.blockers")}</span>
                <strong>{props.selectedStage?.blockerCount ?? 0}</strong>
              </div>
              <div>
                <span>{t("tasks.workflow.worktree")}</span>
                <strong>{props.activeThread.task.worktreePath || props.activeThread.task.workspacePath || t("tasks.workflow.local")}</strong>
              </div>
            </div>
            <section aria-label="선택 단계 요약" className="tasks-thread-detail-text-panel is-inline" role="region">
              <div aria-label="선택 단계 요약 헤더" className="tasks-thread-section-head" role="group">
                <strong>{t("tasks.workflow.summary")}</strong>
                <span>{props.currentStageLabel}</span>
              </div>
              <pre>{props.selectedStage?.summary || props.activeThread.workflow.nextAction || t("tasks.workflow.noSummary")}</pre>
            </section>
            {props.selectedStage?.id === "integrate" ? (
              <div aria-label="통합 단계 승인 목록" className="tasks-thread-workflow-list" role="list">
                {props.activeThread.approvals.length === 0 ? (
                  <p className="tasks-thread-empty-copy">{t("tasks.approval.none")}</p>
                ) : (
                  props.activeThread.approvals.map((approval) => (
                    <article aria-label={`${approval.kind} 승인 상태`} key={approval.id} role="listitem">
                      <strong>{approval.kind.toUpperCase()}</strong>
                      <p>{approval.summary}</p>
                      <span>{approval.status.toUpperCase()}</span>
                    </article>
                  ))
                )}
              </div>
            ) : null}
            {props.selectedStage?.id === "playtest" ? (
              <section aria-label="플레이테스트 검증 상태" className="tasks-thread-detail-text-panel is-inline" role="region">
                <div aria-label="플레이테스트 검증 헤더" className="tasks-thread-section-head" role="group">
                  <strong>{t("tasks.workflow.validation")}</strong>
                  <span>{props.activeThread.validationState || t("tasks.workflow.pending")}</span>
                </div>
                <pre>{props.activeThread.artifacts.validation || t("tasks.workflow.validationPending")}</pre>
              </section>
            ) : null}
            {props.selectedStage?.id === "lock" ? (
              <section aria-label="릴리즈 체크리스트" className="tasks-thread-detail-text-panel is-inline" role="region">
                <div aria-label="릴리즈 체크리스트 헤더" className="tasks-thread-section-head" role="group">
                  <strong>{t("tasks.workflow.releaseChecklist")}</strong>
                  <span>{props.activeThread.workflow.readinessSummary || t("tasks.workflow.preparing")}</span>
                </div>
                <pre>{`${t("tasks.workflow.approvalsPending")}: ${props.pendingApprovalsCount}\n${t("tasks.workflow.validation")}: ${props.activeThread.validationState || t("tasks.workflow.pending")}\n${t("tasks.workflow.handoff")}: ${props.activeThread.artifacts.handoff || t("tasks.workflow.pending")}`}</pre>
              </section>
            ) : null}
          </section>

          <section aria-label="선택 에이전트 상세" className="tasks-thread-agent-detail-panel" role="region">
            {props.selectedAgentDetail ? (
              <>
                <div aria-label="선택 에이전트 헤더" className="tasks-thread-section-head" role="group">
                  <strong>{props.selectedAgentDetail.agent.label}</strong>
                  <span>{displayStageStatus(props.selectedAgentDetail.agent.status, t)}</span>
                </div>
                <div aria-label="선택 에이전트 메타데이터" className="tasks-thread-workflow-meta tasks-thread-agent-detail-grid" role="group">
                  <div>
                    <span>{t("tasks.agent.role")}</span>
                    <strong>{getTaskAgentLabel(props.selectedAgentDetail.agent.roleId)}</strong>
                  </div>
                  <div>
                    <span>{t("tasks.agent.studioRole")}</span>
                    <strong>{props.selectedAgentDetail.studioRoleId || "-"}</strong>
                  </div>
                  <div>
                    <span>{t("tasks.agent.execution")}</span>
                    <strong>{props.selectedAgentDetail.lastRunId || "-"}</strong>
                  </div>
                  <div>
                    <span>{t("tasks.workflow.worktree")}</span>
                    <strong>{props.selectedAgentDetail.worktreePath || props.activeThread.task.workspacePath || "-"}</strong>
                  </div>
                </div>
                <section aria-label="Codex 세션 정보" className="tasks-thread-detail-text-panel is-inline" role="region">
                  <div aria-label="Codex 세션 헤더" className="tasks-thread-section-head" role="group">
                    <strong>{t("tasks.agent.codexSession")}</strong>
                    <div className="tasks-thread-section-actions">
                      <span>{displayStageStatus(props.selectedAgentDetail.codexThreadStatus || "idle", t)}</span>
                      <button
                        aria-label="선택된 에이전트 Codex 스레드 압축"
                        className="tasks-thread-section-action-button"
                        disabled={!props.selectedAgentDetail.codexThreadId}
                        onClick={props.onCompactSelectedAgentCodexThread}
                        type="button"
                      >
                        {t("tasks.action.compact")}
                      </button>
                    </div>
                  </div>
                  <div aria-label="Codex 세션 메타데이터" className="tasks-thread-workflow-meta tasks-thread-agent-detail-grid" role="group">
                    <div>
                      <span>{t("tasks.agent.thread")}</span>
                      <strong>{props.selectedAgentDetail.codexThreadId || "-"}</strong>
                    </div>
                    <div>
                      <span>{t("tasks.agent.turn")}</span>
                      <strong>{props.selectedAgentDetail.codexTurnId || "-"}</strong>
                    </div>
                  </div>
                </section>
                <p className="tasks-thread-agent-summary">{props.selectedAgentDetail.agent.summary || t("tasks.agent.noSummary")}</p>
                <section aria-label="마지막 에이전트 요청" className={`tasks-thread-detail-text-panel is-inline${props.selectedAgentDetail.lastPrompt ? "" : " is-empty"}`} role="region">
                  <div aria-label="마지막 에이전트 요청 헤더" className="tasks-thread-section-head" role="group">
                    <strong>{t("tasks.agent.lastRequest")}</strong>
                    <span>{props.selectedAgentDetail.lastPromptAt || "-"}</span>
                  </div>
                  <pre>{props.selectedAgentDetail.lastPrompt || t("tasks.agent.noRequest")}</pre>
                </section>
              </>
            ) : (
              <p className="tasks-thread-empty-copy">{t("tasks.agent.detailEmpty")}</p>
            )}
          </section>
        </>
      ) : null}
    </aside>
  );
}
