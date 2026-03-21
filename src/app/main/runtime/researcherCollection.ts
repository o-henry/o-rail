import type { FeedChartSpec } from "../../../features/feed/chartSpec";
import { t as translate } from "../../../i18n";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TaskAgentPromptPack = {
  id: string;
  label: string;
  studioRoleId: string;
};

type ResearchCollectionJobPlanResult = {
  job: {
    jobId: string;
    label: string;
    resolvedSourceType: string;
    collectorStrategy: string;
    keywords?: string[];
    domains?: string[];
    planner?: {
      analysisMode?: string;
      questionCategory?: string;
      metricFocus?: string[];
      dataScope?: string;
      aggregationUnit?: string;
      requestedSnapshotDate?: string;
      queryPlan?: Array<{
        query?: string;
        axis?: string;
        language?: string;
        intent?: string;
      }>;
      coverageTargets?: string[];
      transparencyRequirements?: string[];
      instructions?: string[];
    };
    preferredExecutionOrder?: string[];
  };
};

type ResearchCollectionMetricsResult = {
  totals: {
    items: number;
    sources: number;
    verified: number;
    warnings: number;
    conflicted: number;
    avgScore: number;
  };
  bySourceType: Array<{
    sourceType: string;
    itemCount: number;
  }>;
  byVerificationStatus: Array<{
    verificationStatus: string;
    itemCount: number;
  }>;
  timeline: Array<{
    bucketDate: string;
    itemCount: number;
  }>;
  topSources: Array<{
    sourceName: string;
    itemCount: number;
  }>;
  sourceMix?: Record<string, number>;
  coverage?: Array<{
    target?: string;
    met?: boolean;
    detail?: string;
  }>;
  transparency?: {
    sourceMix?: Record<string, number>;
    topSources?: Array<{
      sourceName?: string;
      itemCount?: number;
    }>;
    freshnessWindow?: {
      requested?: string;
      earliestObserved?: string;
      latestObserved?: string;
    };
    conflictsDetected?: number;
    warningsDetected?: number;
    collectionGaps?: string[];
    requirements?: string[];
  };
};

type ResearchCollectionItemResult = {
  items: Array<{
    title: string;
    sourceName: string;
    verificationStatus: string;
    score: number;
    url: string;
    summary: string;
    evidence?: {
      claim?: string;
      quote?: string;
      metric?: Record<string, number>;
      publishedAt?: string;
      fetchedAt?: string;
      sourceType?: string;
      sourceFamily?: string;
      url?: string;
      confidence?: number;
    };
  }>;
};

type ResearchCollectionGenreRankingsResult = {
  popular: Array<{
    genreKey: string;
    genreLabel: string;
    rank: number;
    evidenceCount: number;
    avgScore: number;
    popularityScore: number;
    qualityScore: number;
    representativeTitles: string[];
  }>;
  quality: Array<{
    genreKey: string;
    genreLabel: string;
    rank: number;
    evidenceCount: number;
    avgScore: number;
    popularityScore: number;
    qualityScore: number;
    representativeTitles: string[];
  }>;
};

type ResearchReportListItem = {
  title: string;
  detail: string;
  badge: string;
};

type ResearchReportWidgetSpec = {
  title: string;
  description: string;
  chart?: FeedChartSpec | null;
  items?: ResearchReportListItem[];
};

type ResearchAutoReportSpec = {
  version: number;
  locale: string;
  questionType: "genre_ranking" | "game_comparison" | "community_sentiment" | "topic_research";
  widgets: {
    mainChart: ResearchReportWidgetSpec;
    secondaryChart: ResearchReportWidgetSpec;
    primaryList: ResearchReportWidgetSpec;
    secondaryList: ResearchReportWidgetSpec;
    report: ResearchReportWidgetSpec;
    evidence: ResearchReportWidgetSpec;
  };
};

type PrepareResearcherCollectionContextInput = {
  artifactDir: string;
  invokeFn: InvokeFn;
  pack: TaskAgentPromptPack;
  prompt: string;
  storageCwd: string;
};

type PrepareResearcherCollectionContextResult = {
  artifactPaths: string[];
  promptContext: string;
  fallbackSummary?: string;
};

