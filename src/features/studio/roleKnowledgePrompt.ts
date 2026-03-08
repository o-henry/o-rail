import type { RoleKnowledgeProfile } from "./roleKnowledgeStore";

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function buildStoredRoleKnowledgePrompt(profile: RoleKnowledgeProfile): string {
  const sourceLines = profile.sources
    .filter((source) => source.status === "ok")
    .slice(0, 4)
    .map((source) => {
      const summary = cleanLine(source.summary || source.content || "");
      return `- ${source.url}${summary ? ` :: ${summary}` : ""}`;
    });

  return [
    "[역할 누적 지식]",
    `- 역할: ${cleanLine(profile.roleLabel) || profile.roleId}`,
    `- 목표: ${cleanLine(profile.goal) || "실행 가능한 판단 제공"}`,
    `- 요약: ${cleanLine(profile.summary)}`,
    "- 핵심 포인트:",
    ...profile.keyPoints.slice(0, 6).map((line) => `  - ${cleanLine(line)}`),
    sourceLines.length > 0 ? "- 주요 출처:" : "- 주요 출처: 없음",
    ...sourceLines.map((line) => `  ${line}`),
    "[/역할 누적 지식]",
  ].join("\n");
}
