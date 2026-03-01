import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import FancySelect from "../../components/FancySelect";
import { useI18n } from "../../i18n";

type FeedPageProps = {
  vm: any;
};

class FeedCardBoundary extends Component<
  { children: ReactNode; postId: string; fallbackText: string },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; postId: string; fallbackText: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[feed-card-render-error]", this.props.postId, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <div className="feed-card-render-error">{this.props.fallbackText}</div>;
    }
    return this.props.children;
  }
}

export default function FeedPage({ vm }: FeedPageProps) {
  const { t, tp } = useI18n();
  const [feedSectionExpandedByKey, setFeedSectionExpandedByKey] = useState<Record<string, boolean>>({});
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<{
    runId: string;
    sourceFile: string;
    name: string;
  } | null>(null);
  const {
    feedInspectorTurnNode,
    feedInspectorPost,
    feedInspectorEditable,
    feedInspectorEditableNodeId,
    feedInspectorTurnExecutor,
    feedInspectorTurnConfig,
    feedInspectorQualityProfile,
    feedInspectorQualityThresholdOption,
    feedInspectorPromptTemplate,
    updateNodeConfigById,
    turnModelLabel,
    turnRoleLabel,
    TURN_EXECUTOR_OPTIONS,
    turnExecutorLabel,
    TURN_MODEL_OPTIONS,
    toTurnModelDisplayName,
    DEFAULT_TURN_MODEL,
    getWebProviderFromExecutor,
    normalizeWebResultMode,
    cwd,
    QUALITY_PROFILE_OPTIONS,
    normalizeQualityThreshold,
    QUALITY_THRESHOLD_OPTIONS,
    ARTIFACT_TYPE_OPTIONS,
    toArtifactType,
    feedFilterOpen,
    setFeedFilterOpen,
    setFeedStatusFilter,
    setFeedExecutorFilter,
    setFeedPeriodFilter,
    setFeedKeyword,
    feedStatusFilter,
    feedExecutorFilter,
    feedPeriodFilter,
    feedKeyword,
    feedCategoryMeta,
    feedCategory,
    feedCategoryPosts,
    setFeedCategory,
    feedShareMenuPostId,
    setFeedShareMenuPostId,
    feedLoading,
    currentFeedPosts,
    groupedFeedRuns,
    feedGroupExpandedByRunId,
    setFeedGroupExpandedByRunId,
    feedGroupRenameRunId,
    setFeedGroupRenameRunId,
    setFeedGroupRenameDraft,
    feedGroupRenameDraft,
    onSubmitFeedRunGroupRename,
    toHumanReadableFeedText,
    hashStringToHue,
    buildFeedAvatarLabel,
    pendingNodeRequests,
    feedReplyFeedbackByPost,
    feedExpandedByPost,
    onSelectFeedInspectorPost,
    onShareFeedPost,
    onDeleteFeedRunGroup,
    setFeedExpandedByPost,
    formatFeedInputSourceLabel,
    formatRunDateTime,
    formatRelativeFeedTime,
    formatDuration,
    formatUsage,
    onOpenFeedMarkdownFile,
  } = vm;
  const replyFeedbackMap =
    feedReplyFeedbackByPost && typeof feedReplyFeedbackByPost === "object" ? feedReplyFeedbackByPost : {};
  const isFeedbackErrorMessage = (feedback: string) =>
    /(실패|불가|오류|error|failed|failure|不可|失败|失敗|エラー|失敗)/i.test(feedback);
  const hasFeedEntries =
    (Array.isArray(groupedFeedRuns) && groupedFeedRuns.length > 0) ||
    (Array.isArray(currentFeedPosts) && currentFeedPosts.length > 0);

  const groupedFeedRunsForDisplay = useMemo(() => {
    return Array.isArray(groupedFeedRuns) ? groupedFeedRuns : [];
  }, [groupedFeedRuns]);

  return (
    <section className={`feed-layout workspace-tab-panel${hasFeedEntries ? "" : " no-feed-inspector"}`}>
            {hasFeedEntries && <article className="panel-card feed-agent-panel">
              {/* <div className="feed-agent-panel-head"> */}
                {/* <h3>에이전트 상세설정</h3> */}
                {/* <span>{feedInspectorAgentPosts.length}개</span> */}
              {/* </div> */}
              {/* {feedInspectorAgentPosts.length === 0 && (
                <div className="inspector-empty">{t("feed.empty")}</div>
              )}
              {feedInspectorAgentPosts.length > 0 && (
                <div className="feed-agent-list">
                  {feedInspectorAgentPosts.map((post) => (
                    <button
                      className={feedInspectorPost?.id === post.id ? "is-active" : ""}
                      key={`${post.nodeId}:${post.id}`}
                      onClick={() => onSelectFeedInspectorPost(post)}
                      type="button"
                    >
                      <span className="feed-agent-list-name">{post.agentName}</span>
                      <span className="feed-agent-list-sub">{post.roleLabel}</span>
                    </button>
                  ))}
                </div>
              )} */}
              {feedInspectorTurnNode && (
                <section className="feed-agent-settings">
                  <div className="feed-agent-settings-header">
                    <strong>{feedInspectorPost?.agentName ?? turnModelLabel(feedInspectorTurnNode)}</strong>
                    {!feedInspectorEditable && <span className="feed-agent-readonly-badge">{t("feed.snapshot")}</span>}
                  </div>
                  <div className="feed-agent-settings-grid">
                    <label>
                      {t("feed.agent")}
                      <FancySelect
                        ariaLabel={t("feed.agent")}
                        className="modern-select"
                        disabled={!feedInspectorEditable}
                        onChange={(next) => {
                          if (!feedInspectorEditableNodeId) {
                            return;
                          }
                          updateNodeConfigById(feedInspectorEditableNodeId, "executor", next);
                        }}
                        options={TURN_EXECUTOR_OPTIONS.map((option: any) => ({
                          value: option,
                          label: turnExecutorLabel(option),
                        }))}
                        value={feedInspectorTurnExecutor}
                      />
                    </label>
                    {feedInspectorTurnExecutor === "codex" && (
                      <label>
                        {t("feed.model")}
                        <FancySelect
                          ariaLabel={t("feed.model")}
                          className="modern-select"
                          disabled={!feedInspectorEditable}
                          onChange={(next) => {
                            if (!feedInspectorEditableNodeId) {
                              return;
                            }
                            updateNodeConfigById(feedInspectorEditableNodeId, "model", next);
                          }}
                          options={TURN_MODEL_OPTIONS.map((option: any) => ({ value: option, label: option }))}
                          value={toTurnModelDisplayName(
                            String(feedInspectorTurnConfig?.model ?? DEFAULT_TURN_MODEL),
                          )}
                        />
                      </label>
                    )}
                    {feedInspectorTurnExecutor === "ollama" && (
                      <label>
                        {t("feed.ollamaModel")}
                        <input
                          disabled={!feedInspectorEditable}
                          onChange={(event) => {
                            if (!feedInspectorEditableNodeId) {
                              return;
                            }
                            updateNodeConfigById(
                              feedInspectorEditableNodeId,
                              "ollamaModel",
                              event.currentTarget.value,
                            );
                          }}
                          placeholder={t("feed.ollamaPlaceholder")}
                          value={String(feedInspectorTurnConfig?.ollamaModel ?? "llama3.1:8b")}
                        />
                      </label>
                    )}
                    {getWebProviderFromExecutor(feedInspectorTurnExecutor) && (
                      <>
                        <label>
                          {t("feed.webResultMode")}
                          <FancySelect
                            ariaLabel={t("feed.webResultMode")}
                            className="modern-select"
                            disabled={!feedInspectorEditable}
                            onChange={(next) => {
                              if (!feedInspectorEditableNodeId) {
                                return;
                              }
                              updateNodeConfigById(feedInspectorEditableNodeId, "webResultMode", next);
                            }}
                            options={[
                              { value: "bridgeAssisted", label: t("feed.webMode.bridge") },
                              { value: "manualPasteText", label: t("feed.webMode.text") },
                              { value: "manualPasteJson", label: t("feed.webMode.json") },
                            ]}
                            value={String(
                              normalizeWebResultMode(feedInspectorTurnConfig?.webResultMode),
                            )}
                          />
                        </label>
                        <label>
                          {t("feed.webTimeoutMs")}
                          <input
                            disabled={!feedInspectorEditable}
                            onChange={(event) => {
                              if (!feedInspectorEditableNodeId) {
                                return;
                              }
                              updateNodeConfigById(
                                feedInspectorEditableNodeId,
                                "webTimeoutMs",
                                Number(event.currentTarget.value) || 180_000,
                              );
                            }}
                            type="number"
                            value={String(feedInspectorTurnConfig?.webTimeoutMs ?? 180_000)}
                          />
                        </label>
                      </>
                    )}
                    <label>
                      {t("feed.role")}
                      <input
                        disabled={!feedInspectorEditable}
                        onChange={(event) => {
                          if (!feedInspectorEditableNodeId) {
                            return;
                          }
                          updateNodeConfigById(feedInspectorEditableNodeId, "role", event.currentTarget.value);
                        }}
                        placeholder={turnRoleLabel(feedInspectorTurnNode)}
                        value={String(feedInspectorTurnConfig?.role ?? "")}
                      />
                    </label>
                    <label>
                      {t("feed.cwd")}
                      <input
                        className="lowercase-path-input"
                        disabled={!feedInspectorEditable}
                        onChange={(event) => {
                          if (!feedInspectorEditableNodeId) {
                            return;
                          }
                          updateNodeConfigById(feedInspectorEditableNodeId, "cwd", event.currentTarget.value);
                        }}
                        value={String(feedInspectorTurnConfig?.cwd ?? cwd)}
                      />
                    </label>
                    <label>
                      {t("feed.qualityProfile")}
                      <FancySelect
                        ariaLabel={t("feed.qualityProfile")}
                        className="modern-select"
                        disabled={!feedInspectorEditable}
                        onChange={(next) => {
                          if (!feedInspectorEditableNodeId) {
                            return;
                          }
                          updateNodeConfigById(feedInspectorEditableNodeId, "qualityProfile", next);
                        }}
                        options={QUALITY_PROFILE_OPTIONS}
                        value={feedInspectorQualityProfile}
                      />
                    </label>
                    <label>
                      {t("feed.qualityThreshold")}
                      <FancySelect
                        ariaLabel={t("feed.qualityThreshold")}
                        className="modern-select"
                        disabled={!feedInspectorEditable}
                        onChange={(next) => {
                          if (!feedInspectorEditableNodeId) {
                            return;
                          }
                          updateNodeConfigById(
                            feedInspectorEditableNodeId,
                            "qualityThreshold",
                            normalizeQualityThreshold(next),
                          );
                        }}
                        options={QUALITY_THRESHOLD_OPTIONS}
                        value={feedInspectorQualityThresholdOption}
                      />
                    </label>
                    <label>
                      {t("feed.artifactType")}
                      <FancySelect
                        ariaLabel={t("feed.artifactType")}
                        className="modern-select"
                        disabled={!feedInspectorEditable}
                        onChange={(next) => {
                          if (!feedInspectorEditableNodeId) {
                            return;
                          }
                          updateNodeConfigById(feedInspectorEditableNodeId, "artifactType", next);
                        }}
                        options={ARTIFACT_TYPE_OPTIONS}
                        value={toArtifactType(feedInspectorTurnConfig?.artifactType)}
                      />
                    </label>
                    {feedInspectorQualityProfile === "code_implementation" && (
                      <>
                        <label>
                          {t("feed.qualityCommand.enabled")}
                          <FancySelect
                            ariaLabel={t("feed.qualityCommand.enabled")}
                            className="modern-select"
                            disabled={!feedInspectorEditable}
                            onChange={(next) => {
                              if (!feedInspectorEditableNodeId) {
                                return;
                              }
                              updateNodeConfigById(
                                feedInspectorEditableNodeId,
                                "qualityCommandEnabled",
                                next === "true",
                              );
                            }}
                            options={[
                              { value: "false", label: t("feed.option.disabled") },
                              { value: "true", label: t("feed.option.enabled") },
                            ]}
                            value={String(feedInspectorTurnConfig?.qualityCommandEnabled === true)}
                          />
                        </label>
                        <label>
                          {t("feed.qualityCommand.list")}
                          <pre className="feed-agent-static-field feed-agent-static-field-compact">
                            {String(feedInspectorTurnConfig?.qualityCommands ?? "npm run build")}
                          </pre>
                        </label>
                      </>
                    )}
                    <label>
                      {t("feed.promptTemplate")}
                      <pre className="feed-agent-static-field feed-agent-static-field-prompt">
                        {feedInspectorPromptTemplate}
                      </pre>
                    </label>
                    <label>
                      {t("feed.outputSchema")}
                      <pre className="feed-agent-static-field feed-agent-static-field-compact">
                        {String(feedInspectorTurnConfig?.outputSchemaJson ?? "")}
                      </pre>
                    </label>
                  </div>
                </section>
              )}
            </article>}
            <article className="panel-card feed-main">
              <div className="feed-topbar">
                <div className="feed-topbar-left">
                  <h2>{t("feed.title")}</h2>
                </div>
                <button
                  className={`feed-filter-toggle ${feedFilterOpen ? "is-open" : ""}`}
                  onClick={() => setFeedFilterOpen((prev: any) => !prev)}
                  type="button"
                >
                  <span className="feed-filter-toggle-label">{t("feed.filter")}</span>
                </button>
              </div>
              <div className={`feed-filter-inline-wrap ${feedFilterOpen ? "is-open" : ""}`}>
                <div className="feed-filter-inline">
                  <label>
                    {t("feed.filter.status")}
                    <FancySelect
                      ariaLabel={t("feed.filter.status")}
                      className="modern-select"
                      onChange={(next) => setFeedStatusFilter(next)}
                      options={[
                        { value: "all", label: t("feed.status.all") },
                        { value: "draft", label: t("feed.status.draft") },
                        { value: "done", label: t("feed.status.done") },
                        { value: "failed", label: t("feed.status.failed") },
                        { value: "cancelled", label: t("feed.status.cancelled") },
                      ]}
                      value={feedStatusFilter}
                    />
                  </label>
                  <label>
                    {t("feed.filter.executor")}
                    <FancySelect
                      ariaLabel={t("feed.filter.executor")}
                      className="modern-select"
                      onChange={(next) => setFeedExecutorFilter(next)}
                      options={[
                        { value: "all", label: t("feed.executor.all") },
                        { value: "codex", label: "Codex" },
                        { value: "web", label: "WEB" },
                        { value: "ollama", label: "Ollama" },
                      ]}
                      value={feedExecutorFilter}
                    />
                  </label>
                  <label>
                    {t("feed.filter.period")}
                    <FancySelect
                      ariaLabel={t("feed.filter.period")}
                      className="modern-select"
                      onChange={(next) => setFeedPeriodFilter(next)}
                      options={[
                        { value: "all", label: t("feed.period.all") },
                        { value: "today", label: t("feed.period.today") },
                        { value: "7d", label: t("feed.period.7d") },
                      ]}
                      value={feedPeriodFilter}
                    />
                  </label>
                  <label className="feed-filter-keyword-field">
                    {t("feed.filter.keyword")}
                    <input
                      onChange={(e) => setFeedKeyword(e.currentTarget.value)}
                      placeholder={t("feed.filter.keyword.placeholder")}
                      value={feedKeyword}
                    />
                  </label>
                </div>
              </div>
              <div className="feed-topic-tabs">
                {feedCategoryMeta.map((row: any) => {
                  const count = feedCategoryPosts[row.key].length;
                  return (
                    <button
                      className={`${feedCategory === row.key ? "is-active" : ""} ${
                        row.key === "all_posts" ? "is-all-posts" : ""
                      }`.trim()}
                      key={row.key}
                      onClick={() => setFeedCategory(row.key)}
                      type="button"
                    >
                      <span className="feed-topic-label">{row.label}</span>
                      {count > 0 && <span className="feed-topic-count">{count}</span>}
                    </button>
                  );
                })}
              </div>
              <article
                className="feed-stream"
                onClick={() => {
                  if (feedShareMenuPostId) {
                    setFeedShareMenuPostId(null);
                  }
                }}
              >
                {feedLoading && <div className="log-empty">{t("feed.loading")}</div>}
                {!feedLoading && currentFeedPosts.length === 0 && (
                  <div className="log-empty">{t("feed.empty")}</div>
                )}
                {!feedLoading &&
                  groupedFeedRunsForDisplay.map((group: any) => {
                    const isGroupExpanded = feedGroupExpandedByRunId[group.runId] !== false;
                    const isRenamingGroup = feedGroupRenameRunId === group.runId;
                    const resolvedSourceFile =
                      String(group.sourceFile ?? "").trim() ||
                      String(
                        (Array.isArray(group.posts)
                          ? group.posts.find((post: any) => String(post?.sourceFile ?? "").trim())?.sourceFile
                          : "") ?? "",
                      ).trim();
                    const canManageGroup =
                      !isRenamingGroup &&
                      !group.isLive &&
                      Boolean(group.runId) &&
                      Boolean(resolvedSourceFile);
                    return (
                      <section
                        className={`feed-run-group ${isGroupExpanded ? "is-expanded" : ""}`}
                        key={`feed-run-group-${group.runId}`}
                      >
                        <header className="feed-run-group-head">
                          <div className="feed-run-group-meta">
                            <div className="feed-run-group-title-row">
                              <strong>{tp(group.name)}</strong>
                            </div>
                            <span>
                              {t("feed.countAndDate", {
                                count: group.posts.length,
                                date: formatRunDateTime(group.latestAt),
                              })}
                              {group.isLive ? t("feed.liveTag") : ""}
                            </span>
                          </div>
                          <div className="feed-run-group-actions">
                            {canManageGroup && (
                              <button
                                className="feed-run-group-delete"
                                onClick={() =>
                                  setDeleteGroupTarget({
                                    runId: group.runId,
                                    sourceFile: resolvedSourceFile,
                                    name: String(group.name ?? ""),
                                  })
                                }
                                type="button"
                              >
                                {t("feed.group.delete")}
                              </button>
                            )}
                            {canManageGroup && (
                              <button
                                className="feed-run-group-rename"
                                onClick={() => {
                                  setFeedGroupRenameRunId(group.runId);
                                  setFeedGroupRenameDraft(group.name);
                                }}
                                type="button"
                              >
                                {t("feed.rename")}
                              </button>
                            )}
                            <button
                              className="feed-run-group-toggle"
                              onClick={() =>
                                setFeedGroupExpandedByRunId((prev: any) => ({
                                  ...prev,
                                  [group.runId]: !(prev[group.runId] !== false),
                                }))
                              }
                              type="button"
                            >
                              {isGroupExpanded ? t("feed.collapse") : t("feed.expand")}
                            </button>
                          </div>
                        </header>
                        {isRenamingGroup && (
                          <div className="feed-run-group-rename-row">
                            <input
                              onChange={(event) => setFeedGroupRenameDraft(event.currentTarget.value)}
                              placeholder={t("feed.groupName.placeholder")}
                              value={feedGroupRenameDraft}
                            />
                            <button onClick={() => void onSubmitFeedRunGroupRename(group.runId, resolvedSourceFile)} type="button">
                              {t("common.save")}
                            </button>
                            <button
                              onClick={() => {
                                setFeedGroupRenameRunId(null);
                                setFeedGroupRenameDraft("");
                              }}
                              type="button"
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        )}
                        <div className={`feed-run-group-body ${isGroupExpanded ? "is-expanded" : ""}`}>
                          <div className="feed-run-group-posts">
                            {group.posts.map((post: any) => {
                              const postId = String(post?.id ?? "");
                              const attachments = Array.isArray(post.attachments) ? post.attachments : [];
                              const evidence = post.evidence && typeof post.evidence === "object" ? post.evidence : {};
                              const markdownAttachment = attachments.find((attachment: any) => attachment?.kind === "markdown");
                              const markdownFilePath = String(markdownAttachment?.filePath ?? "").trim();
                              const readableQuestion = toHumanReadableFeedText(post.question ?? "");
                              const readableInputPreview = toHumanReadableFeedText(post.inputContext?.preview ?? "");
                              const avatarHue = hashStringToHue(`${post.nodeId}:${post.agentName}:${post.roleLabel}`);
                              const avatarStyle = {
                                backgroundColor: `hsl(${avatarHue} 78% 92%)`,
                                color: `hsl(${avatarHue} 54% 28%)`,
                                borderColor: `hsl(${avatarHue} 36% 76%)`,
                              };
                              const avatarLabel = buildFeedAvatarLabel(post);
                              const pendingRequestCount = (pendingNodeRequests[post.nodeId] ?? []).length;
                              const requestFeedback = String(replyFeedbackMap[postId] ?? "");
                              const requestFeedbackError = isFeedbackErrorMessage(requestFeedback);
                              const isExpanded = feedExpandedByPost[postId] === true;
                              const isDraftPost = post.status === "draft";
                              const isFailedPost = post.status === "failed" || post.status === "cancelled";
                              const isLowQualityPost =
                                post.status === "low_quality" || String(post?.evidence?.qualityDecision ?? "") === "REJECT";
                              const badgeText = isDraftPost
                                ? "LIVE"
                                : isFailedPost
                                  ? "FAIL"
                                  : isLowQualityPost
                                    ? t("label.status.low_quality")
                                    : "PASS";
                              const badgeClass = isDraftPost
                                ? "live"
                                : isFailedPost
                                  ? "fail"
                                  : isLowQualityPost
                                    ? "low-quality"
                                    : "pass";
                              const canRequest = post.nodeType === "turn";
                              const nodeInputSources = Array.isArray(post.inputSources) ? post.inputSources : [];
                              const upstreamSources = nodeInputSources.filter(
                                (source: any) => source && source.kind === "node",
                              );
                              const inputBundleSectionKey = `${postId}:inputBundle`;
                              const isInputBundleExpanded = feedSectionExpandedByKey[inputBundleSectionKey] !== false;
                              const hasInputBundle = Boolean(readableQuestion || readableInputPreview || upstreamSources.length > 0);
                              const documentSectionTitle = post.isFinalDocument
                                ? t("feed.document.final")
                                : t("feed.document.generated");
                              return (
                                <FeedCardBoundary
                                  fallbackText={t("feed.renderError")}
                                  key={postId || `${post.nodeId}:${post.createdAt}`}
                                  postId={postId}
                                >
                                <section
                                  className={`feed-card feed-card-sns ${
                                    feedInspectorPost?.id === postId ? "is-selected" : ""
                                  }`.trim()}
                                  key={postId}
                                  onClick={() => onSelectFeedInspectorPost(post)}
                                >
                                  <div className="feed-card-head">
                                    <div className="feed-card-avatar" style={avatarStyle}>
                                      <span>{avatarLabel}</span>
                                    </div>
                                    <div className="feed-card-title-wrap">
                                      <h3 className={post.nodeType === "gate" ? "gate-node-title" : undefined}>
                                        {String(post.agentName ?? "")}
                                      </h3>
                                      <div className="feed-card-sub">
                                        {String(post.roleLabel ?? "")}
                                      </div>
                                    </div>
                                    <div className="feed-card-head-actions">
                                      <span
                                        className={`feed-score-badge ${badgeClass}`}
                                        title={
                                          isDraftPost
                                            ? t("feed.agent.working")
                                            : isFailedPost
                                              ? t("label.status.failed")
                                              : isLowQualityPost
                                                ? t("label.status.low_quality")
                                              : t("label.status.done")
                                        }
                                      >
                                        <span aria-hidden="true" className="feed-score-badge-icon" />
                                        <span className="feed-score-badge-text">{badgeText}</span>
                                      </span>
                                      <div
                                        className="feed-share-menu-wrap feed-share-menu-wrap-head"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                        }}
                                      >
                                        <button
                                          aria-label={t("feed.post.share")}
                                          className="feed-share-icon-button"
                                          onClick={() => setFeedShareMenuPostId((prev: any) => (prev === postId ? null : postId))}
                                          type="button"
                                        >
                                          <img alt="" aria-hidden="true" className="feed-share-icon" src="/share-svgrepo-com.svg" />
                                          <span>{t("feed.post.share")}</span>
                                        </button>
                                        {feedShareMenuPostId === postId && (
                                          <div className="feed-share-menu">
                                            <button onClick={() => void onShareFeedPost(post, "clipboard")} type="button">
                                              <span>{t("feed.copyText")}</span>
                                            </button>
                                            <button onClick={() => void onShareFeedPost(post, "json")} type="button">
                                              <span>{t("feed.copyJson")}</span>
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="feed-card-summary">
                                    {post.summary ? tp(post.summary) : t("feed.summary.empty")}
                                  </div>
                                  <button
                                    className="feed-more-button"
                                    aria-expanded={isExpanded}
                                    onClick={() =>
                                      setFeedExpandedByPost((prev: any) => ({
                                        ...prev,
                                        [postId]: !prev[postId],
                                      }))
                                    }
                                    type="button"
                                  >
                                    {isExpanded ? t("feed.less") : t("feed.more")}
                                  </button>
                                  <div className={`feed-card-details ${isExpanded ? "is-expanded" : ""}`} aria-hidden={!isExpanded}>
                                    {hasInputBundle && (
                                      <section className="feed-card-input-sources">
                                        <div className="feed-card-input-sources-head">
                                          <div className="feed-card-input-sources-title">{t("feed.inputBundle")}</div>
                                          <button
                                            aria-expanded={isInputBundleExpanded}
                                            className={`feed-card-input-toggle ${isInputBundleExpanded ? "is-expanded" : ""}`}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setFeedSectionExpandedByKey((prev) => ({
                                                ...prev,
                                                [inputBundleSectionKey]: !(prev[inputBundleSectionKey] !== false),
                                              }));
                                            }}
                                            type="button"
                                          >
                                            <img alt="" aria-hidden="true" src="/down-arrow.svg" />
                                          </button>
                                        </div>
                                        {isInputBundleExpanded && (
                                          <div className="feed-input-bundle-body">
                                            {readableQuestion && <div className="feed-card-question">Q: {readableQuestion}</div>}
                                            {upstreamSources.length > 0 && (
                                              <div className="feed-input-bundle-group">
                                                <div className="feed-input-bundle-label">{t("feed.inputSources")}</div>
                                                <ul>
                                                  {upstreamSources.map((source: any, index: any) => (
                                                    <li key={`${postId}:source:${source.nodeId ?? source.agentName}:${index}`}>
                                                      {formatFeedInputSourceLabel(source)}
                                                    </li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}
                                            {readableInputPreview && (
                                              <div className="feed-input-bundle-group">
                                                <div className="feed-input-bundle-label">
                                                  {t("feed.inputSnapshot")}
                                                  {post.inputContext?.truncated ? t("feed.partial") : ""}
                                                </div>
                                                <pre className="feed-sns-content">{readableInputPreview}</pre>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </section>
                                    )}
                                    <section className="feed-doc-link-block">
                                      <div className="feed-doc-link-head">
                                        <div className="feed-doc-link-title">{documentSectionTitle}</div>
                                        {markdownFilePath && (
                                          <button
                                            aria-label={t("feed.document.openFile")}
                                            className="feed-doc-link-open-icon-button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              onOpenFeedMarkdownFile(post);
                                            }}
                                            type="button"
                                          >
                                            <img alt="" aria-hidden="true" src="/up.svg" />
                                          </button>
                                        )}
                                      </div>
                                      {markdownFilePath ? (
                                        <div className="feed-doc-link-row">
                                          <code className="feed-doc-link-path">{markdownFilePath}</code>
                                        </div>
                                      ) : (
                                        <div className="feed-doc-link-missing">
                                          {t("feed.document.notLinked")}
                                        </div>
                                      )}
                                    </section>
                                    <div className="feed-evidence-row">
                                      <span>{formatRelativeFeedTime(post.createdAt)}</span>
                                      <span>
                                        {t("feed.time.generated")} {formatDuration((evidence as any).durationMs)}
                                      </span>
                                      <span>{t("feed.usage")} {formatUsage((evidence as any).usage)}</span>
                                      {pendingRequestCount > 0 && (
                                        <span>{t("feed.pendingRequests", { count: pendingRequestCount })}</span>
                                      )}
                                    </div>
                                    {canRequest && requestFeedback && (
                                      <div
                                        className={`feed-reply-feedback ${
                                          requestFeedbackError ? "is-error" : "is-ok"
                                        }`.trim()}
                                      >
                                        {requestFeedback}
                                      </div>
                                    )}
                                  </div>
                                </section>
                                </FeedCardBoundary>
                              );
                            })}
                          </div>
                        </div>
                      </section>
                    );
                  })}
              </article>
            </article>
      {deleteGroupTarget && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setDeleteGroupTarget(null);
          }}
        >
          <section
            className="approval-modal feed-delete-confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{t("feed.group.deleteTitle")}</h2>
            <div>{t("feed.group.deleteMessage", { name: tp(deleteGroupTarget.name) })}</div>
            <div className="button-row">
              <button
                onClick={() => {
                  setDeleteGroupTarget(null);
                }}
                type="button"
              >
                {t("common.cancel")}
              </button>
              <button
                className="feed-delete-confirm-danger"
                onClick={() => {
                  void onDeleteFeedRunGroup(
                    deleteGroupTarget.runId,
                    deleteGroupTarget.sourceFile,
                    deleteGroupTarget.name,
                  );
                  setDeleteGroupTarget(null);
                }}
                type="button"
              >
                {t("common.delete")}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