function extractResearchCollectionPrompt(input: string) {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }
  const taggedRequest = normalized.match(/<task_request>\s*([\s\S]*?)\s*<\/task_request>/i)?.[1]?.trim();
  if (taggedRequest) {
    return taggedRequest;
  }
  const roleKbTrimmed = normalized.split("[ROLE_KB_INJECT]")[0]?.trim();
  if (roleKbTrimmed && roleKbTrimmed !== normalized) {
    return extractResearchCollectionPrompt(roleKbTrimmed);
  }
  const strippedMentions = normalized.replace(/^\s*(?:@[a-z0-9_-]+\s+)+/i, "").trim();
  const strippedInstructions =
    strippedMentions.split(/\s+(?:집중할 점:|focus:|focus points?:)\s*/i, 1)[0]?.trim() || strippedMentions;
  return strippedInstructions;
}

function isResearcherPack(pack: TaskAgentPromptPack) {
  return pack.id === "researcher" || pack.studioRoleId === "research_analyst";
}

function buildCollectionContextMarkdown(params: {
  jobId: string;
  label: string;
  resolvedSourceType: string;
  collectorStrategy: string;
  preferredExecutionOrder?: string[];
  keywords: string[];
  domains: string[];
  planner?: ResearchCollectionJobPlanResult["job"]["planner"];
  metrics: ResearchCollectionMetricsResult;
  items: ResearchCollectionItemResult;
  genreRankings: ResearchCollectionGenreRankingsResult;
  reportSpec: ResearchAutoReportSpec;
}) {
  const lines = [
    `# 리서치 수집 결과`,
    ``,
    `- 작업 ID: ${params.jobId}`,
    `- 라벨: ${params.label}`,
    `- 소스 유형: ${params.resolvedSourceType}`,
    `- 수집 전략: ${params.collectorStrategy}`,
    `- 분석 모드: ${params.planner?.analysisMode ?? "topic_research"}`,
    `- 질문 분류: ${params.planner?.questionCategory ?? "topic_research"}`,
    `- 핵심 지표: ${params.planner?.metricFocus?.join(", ") || "-"}`,
    `- 키워드: ${params.keywords.join(", ") || "-"}`,
    `- 도메인: ${params.domains.join(", ") || "-"}`,
    `- 스냅샷 기준일: ${params.planner?.requestedSnapshotDate || "-"}`,
    `- 실행 순서: ${params.preferredExecutionOrder?.join(" -> ") || "-"}`,
    `- 합계: 항목 ${params.metrics.totals.items}, 출처 ${params.metrics.totals.sources}, 검증 ${params.metrics.totals.verified}, 경고 ${params.metrics.totals.warnings}`,
    ``,
    `## 방법론`,
    `- 질의 계획: ${(params.planner?.queryPlan ?? []).map((row) => row.query).filter(Boolean).slice(0, 6).join(" | ") || "-"}`,
    `- 커버리지 목표: ${params.planner?.coverageTargets?.join(", ") || "-"}`,
    `- 투명성 요구: ${params.planner?.transparencyRequirements?.join(", ") || "-"}`,
    `- 소스 믹스: ${Object.entries(params.metrics.sourceMix ?? {}).map(([key, value]) => `${key} ${value}`).join(", ") || "-"}`,
    `- 최신성 범위: ${params.metrics.transparency?.freshnessWindow?.earliestObserved || "-"} ~ ${params.metrics.transparency?.freshnessWindow?.latestObserved || "-"}`,
    ``,
    `## ${params.reportSpec.widgets.mainChart.title}`,
    params.reportSpec.widgets.mainChart.description,
  ];

  if (params.reportSpec.widgets.mainChart.chart) {
    lines.push("", "```rail-chart", JSON.stringify({ chart: params.reportSpec.widgets.mainChart.chart }, null, 2), "```");
  }
  if (params.reportSpec.widgets.secondaryChart.chart) {
    lines.push("", `## ${params.reportSpec.widgets.secondaryChart.title}`, params.reportSpec.widgets.secondaryChart.description);
    lines.push("", "```rail-chart", JSON.stringify({ chart: params.reportSpec.widgets.secondaryChart.chart }, null, 2), "```");
  }

  lines.push("", `## ${params.reportSpec.widgets.primaryList.title}`);
  for (const item of params.reportSpec.widgets.primaryList.items ?? []) {
    lines.push(`- ${item.title} — ${item.badge}`);
    if (item.detail) {
      lines.push(`  ${item.detail}`);
    }
  }

  lines.push("", `## ${params.reportSpec.widgets.secondaryList.title}`);
  for (const item of params.reportSpec.widgets.secondaryList.items ?? []) {
    lines.push(`- ${item.title} — ${item.badge}`);
    if (item.detail) {
      lines.push(`  ${item.detail}`);
    }
  }

  lines.push("", "## 주요 출처");
  for (const source of params.metrics.topSources.slice(0, 6)) {
    lines.push(`- ${source.sourceName}: ${source.itemCount}`);
  }

  lines.push("", "## 핵심 근거");
  for (const item of params.items.items.slice(0, 6)) {
    lines.push(`- ${item.title} (${item.sourceName}, ${item.verificationStatus}, 점수 ${item.score})`);
    if (item.summary) {
      lines.push(`  ${item.summary}`);
    }
    if (item.evidence?.quote) {
      lines.push(`  인용: ${item.evidence.quote}`);
    }
    if (typeof item.evidence?.confidence === "number") {
      lines.push(`  신뢰도: ${item.evidence.confidence}`);
    }
    if (item.url) {
      lines.push(`  ${item.url}`);
    }
  }

  lines.push("", "## 커버리지 점검");
  for (const row of params.metrics.coverage ?? []) {
    lines.push(`- ${row.target}: ${row.met ? "충족" : "미충족"}${row.detail ? ` · ${row.detail}` : ""}`);
  }

  lines.push("", "## 한계 및 편향 통제");
  lines.push(`- 충돌 근거: ${params.metrics.transparency?.conflictsDetected ?? 0}`);
  lines.push(`- 경고 근거: ${params.metrics.transparency?.warningsDetected ?? 0}`);
  lines.push(`- 수집 누락 영역: ${params.metrics.transparency?.collectionGaps?.join(", ") || "-"}`);

  return `${lines.join("\n")}\n`;
}

