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
      type: "bar",
      title: "Source Mix",
      labels: params.metrics.bySourceType.slice(0, 6).map((row) => row.sourceType.replace("source.", "")),
      series: [{ name: "Items", data: params.metrics.bySourceType.slice(0, 6).map((row) => row.itemCount), color: "#4A7BFF" }],
    },
  };
  const verificationChart = {
    chart: {
      type: "pie",
      title: "Verification",
      labels: params.metrics.byVerificationStatus.map((row) => row.verificationStatus),
      series: [{ name: "Items", data: params.metrics.byVerificationStatus.map((row) => row.itemCount) }],
    },
  };
  const timelineChart = {
    chart: {
      type: "line",
      title: "Timeline",
      labels: params.metrics.timeline.slice(-10).map((row) => row.bucketDate.slice(5)),
      series: [{ name: "Items", data: params.metrics.timeline.slice(-10).map((row) => row.itemCount), color: "#37B679" }],
    },
  };
  const lines = [
    `# Research Collection`,
    ``,
    `- Job ID: ${params.jobId}`,
    `- Label: ${params.label}`,
    `- Source Type: ${params.resolvedSourceType}`,
    `- Strategy: ${params.collectorStrategy}`,
    `- Analysis Mode: ${params.planner?.analysisMode ?? "topic_research"}`,
    `- Metric Focus: ${params.planner?.metricFocus?.join(", ") || "-"}`,
    `- Keywords: ${params.keywords.join(", ") || "-"}`,
    `- Domains: ${params.domains.join(", ") || "-"}`,
    `- Totals: items ${params.metrics.totals.items}, sources ${params.metrics.totals.sources}, verified ${params.metrics.totals.verified}, warnings ${params.metrics.totals.warnings}`,
    ``,
    `## Top Sources`,
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

  lines.push("", "## Top Evidence");
  for (const item of params.items.items.slice(0, 6)) {
    lines.push(`- ${item.title} (${item.sourceName}, ${item.verificationStatus}, score ${item.score})`);
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
    `${index + 1}. ${item.title} | ${item.sourceName} | ${item.verificationStatus} | score ${item.score} | ${item.url}`,
  );
  const plannerLines = params.planner
    ? [
        `- analysis mode: ${params.planner.analysisMode ?? "topic_research"}`,
        `- aggregation unit: ${params.planner.aggregationUnit ?? "evidence"}`,
        `- data scope: ${params.planner.dataScope ?? "cross_source_topic"}`,
        `- metric focus: ${params.planner.metricFocus?.join(", ") || "-"}`,
        ...(params.planner.instructions ?? []).map((instruction) => `- collection rule: ${instruction}`),
      ]
    : [];
  return [
    `# PRECOLLECTED DATASET`,
    `- researcher collection job id: ${params.jobId}`,
    `- label: ${params.label}`,
    `- source type: ${params.resolvedSourceType}`,
    `- collection strategy: ${params.collectorStrategy}`,
    ...plannerLines,
    `- totals: items ${params.metrics.totals.items}, sources ${params.metrics.totals.sources}, verified ${params.metrics.totals.verified}, warnings ${params.metrics.totals.warnings}, conflicted ${params.metrics.totals.conflicted}`,
    `- data is already stored in local research storage for visualize/database review`,
    `- cite the collected evidence first, then add interpretation`,
    `- mention the job id once in the answer so the user can trace it in the visualize tab`,
    ``,
    `# TOP EVIDENCE`,
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

  try {
    const planned = await input.invokeFn<ResearchCollectionJobPlanResult>("research_storage_plan_agent_job", {
      cwd: input.storageCwd,
      prompt: normalizedPrompt,
      label: `Researcher · ${normalizedPrompt.slice(0, 48)}`,
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
      promptContext: `# PRECOLLECTED DATASET\n- automatic collection failed: ${String(error ?? "unknown error")}\n- continue with best-effort reasoning and say collection failed if needed`,
    };
  }
}
