import { buildCodexMultiAgentDirective } from "../../features/workflow/promptUtils";

export type CodexMultiAgentMode = "off" | "balanced" | "max";

type BuildAgentDispatchPayloadParams = {
  threadName?: string;
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
  const filePrefix = attachedFileNames.length > 0 ? `files: ${attachedFileNames.join(", ")}\n` : "";
  const content = [ragSourcesBlock, `${filePrefix}${trimmedText}`.trim()].filter((line) => line.length > 0).join("\n\n");
  const reasonTag = params.isReasonLevelSelectable ? params.selectedReasonLevel : "N/A";
  const corePrompt = `[model=${params.selectedModel}, reason=${reasonTag}] ${content}`.trim();

  const roleBlock = params.threadRole
    ? [
        "[AGENT ROLE]",
        params.threadRole,
        params.threadGuidance && params.threadGuidance.length > 0
          ? `- ${params.threadGuidance.join("\n- ")}`
          : "",
        params.threadStarterPrompt ? `Starter: ${params.threadStarterPrompt}` : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n")
    : "";
  const multiAgentDirective = isCodexModel(params.selectedModel)
    ? buildCodexMultiAgentDirective(params.codexMultiAgentMode)
    : "";
  const promptBody = [multiAgentDirective, roleBlock, corePrompt].filter((block) => block.length > 0).join("\n\n");

  if (!params.threadName) {
    return promptBody;
  }
  return `[${params.threadName}] ${promptBody}`;
}