function buildSourceMixPieChart(metrics: ResearchCollectionMetricsResult): FeedChartSpec | null {
  if (metrics.bySourceType.length === 0) {
    return null;
  }
  return {
    type: "pie",
    title: "",
    labels: metrics.bySourceType.slice(0, 6).map((row) => row.sourceType.replace("source.", "")),
    series: [{ name: "Items", data: metrics.bySourceType.slice(0, 6).map((row) => row.itemCount), color: "#4A7BFF" }],
  };
}

function buildTimelineLineChart(metrics: ResearchCollectionMetricsResult): FeedChartSpec | null {
  if (metrics.timeline.length === 0) {
    return null;
  }
  return {
    type: "line",
    title: "",
    labels: metrics.timeline.slice(-10).map((row) => row.bucketDate.slice(5)),
    series: [{ name: "Items", data: metrics.timeline.slice(-10).map((row) => row.itemCount), color: "#37B679" }],
  };
}

function buildVerificationBarChart(metrics: ResearchCollectionMetricsResult): FeedChartSpec | null {
  if (metrics.byVerificationStatus.length === 0) {
    return null;
  }
  return {
    type: "bar",
    title: "",
    labels: metrics.byVerificationStatus.map((row) => row.verificationStatus),
    series: [{ name: "Items", data: metrics.byVerificationStatus.map((row) => row.itemCount), color: "#8b5cf6" }],
  };
}

function buildGenreRankingChart(
  rows: Array<{ genreLabel: string; popularityScore: number; qualityScore: number }>,
  kind: "popularity" | "quality",
): FeedChartSpec | null {
  if (rows.length === 0) {
    return null;
  }
  return {
    type: "bar",
    title: "",
    labels: rows.slice(0, 6).map((row) => row.genreLabel),
    series: [
      {
        name: kind === "popularity" ? "Popularity" : "Quality",
        data: rows.slice(0, 6).map((row) => (kind === "popularity" ? row.popularityScore : row.qualityScore)),
        color: kind === "popularity" ? "#4A7BFF" : "#8b5cf6",
      },
    ],
  };
}

function classifyResearchQuestionType(
  prompt: string,
  planner: ResearchCollectionJobPlanResult["job"]["planner"] | undefined,
): ResearchAutoReportSpec["questionType"] {
  if (String(planner?.analysisMode ?? "").trim().toLowerCase() === "genre_ranking") {
    return "genre_ranking";
  }
  const lowered = prompt.toLowerCase();
  if (/(compare|comparison|vs\b|비교)/i.test(lowered)) {
    return "game_comparison";
  }
  if (/(reddit|community|커뮤니티|sentiment|반응|여론)/i.test(lowered)) {
    return "community_sentiment";
  }
  return "topic_research";
}

