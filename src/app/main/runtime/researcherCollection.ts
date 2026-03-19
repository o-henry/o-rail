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
      metricFocus?: string[];
      dataScope?: string;
      aggregationUnit?: string;
      instructions?: string[];
    };
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
};

type ResearchCollectionItemResult = {
  items: Array<{
    title: string;
    sourceName: string;
    verificationStatus: string;
    score: number;
    url: string;
    summary: string;
  }>;
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
  const defaultInstructionSplit = normalized.split(/\n\s*\n(?=집중할 점:)/);
  if (defaultInstructionSplit.length > 1) {
    return (defaultInstructionSplit[0]?.trim() || normalized).replace(/^\s*(?:@[a-z0-9_-]+\s+)+/i, "").trim();
  }
  return normalized.replace(/^\s*(?:@[a-z0-9_-]+\s+)+/i, "").trim();
}

function isResearcherPack(pack: TaskAgentPromptPack) {
  return pack.id === "researcher" || pack.studioRoleId === "research_analyst";
}

function buildCollectionContextMarkdown(params: {
  jobId: string;
  label: string;
  resolvedSourceType: string;
  collectorStrategy: string;
  keywords: string[];
  domains: string[];
  planner?: ResearchCollectionJobPlanResult["job"]["planner"];
  metrics: ResearchCollectionMetricsResult;
  items: ResearchCollectionItemResult;
}) {
  const sourceChart = {
    chart: {
      type: "pie",
      title: "",
      labels: params.metrics.bySourceType.slice(0, 6).map((row) => row.sourceType.replace("source.", "")),
      series: [{ name: "Items", data: params.metrics.bySourceType.slice(0, 6).map((row) => row.itemCount), color: "#4A7BFF" }],
    },
  };
  const verificationChart = {
    chart: {
      type: "pie",
      title: "",
      labels: params.metrics.byVerificationStatus.map((row) => row.verificationStatus),
      series: [{ name: "Items", data: params.metrics.byVerificationStatus.map((row) => row.itemCount) }],
    },
  };
  const timelineChart = {
    chart: {
      type: "line",
      title: "",
      labels: params.metrics.timeline.slice(-10).map((row) => row.bucketDate.slice(5)),
      series: [{ name: "Items", data: params.metrics.timeline.slice(-10).map((row) => row.itemCount), color: "#37B679" }],
    },
  };
  const lines = [
    `# 리서치 수집 결과`,
    ``,
    `- 작업 ID: ${params.jobId}`,
    `- 라벨: ${params.label}`,
    `- 소스 유형: ${params.resolvedSourceType}`,
    `- 수집 전략: ${params.collectorStrategy}`,
    `- 분석 모드: ${params.planner?.analysisMode ?? "topic_research"}`,
    `- 핵심 지표: ${params.planner?.metricFocus?.join(", ") || "-"}`,
    `- 키워드: ${params.keywords.join(", ") || "-"}`,
    `- 도메인: ${params.domains.join(", ") || "-"}`,
    `- 합계: 항목 ${params.metrics.totals.items}, 출처 ${params.metrics.totals.sources}, 검증 ${params.metrics.totals.verified}, 경고 ${params.metrics.totals.warnings}`,
    ``,
    `## 주요 출처`,
  ];

  for (const source of params.metrics.topSources.slice(0, 6)) {
    lines.push(`- ${source.sourceName}: ${source.itemCount}`);
  }

  if (sourceChart.chart.labels.length > 0) {
    lines.push("", "```rail-chart", JSON.stringify(sourceChart, null, 2), "```");
  }
  if (verificationChart.chart.labels.length > 0) {
    lines.push("", "```rail-chart", JSON.stringify(verificationChart, null, 2), "```");
  }
  if (timelineChart.chart.labels.length > 0) {
    lines.push("", "```rail-chart", JSON.stringify(timelineChart, null, 2), "```");
  }

  lines.push("", "## 핵심 근거");
  for (const item of params.items.items.slice(0, 6)) {
    lines.push(`- ${item.title} (${item.sourceName}, ${item.verificationStatus}, 점수 ${item.score})`);
    if (item.summary) {
      lines.push(`  ${item.summary}`);
    }
    if (item.url) {
      lines.push(`  ${item.url}`);
    }
  }

  return `${lines.join("\n")}\n`;
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
        `- 집계 단위: ${params.planner.aggregationUnit ?? "evidence"}`,
        `- 데이터 범위: ${params.planner.dataScope ?? "cross_source_topic"}`,
        `- 핵심 지표: ${params.planner.metricFocus?.join(", ") || "-"}`,
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
    const items = await input.invokeFn<ResearchCollectionItemResult>("research_storage_list_collection_items", {
      cwd: input.storageCwd,
      jobId: planned.job.jobId,
      limit: 8,
      offset: 0,
    });

    const markdown = buildCollectionContextMarkdown({
      jobId: planned.job.jobId,
      label: planned.job.label,
      resolvedSourceType: planned.job.resolvedSourceType,
      collectorStrategy: planned.job.collectorStrategy,
      keywords: planned.job.keywords ?? [],
      domains: planned.job.domains ?? [],
      planner: planned.job.planner,
      metrics,
      items,
    });
    const payload = {
      planned,
      metrics,
      items,
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
    };
  } catch (error) {
    return {
      artifactPaths: [],
      promptContext: `# 사전 수집 데이터셋\n- 자동 수집 실패: ${String(error ?? "unknown error")}\n- 가능한 범위에서 추론을 이어가되, 수집 실패 사실을 숨기지 마세요`,
    };
  }
}
