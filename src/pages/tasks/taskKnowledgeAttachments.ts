import { readKnowledgeEntries } from "../../features/studio/knowledgeIndex";
import type { KnowledgeFileRef } from "../../features/workflow/types";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type KnowledgeRetrieveResult = {
  snippets: Array<{
    fileId: string;
    fileName: string;
    chunkIndex: number;
    text: string;
    score: number;
  }>;
  warnings: string[];
};

export function findKnowledgeEntryIdByArtifact(artifactPath: string): string | null {
  const normalizedPath = String(artifactPath ?? "").trim();
  if (!normalizedPath) {
    return null;
  }
  const matched = readKnowledgeEntries().find((entry) =>
    String(entry.markdownPath ?? "").trim() === normalizedPath ||
    String(entry.jsonPath ?? "").trim() === normalizedPath ||
    String(entry.sourceFile ?? "").trim() === normalizedPath,
  );
  return matched?.id ?? null;
}

export async function buildPromptWithKnowledgeAttachments(params: {
  attachedFiles: KnowledgeFileRef[];
  prompt: string;
  cwd: string;
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
}): Promise<string> {
  const normalizedPrompt = String(params.prompt ?? "").trim();
  if (!normalizedPrompt || params.attachedFiles.length === 0 || !params.hasTauriRuntime || !params.cwd) {
    return normalizedPrompt;
  }
  const retrieved = await params.invokeFn<KnowledgeRetrieveResult>("knowledge_retrieve", {
    files: params.attachedFiles,
    query: normalizedPrompt,
    topK: 4,
    maxChars: 3600,
  });
  const fileList = params.attachedFiles.map((file) => `- ${file.path}`).join("\n");
  const snippetBlock = retrieved.snippets
    .map((snippet, index) => `## ${index + 1}. ${snippet.fileName}\n${snippet.text}`)
    .join("\n\n");
  const warningBlock = retrieved.warnings.length > 0
    ? `\n\nWarnings:\n${retrieved.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
  return [
    normalizedPrompt,
    "",
    "Attached project files:",
    fileList,
    snippetBlock ? `\nRelevant snippets:\n\n${snippetBlock}` : "",
    warningBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