function buildFallbackListItems(items: ResearchCollectionItemResult): ResearchReportListItem[] {
  return items.items.slice(0, 5).map((item) => ({
    title: item.title || item.sourceName || translate("visualize.empty.items"),
    detail: item.summary || item.url || "",
    badge: `${item.verificationStatus} · ${Math.round(item.score)}`,
  }));
}

function buildAutoReportSpec(params: {
  prompt: string;
  planner?: ResearchCollectionJobPlanResult["job"]["planner"];
  metrics: ResearchCollectionMetricsResult;
  items: ResearchCollectionItemResult;
  genreRankings: ResearchCollectionGenreRankingsResult;
}): ResearchAutoReportSpec {
  const questionType = classifyResearchQuestionType(params.prompt, params.planner);
  const fallbackItems = buildFallbackListItems(params.items);

  if (questionType === "genre_ranking") {
    const popularItems = params.genreRankings.popular.slice(0, 5).map((row) => ({
          title: `${row.rank}. ${row.genreLabel}`,
      detail: row.representativeTitles.slice(0, 3).join(" · ") || translate("visualize.common.representativesPending"),
      badge: `P ${Math.round(row.popularityScore)} · E ${row.evidenceCount}`,
    }));
    const representativeGames = params.genreRankings.quality.slice(0, 5).flatMap((row) =>
      row.representativeTitles.slice(0, 2).map((title, index) => ({
        title,
        detail: `${row.genreLabel} · ${index === 0 ? "대표작" : "후보"}`,
        badge: `Q ${Math.round(row.qualityScore)}`,
      })),
    ).slice(0, 6);

    return {
      version: 1,
      locale: "ko",
      questionType,
      widgets: {
        mainChart: {
          title: translate("visualize.chart.popularGenres"),
          description: translate("visualize.chart.popularGenres.desc"),
          chart: buildGenreRankingChart(params.genreRankings.popular, "popularity"),
        },
        secondaryChart: {
          title: translate("visualize.chart.bestRatedGenres"),
          description: translate("visualize.chart.bestRatedGenres.desc"),
          chart: buildGenreRankingChart(params.genreRankings.quality, "quality"),
        },
        primaryList: {
          title: translate("visualize.list.genreSnapshots"),
          description: translate("visualize.chart.popularGenres.desc"),
          items: popularItems,
        },
        secondaryList: {
          title: translate("visualize.list.representativeGames"),
          description: translate("visualize.common.representativeGame"),
          items: representativeGames.length ? representativeGames : fallbackItems,
        },
        report: {
          title: translate("visualize.report.title"),
          description: translate("visualize.report.title"),
        },
        evidence: {
          title: translate("visualize.evidence.title"),
          description: translate("visualize.evidence.title"),
        },
      },
    };
  }

  if (questionType === "game_comparison") {
    return {
      version: 1,
      locale: "ko",
      questionType,
      widgets: {
        mainChart: {
          title: translate("visualize.chart.comparisonSignals"),
          description: translate("visualize.chart.comparisonSignals.desc"),
          chart: buildVerificationBarChart(params.metrics),
        },
        secondaryChart: {
          title: translate("visualize.chart.sourceMix"),
          description: translate("visualize.chart.sourceMix.desc"),
          chart: buildSourceMixPieChart(params.metrics),
        },
        primaryList: {
          title: translate("visualize.list.comparedTitles"),
          description: translate("visualize.list.comparedTitles"),
          items: fallbackItems,
        },
        secondaryList: {
          title: translate("visualize.list.topSources"),
          description: translate("visualize.common.primarySource"),
          items: params.metrics.topSources.slice(0, 5).map((row) => ({
            title: row.sourceName,
            detail: "비교 근거 공급 출처",
            badge: `${row.itemCount}건`,
          })),
        },
        report: { title: translate("visualize.report.title"), description: translate("visualize.report.title") },
        evidence: { title: translate("visualize.evidence.title"), description: translate("visualize.evidence.title") },
      },
    };
  }

  if (questionType === "community_sentiment") {
    return {
      version: 1,
      locale: "ko",
      questionType,
      widgets: {
        mainChart: {
          title: translate("visualize.chart.reactionTimeline"),
          description: translate("visualize.chart.reactionTimeline.desc"),
          chart: buildTimelineLineChart(params.metrics),
        },
        secondaryChart: {
          title: translate("visualize.chart.sourceMix"),
          description: translate("visualize.chart.sourceMix.desc"),
          chart: buildSourceMixPieChart(params.metrics),
        },
        primaryList: {
          title: translate("visualize.list.reactionHighlights"),
          description: translate("visualize.list.reactionHighlights"),
          items: fallbackItems,
        },
        secondaryList: {
          title: translate("visualize.list.topSources"),
          description: translate("visualize.common.primarySource"),
          items: params.metrics.topSources.slice(0, 5).map((row) => ({
            title: row.sourceName,
            detail: "커뮤니티 신호 출처",
            badge: `${row.itemCount}건`,
          })),
        },
        report: { title: translate("visualize.report.title"), description: translate("visualize.report.title") },
        evidence: { title: translate("visualize.evidence.title"), description: translate("visualize.evidence.title") },
      },
    };
  }

  return {
    version: 1,
    locale: "ko",
    questionType,
    widgets: {
      mainChart: {
        title: translate("visualize.chart.collectionTimeline"),
        description: translate("visualize.chart.collectionTimeline.desc"),
        chart: buildTimelineLineChart(params.metrics),
      },
      secondaryChart: {
        title: translate("visualize.chart.sourceMix"),
        description: translate("visualize.chart.sourceMix.desc"),
        chart: buildSourceMixPieChart(params.metrics),
      },
      primaryList: {
        title: translate("visualize.list.topSources"),
        description: translate("visualize.common.primarySource"),
        items: params.metrics.topSources.slice(0, 5).map((row) => ({
          title: row.sourceName,
          detail: "주요 출처",
          badge: `${row.itemCount}건`,
        })),
      },
      secondaryList: {
        title: translate("visualize.list.representativeTitles"),
        description: translate("visualize.common.representativeGame"),
        items: fallbackItems,
      },
      report: { title: translate("visualize.report.title"), description: translate("visualize.report.title") },
      evidence: { title: translate("visualize.evidence.title"), description: translate("visualize.evidence.title") },
    },
  };
}

