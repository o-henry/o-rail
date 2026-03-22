function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncateLine(value: string, maxChars = 180): string {
  const normalized = cleanLine(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function extractTaggedSection(text: string, tagName: string): string {
  const match = text.match(new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, "i"));
  return String(match?.[1] ?? "").trim();
}

function extractHeaderSection(text: string, header: string): string {
  const pattern = new RegExp(`^#\\s+${header}\\s*$`, "im");
  const match = pattern.exec(text);
  if (!match) {
    return "";
  }
  const afterHeader = text.slice(match.index + match[0].length).replace(/^\s+/, "");
  const nextHeader = /\n#\s+[A-Z][A-Z _-]*\s*(?:\n|$)/m.exec(afterHeader);
  return (nextHeader ? afterHeader.slice(0, nextHeader.index) : afterHeader).trim();
}

function stripKnownContextBlocks(text: string): string {
  return text
    .replace(/^Formatting re-enabled\s*$/gim, "")
    .replace(/\[첨부 참고자료][\s\S]*?\[\/첨부 참고자료]\s*/gi, "")
    .replace(/\[ROLE_KB_INJECT][\s\S]*?\[\/ROLE_KB_INJECT]\s*/gi, "")
    .replace(/<role_profile>[\s\S]*?<\/role_profile>\s*/gi, "")
    .replace(/<learning_review>[\s\S]*?<\/learning_review>\s*/gi, "")
    .replace(/<recent_examples>[\s\S]*?<\/recent_examples>\s*/gi, "");
}

function isMetaLine(line: string): boolean {
  return (
    /^#\s+/.test(line)
    || /^\[\/?ROLE_KB_INJECT]/i.test(line)
    || /^\[\/?첨부 참고자료]/.test(line)
    || /^<[/a-z_]+>/i.test(line)
    || /^(작업 유형|당신의 역할|주 책임 역할|참여 역할|사용자 멘션 힌트):/i.test(line)
    || /^-+\s*(ROLE|GOAL|SUMMARY|KEY POINTS|SOURCES):/i.test(line)
  );
}

function extractMeaningfulLines(text: string): string[] {
  return stripKnownContextBlocks(text)
    .split(/\r?\n+/)
    .map((line) => cleanLine(line))
    .filter((line) => line && !isMetaLine(line));
}

function summarizeSection(text: string): string {
  const meaningfulLines = extractMeaningfulLines(text);
  if (meaningfulLines.length > 0) {
    return truncateLine(meaningfulLines.join(" "));
  }
  return truncateLine(cleanLine(stripKnownContextBlocks(text)));
}

export function extractKnowledgeRequestSummary(input: string): string {
  const normalized = String(input ?? "").trim();
  if (!normalized) {
    return "";
  }

  const taggedRequest = extractTaggedSection(normalized, "task_request");
  if (taggedRequest) {
    return summarizeSection(taggedRequest);
  }

  const userRequestSection = extractHeaderSection(normalized, "USER REQUEST");
  if (userRequestSection) {
    const sectionTaskRequest = extractTaggedSection(userRequestSection, "task_request");
    if (sectionTaskRequest) {
      return summarizeSection(sectionTaskRequest);
    }
    const summarizedSection = summarizeSection(userRequestSection);
    if (summarizedSection) {
      return summarizedSection;
    }
  }

  const keyLine = normalized
    .split(/\r?\n+/)
    .map((line) => cleanLine(line))
    .find((line) => /^이번 요청 핵심:/i.test(line));
  if (keyLine) {
    return truncateLine(keyLine.replace(/^이번 요청 핵심:\s*/i, ""));
  }

  const fallbackLines = extractMeaningfulLines(normalized);
  if (fallbackLines.length > 0) {
    return truncateLine(fallbackLines.join(" "));
  }

  return truncateLine(normalized);
}
