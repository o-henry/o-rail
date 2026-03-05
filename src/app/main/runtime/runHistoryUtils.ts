import {
  buildInternalMemorySnippetsFromRun,
  feedAttachmentRawKey,
  graphSignature,
  normalizeRunRecord,
  questionSignature,
  sanitizeRunRecordForSave,
} from "../../mainAppRuntimeHelpers";
import { resolveNodeCwd } from "../../mainAppUtils";
import type { PresetKind, TurnConfig } from "../../../features/workflow/domain";
import type { InternalMemorySnippet, RegressionSummary, RunRecord } from "../types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function persistRunRecordFile(params: {
  invokeFn: InvokeFn;
  name: string;
  runRecord: RunRecord;
}) {
  await params.invokeFn("run_save", {
    name: params.name,
    run: sanitizeRunRecordForSave(params.runRecord),
  });
}

function toSafeMarkdownToken(input: string, fallback: string) {
  const normalized = String(input ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return normalized || fallback;
}

export async function exportRunFeedMarkdownFiles(params: {
  runRecord: RunRecord;
  cwd: string;
  invokeFn: InvokeFn;
  feedRawAttachment: Record<string, string>;
  setError: (message: string) => void;
}) {
  const posts = Array.isArray(params.runRecord.feedPosts) ? params.runRecord.feedPosts : [];
  if (posts.length === 0) {
    return;
  }
  const nodeMap = new Map(params.runRecord.graphSnapshot.nodes.map((node) => [node.id, node]));
  const outgoingCountByNodeId = new Map<string, number>();
  for (const edge of params.runRecord.graphSnapshot.edges ?? []) {
    const sourceNodeId = String(edge?.from?.nodeId ?? "").trim();
    if (!sourceNodeId) {
      continue;
    }
    outgoingCountByNodeId.set(sourceNodeId, (outgoingCountByNodeId.get(sourceNodeId) ?? 0) + 1);
  }
  const finalTurnNodeIds = new Set(
    params.runRecord.graphSnapshot.nodes
      .filter((node) => node.type === "turn" && (outgoingCountByNodeId.get(node.id) ?? 0) === 0)
      .map((node) => node.id),
  );
  const failures: string[] = [];
  const finalDocNameCountByCwd = new Map<string, number>();

  for (let index = 0; index < posts.length; index += 1) {
    const post = posts[index];
    const markdownRaw =
      params.feedRawAttachment[feedAttachmentRawKey(post.id, "markdown")] ??
      post.attachments.find((attachment) => attachment.kind === "markdown")?.content ??
      "";
    const content = String(markdownRaw ?? "").trim();
    if (!content) {
      continue;
    }

    const node = nodeMap.get(post.nodeId);
    const nodeCwd =
      node?.type === "turn"
        ? resolveNodeCwd(String((node.config as TurnConfig)?.cwd ?? params.cwd), params.cwd)
        : params.cwd;
    const targetCwd = nodeCwd || params.cwd;
    const nodeToken = toSafeMarkdownToken(post.nodeId, `node-${index + 1}`);
    const roleToken = toSafeMarkdownToken(post.roleLabel || post.agentName || "agent", "agent");
    const statusToken = toSafeMarkdownToken(post.status, "status");
    const createdAtToken = toSafeMarkdownToken(
      String(post.createdAt || params.runRecord.startedAt || new Date().toISOString()).replace(/[:]/g, "-"),
      `time-${index + 1}`,
    );
    const isFinalDocument =
      Boolean((post as { isFinalDocument?: boolean }).isFinalDocument) || finalTurnNodeIds.has(String(post.nodeId ?? ""));
    let fileName = `rail-${params.runRecord.runId}-${String(index + 1).padStart(2, "0")}-${nodeToken}-${roleToken}-${statusToken}-${createdAtToken}.md`;
    if (isFinalDocument) {
      const nextCount = (finalDocNameCountByCwd.get(targetCwd) ?? 0) + 1;
      finalDocNameCountByCwd.set(targetCwd, nextCount);
      fileName = nextCount === 1 ? "최종 문서.md" : `최종 문서-${nextCount}.md`;
    }

    try {
      const writtenPath = await params.invokeFn<string>("workspace_write_markdown", {
        cwd: targetCwd,
        name: fileName,
        content,
      });
      const markdownAttachment = post.attachments.find((attachment) => attachment.kind === "markdown");
      if (markdownAttachment && !String(markdownAttachment.filePath ?? "").trim()) {
        markdownAttachment.filePath = String(writtenPath ?? "").trim();
      }
    } catch (error) {
      failures.push(`${post.nodeId}: ${String(error)}`);
    }
  }

  if (failures.length > 0) {
    params.setError(`일부 Markdown 저장 실패 (${failures.length}개): ${failures[0]}`);
  }
}

export async function buildRegressionSummary(params: {
  currentRun: RunRecord;
  invokeFn: InvokeFn;
}): Promise<RegressionSummary> {
  if (!params.currentRun.qualitySummary) {
    return { status: "unknown", note: "비교할 품질 요약이 없습니다." };
  }

  try {
    const files = await params.invokeFn<string[]>("run_list");
    const currentFile = `run-${params.currentRun.runId}.json`;
    const targetSignature = graphSignature(params.currentRun.graphSnapshot);
    const targetQuestion = questionSignature(params.currentRun.question);
    const sortedCandidates = files
      .filter((file) => file !== currentFile)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 30);

    for (const file of sortedCandidates) {
      const previous = await params.invokeFn<RunRecord>("run_load", { name: file });
      if (!previous.qualitySummary) {
        continue;
      }
      if (graphSignature(previous.graphSnapshot) !== targetSignature) {
        continue;
      }
      if (questionSignature(previous.question) !== targetQuestion) {
        continue;
      }

      const avgScoreDelta =
        Math.round((params.currentRun.qualitySummary.avgScore - previous.qualitySummary.avgScore) * 100) / 100;
      const passRateDelta =
        Math.round((params.currentRun.qualitySummary.passRate - previous.qualitySummary.passRate) * 100) / 100;

      let status: RegressionSummary["status"] = "stable";
      if (avgScoreDelta >= 3 || passRateDelta >= 8) {
        status = "improved";
      } else if (avgScoreDelta <= -5 || passRateDelta <= -12) {
        status = "degraded";
      }

      return {
        baselineRunId: previous.runId,
        avgScoreDelta,
        passRateDelta,
        status,
        note:
          status === "improved"
            ? "이전 실행 대비 품질이 개선되었습니다."
            : status === "degraded"
              ? "이전 실행 대비 품질이 악화되었습니다."
              : "이전 실행과 유사한 품질입니다.",
      };
    }
    return { status: "unknown", note: "비교 가능한 이전 실행이 없습니다." };
  } catch (error) {
    return { status: "unknown", note: `회귀 비교 실패: ${String(error)}` };
  }
}

export async function loadInternalMemoryCorpus(params: {
  invokeFn: InvokeFn;
  presetKind?: PresetKind;
  onError: (message: string) => void;
}): Promise<InternalMemorySnippet[]> {
  try {
    const files = await params.invokeFn<string[]>("run_list");
    const candidates = files
      .slice()
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 48);
    const snippets: InternalMemorySnippet[] = [];
    for (const file of candidates) {
      let loaded: RunRecord;
      try {
        loaded = normalizeRunRecord(await params.invokeFn<RunRecord>("run_load", { name: file })) as RunRecord;
      } catch {
        continue;
      }
      if (!loaded || !loaded.runId) {
        continue;
      }
      if (params.presetKind && loaded.workflowPresetKind && loaded.workflowPresetKind !== params.presetKind) {
        continue;
      }
      snippets.push(...buildInternalMemorySnippetsFromRun(loaded, { maxPerRun: 12 }));
      if (snippets.length >= 360) {
        break;
      }
    }
    return snippets.slice(0, 360);
  } catch (error) {
    params.onError(`내부 메모리 로드 실패: ${String(error)}`);
    return [];
  }
}