function buildPromptContext(params: {
  jobId: string;
  label: string;
  resolvedSourceType: string;
  collectorStrategy: string;
  planner?: ResearchCollectionJobPlanResult["job"]["planner"];
  metrics: ResearchCollectionMetricsResult;
  items: ResearchCollectionItemResult;
}) {
  const evidenceLines = params.items.items.slice(0, 5).map((item, index) =>
    `${index + 1}. ${item.title} | ${item.sourceName} | ${item.verificationStatus} | 점수 ${item.score} | ${item.url}`,
  );
  const plannerLines = params.planner
    ? [
        `- 분석 모드: ${params.planner.analysisMode ?? "topic_research"}`,
        `- 질문 분류: ${params.planner.questionCategory ?? "topic_research"}`,
        `- 집계 단위: ${params.planner.aggregationUnit ?? "evidence"}`,
        `- 데이터 범위: ${params.planner.dataScope ?? "cross_source_topic"}`,
        `- 스냅샷 기준일: ${params.planner.requestedSnapshotDate ?? "-"}`,
        `- 핵심 지표: ${params.planner.metricFocus?.join(", ") || "-"}`,
        `- 질의 계획: ${(params.planner.queryPlan ?? []).map((row) => row.query).filter(Boolean).slice(0, 4).join(" | ") || "-"}`,
        `- 커버리지 목표: ${params.planner.coverageTargets?.join(", ") || "-"}`,
        ...(params.planner.instructions ?? []).map((instruction) => `- 수집 규칙: ${instruction}`),
      ]
    : [];
  return [
    `# 사전 수집 데이터셋`,
    `- researcher 수집 작업 ID: ${params.jobId}`,
    `- 라벨: ${params.label}`,
    `- 소스 유형: ${params.resolvedSourceType}`,
    `- 수집 전략: ${params.collectorStrategy}`,
    ...plannerLines,
    `- 합계: 항목 ${params.metrics.totals.items}, 출처 ${params.metrics.totals.sources}, 검증 ${params.metrics.totals.verified}, 경고 ${params.metrics.totals.warnings}, 충돌 ${params.metrics.totals.conflicted}`,
    `- 소스 믹스: ${Object.entries(params.metrics.sourceMix ?? {}).map(([key, value]) => `${key} ${value}`).join(", ") || "-"}`,
    `- 수집 누락: ${params.metrics.transparency?.collectionGaps?.join(", ") || "-"}`,
    `- 데이터는 이미 로컬 research storage에 저장되어 있어 visualize/database에서 다시 확인할 수 있습니다`,
    `- 해석보다 먼저 수집된 근거를 인용하세요`,
    `- 사용자가 visualize 탭에서 추적할 수 있도록 작업 ID를 한 번 언급하세요`,
    ``,
    `# 핵심 근거`,
    ...evidenceLines,
  ].join("\n");
}

