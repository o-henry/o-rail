function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueLines(rows: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const row of rows) {
    const cleaned = cleanLine(row);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    output.push(cleaned);
  }
  return output;
}

function extractCandidateLines(summary: string): string[] {
  const normalized = String(summary ?? "").trim();
  if (!normalized) {
    return [];
  }
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^(claims|ideas|risks|disagreements|novelty signals)\s*:?\s*$/i.test(line));
  if (lines.length > 0) {
    return uniqueLines(lines);
  }
  return uniqueLines(
    normalized
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean),
  );
}

function bucketForLine(line: string): "ideas" | "risks" | "disagreements" | "noveltySignals" | "claims" {
  const lower = line.toLowerCase();
  if (
    /반면|하지만|그러나|충돌|의견이 갈|이견|controvers|disagree|counterpoint|반대/.test(lower)
  ) {
    return "disagreements";
  }
  if (
    /아이디어|후보|컨셉|hook|훅|루프|core loop|game loop|메커닉|mechanic|concept|idea|candidate/.test(lower)
  ) {
    return "ideas";
  }
  if (
    /리스크|위험|한계|문제|주의|함정|실패|cost|trade-?off|risk|constraint|limitation|pitfall/.test(lower)
  ) {
    return "risks";
  }
  if (
    /차별|독창|새롭|신선|상투|아류|novel|novelty|distinct|differentiat|cliche|derivative|original/.test(lower)
  ) {
    return "noveltySignals";
  }
  return "claims";
}

function renderSection(title: string, rows: string[]): string {
  if (rows.length === 0) {
    return "";
  }
  return [`## ${title}`, ...rows.map((row) => `- ${row}`)].join("\n");
}

export function buildStructuredExternalWebPerspective(summary: string): string {
  const lines = extractCandidateLines(summary);
  if (lines.length === 0) {
    return "# 외부 웹 AI 관점\n\n## claims\n- usable external web perspective was not produced.";
  }

  const buckets = {
    claims: [] as string[],
    ideas: [] as string[],
    risks: [] as string[],
    disagreements: [] as string[],
    noveltySignals: [] as string[],
  };

  for (const line of lines) {
    buckets[bucketForLine(line)].push(line);
  }

  if (buckets.claims.length === 0 && buckets.ideas.length === 0) {
    buckets.claims.push(...lines.slice(0, 3));
  }

  return [
    "# 외부 웹 AI 관점",
    "이 문서는 web AI의 응답을 내부 역할 에이전트가 참고자료로 읽기 쉽게 재구성한 것이다.",
    renderSection("claims", buckets.claims),
    renderSection("ideas", buckets.ideas),
    renderSection("risks", buckets.risks),
    renderSection("disagreements", buckets.disagreements),
    renderSection("novelty_signals", buckets.noveltySignals),
  ].filter(Boolean).join("\n\n");
}
