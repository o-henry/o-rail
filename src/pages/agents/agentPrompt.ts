import { buildCodexMultiAgentDirective } from "../../features/workflow/promptUtils";
import { buildStudioRolePromptEnvelope } from "../../features/studio/rolePromptGuidance";

export type CodexMultiAgentMode = "off" | "balanced" | "max";

type BuildAgentDispatchPayloadParams = {
  threadName?: string;
  threadRoleId?: string;
  threadRole?: string;
  threadGuidance?: string[];
  threadStarterPrompt?: string;
  selectedModel: string;
  selectedReasonLevel: string;
  isReasonLevelSelectable: boolean;
  text: string;
  attachedFileNames: string[];
  selectedDataSourceIds?: string[];
  selectedDataSourceDetails?: string[];
  codexMultiAgentMode: CodexMultiAgentMode;
};

export function isCodexModel(model: string): boolean {
  return String(model ?? "").toLowerCase().includes("codex");
}

export function buildAgentDispatchPayload(params: BuildAgentDispatchPayloadParams): string {
  const trimmedText = String(params.text ?? "").trim();
  const selectedDataSourceIds = (params.selectedDataSourceIds ?? [])
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0);
  const selectedDataSourceDetails = (params.selectedDataSourceDetails ?? [])
    .map((detail) => String(detail ?? "").trim())
    .filter((detail) => detail.length > 0);
  const ragSourcesBlock =
    selectedDataSourceDetails.length > 0
      ? [
          "[RAG SOURCES]",
          `- SOURCE IDS: ${selectedDataSourceIds.join(", ") || "N/A"}`,
          ...selectedDataSourceDetails.map((detail) => `- ${detail}`),
        ].join("\n")
      : "";
  const attachedFileNames = params.attachedFileNames
    .map((name) => String(name ?? "").trim())
    .filter((name) => name.length > 0);
  const fileBlock =
    attachedFileNames.length > 0
      ? [
          "<attached_files>",
          ...attachedFileNames.map((name) => `- ${name}`),
          "</attached_files>",
        ].join("\n")
      : "";
  const reasonTag = params.isReasonLevelSelectable ? params.selectedReasonLevel : "N/A";
  const runtimeBlock = wrapContextBlock("runtime_preferences", [
    `model: ${params.selectedModel}`,
    `reason_level: ${reasonTag}`,
    `thread_name: ${String(params.threadName ?? "").trim() || "N/A"}`,
  ]);
  const multiAgentDirective = isCodexModel(params.selectedModel)
    ? buildCodexMultiAgentDirective(params.codexMultiAgentMode)
    : "";
  const promptBody = buildStudioRolePromptEnvelope({
    roleId: params.threadRoleId,
    roleLabel: params.threadRole,
    request: trimmedText,
    starterPrompt: params.threadStarterPrompt,
    extraGuidance: params.threadGuidance,
    contextBlocks: [runtimeBlock, fileBlock, ragSourcesBlock, multiAgentDirective].filter((block) => block.length > 0),
  });

  if (!params.threadName) {
    return promptBody;
  }
  return `[${params.threadName}] ${promptBody}`;
}

function wrapContextBlock(tag: string, lines: string[]): string {
  const cleaned = lines.map((line) => String(line ?? "").trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return "";
  }
  return [`<${tag}>`, ...cleaned, `</${tag}>`].join("\n");
}