export async function prepareResearcherCollectionContext(
  input: PrepareResearcherCollectionContextInput,
): Promise<PrepareResearcherCollectionContextResult> {
  if (!isResearcherPack(input.pack)) {
    return { artifactPaths: [], promptContext: "" };
  }
  const normalizedPrompt = String(input.prompt ?? "").trim();
  if (!normalizedPrompt) {
    return { artifactPaths: [], promptContext: "" };
  }
  const collectionPrompt = extractResearchCollectionPrompt(normalizedPrompt);
  if (!collectionPrompt) {
    return { artifactPaths: [], promptContext: "" };
  }

  try {
    const planned = await input.invokeFn<ResearchCollectionJobPlanResult>("research_storage_plan_agent_job", {
      cwd: input.storageCwd,
      prompt: collectionPrompt,
      label: `Researcher · ${collectionPrompt.slice(0, 48)}`,
      requestedSourceType: "auto",
      maxItems: 40,
    });
    await input.invokeFn("research_storage_execute_job", {
      cwd: input.storageCwd,
      jobId: planned.job.jobId,
      flowId: 1,
    });
    const metrics = await input.invokeFn<ResearchCollectionMetricsResult>("research_storage_collection_metrics", {
      cwd: input.storageCwd,
      jobId: planned.job.jobId,
    });
    const genreRankings =
      String(planned.job.planner?.analysisMode ?? "").trim().toLowerCase() === "genre_ranking"
        ? await input.invokeFn<ResearchCollectionGenreRankingsResult>("research_storage_collection_genre_rankings", {
            cwd: input.storageCwd,
            jobId: planned.job.jobId,
          })
        : { popular: [], quality: [] };
    const items = await input.invokeFn<ResearchCollectionItemResult>("research_storage_list_collection_items", {
      cwd: input.storageCwd,
      jobId: planned.job.jobId,
      limit: 8,
      offset: 0,
    });
    const reportSpec = buildAutoReportSpec({
      prompt: collectionPrompt,
      planner: planned.job.planner,
      metrics,
      items,
      genreRankings,
    });

    const markdown = buildCollectionContextMarkdown({
      jobId: planned.job.jobId,
      label: planned.job.label,
      resolvedSourceType: planned.job.resolvedSourceType,
      collectorStrategy: planned.job.collectorStrategy,
      preferredExecutionOrder: planned.job.preferredExecutionOrder,
      keywords: planned.job.keywords ?? [],
      domains: planned.job.domains ?? [],
      planner: planned.job.planner,
      metrics,
      items,
      genreRankings,
      reportSpec,
    });
    const payload = {
      planned,
      metrics,
      items,
      genreRankings,
      reportSpec,
    };

    const markdownPath = await input.invokeFn<string>("workspace_write_text", {
      cwd: input.artifactDir,
      name: "research_collection.md",
      content: markdown,
    });
    const jsonPath = await input.invokeFn<string>("workspace_write_text", {
      cwd: input.artifactDir,
      name: "research_collection.json",
      content: `${JSON.stringify(payload, null, 2)}\n`,
    });

    return {
      artifactPaths: [markdownPath, jsonPath],
      promptContext: buildPromptContext({
        jobId: planned.job.jobId,
        label: planned.job.label,
        resolvedSourceType: planned.job.resolvedSourceType,
        collectorStrategy: planned.job.collectorStrategy,
        planner: planned.job.planner,
        metrics,
        items,
      }),
      fallbackSummary: markdown,
    };
  } catch (error) {
    return {
      artifactPaths: [],
      promptContext: `# 사전 수집 데이터셋\n- 자동 수집 실패: ${String(error ?? translate("common.unknownError"))}\n- 가능한 범위에서 추론을 이어가되, 수집 실패 사실을 숨기지 마세요`,
      fallbackSummary: "",
    };
  }
}
