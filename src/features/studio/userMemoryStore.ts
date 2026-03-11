const USER_MEMORY_STORAGE_KEY = "rail.user.memory.v1";
const USER_MEMORY_AUTO_CAPTURE_STORAGE_KEY = "rail.user.memory.auto_capture.v1";
const USER_MEMORY_MAX_ITEMS = 24;
const USER_MEMORY_MAX_TEXT_LENGTH = 220;

export type UserMemorySource = "manual" | "auto";

export type UserMemoryEntry = {
  id: string;
  text: string;
  source: UserMemorySource;
  createdAt: string;
  updatedAt: string;
};

function getStorage(): Storage | null {
  const candidate = typeof globalThis !== "undefined"
    ? (globalThis as { localStorage?: Storage }).localStorage
    : undefined;
  return candidate ?? null;
}

function normalizeMemoryText(input: unknown): string {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, USER_MEMORY_MAX_TEXT_LENGTH);
}

function normalizeMemorySource(input: unknown): UserMemorySource {
  return String(input ?? "").trim().toLowerCase() === "auto" ? "auto" : "manual";
}

function normalizeMemoryEntry(raw: unknown): UserMemoryEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const text = normalizeMemoryText(row.text);
  if (!text) {
    return null;
  }
  const id = String(row.id ?? "").trim() || `memory-${Date.now().toString(36)}`;
  const createdAt = String(row.createdAt ?? "").trim() || new Date().toISOString();
  const updatedAt = String(row.updatedAt ?? "").trim() || createdAt;
  return {
    id,
    text,
    source: normalizeMemorySource(row.source),
    createdAt,
    updatedAt,
  };
}

function dedupeMemoryEntries(entries: UserMemoryEntry[]): UserMemoryEntry[] {
  const latestByText = new Map<string, UserMemoryEntry>();
  for (const entry of entries) {
    const key = normalizeMemoryText(entry.text).toLowerCase();
    if (!key) {
      continue;
    }
    const existing = latestByText.get(key);
    if (!existing || existing.updatedAt < entry.updatedAt) {
      latestByText.set(key, entry);
    }
  }
  return [...latestByText.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, USER_MEMORY_MAX_ITEMS);
}

export function readUserMemoryEntries(): UserMemoryEntry[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  const raw = storage.getItem(USER_MEMORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return dedupeMemoryEntries(
      parsed
        .map((entry) => normalizeMemoryEntry(entry))
        .filter((entry): entry is UserMemoryEntry => entry !== null),
    );
  } catch {
    return [];
  }
}

export function writeUserMemoryEntries(entries: UserMemoryEntry[]): UserMemoryEntry[] {
  const normalized = dedupeMemoryEntries(entries);
  const storage = getStorage();
  if (storage) {
    storage.setItem(USER_MEMORY_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function addUserMemoryEntry(text: string, source: UserMemorySource = "manual"): UserMemoryEntry[] {
  const normalizedText = normalizeMemoryText(text);
  if (!normalizedText) {
    return readUserMemoryEntries();
  }
  const now = new Date().toISOString();
  const current = readUserMemoryEntries();
  const existing = current.find((entry) => normalizeMemoryText(entry.text).toLowerCase() === normalizedText.toLowerCase());
  const next = existing
    ? current.map((entry) => (
        entry.id === existing.id
          ? {
              ...entry,
              text: normalizedText,
              source,
              updatedAt: now,
            }
          : entry
      ))
    : [
        {
          id: `memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          text: normalizedText,
          source,
          createdAt: now,
          updatedAt: now,
        },
        ...current,
      ];
  return writeUserMemoryEntries(next);
}

export function removeUserMemoryEntry(entryId: string): UserMemoryEntry[] {
  const normalizedId = String(entryId ?? "").trim();
  return writeUserMemoryEntries(readUserMemoryEntries().filter((entry) => entry.id !== normalizedId));
}

export function clearUserMemoryEntries(): UserMemoryEntry[] {
  const storage = getStorage();
  if (storage) {
    storage.removeItem(USER_MEMORY_STORAGE_KEY);
  }
  return [];
}

export function loadUserMemoryAutoCaptureEnabled(): boolean {
  const storage = getStorage();
  if (!storage) {
    return true;
  }
  return storage.getItem(USER_MEMORY_AUTO_CAPTURE_STORAGE_KEY) !== "0";
}

export function writeUserMemoryAutoCaptureEnabled(next: boolean): boolean {
  const storage = getStorage();
  if (storage) {
    storage.setItem(USER_MEMORY_AUTO_CAPTURE_STORAGE_KEY, next ? "1" : "0");
  }
  return next;
}

function splitCandidateLines(input: string): string[] {
  return input
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((line) => normalizeMemoryText(line))
    .filter(Boolean);
}

function looksLikeStableUserMemory(line: string): boolean {
  if (line.length < 12 || line.length > USER_MEMORY_MAX_TEXT_LENGTH) {
    return false;
  }
  const lower = line.toLowerCase();
  const explicitMarkers = [
    "나는 ",
    "저는 ",
    "내 프로젝트",
    "내 서비스",
    "내 게임",
    "나는 1인",
    "저는 1인",
    "선호",
    "원해",
    "원하지 않",
    "싫어",
    "중요하게 생각",
    "우선순위",
    "피하고 싶",
    "i am ",
    "i'm ",
    "my project",
    "my game",
    "i prefer",
    "i want",
    "i don't want",
    "i value",
    "important to me",
    "my priority",
  ];
  return explicitMarkers.some((marker) => lower.includes(marker));
}

export function extractUserMemoryCandidates(text: string): string[] {
  const candidates = splitCandidateLines(text).filter((line) => looksLikeStableUserMemory(line));
  return [...new Set(candidates)].slice(0, 6);
}

export function rememberUserMemoryFromText(text: string): UserMemoryEntry[] {
  if (!loadUserMemoryAutoCaptureEnabled()) {
    return readUserMemoryEntries();
  }
  const candidates = extractUserMemoryCandidates(text);
  if (candidates.length === 0) {
    return readUserMemoryEntries();
  }
  let next = readUserMemoryEntries();
  for (const candidate of candidates) {
    next = addUserMemoryEntry(candidate, "auto");
  }
  return next;
}

function tokenize(text: string): string[] {
  const suffixes = [
    "으로",
    "에서",
    "에게",
    "부터",
    "까지",
    "하고",
    "하며",
    "하는",
    "한다",
    "하다",
    "이고",
    "이며",
    "적인",
    "적",
    "과",
    "와",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "도",
    "의",
    "다",
    "요",
  ];
  const tokens = normalizeMemoryText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    for (const suffix of suffixes) {
      if (token.length > suffix.length + 1 && token.endsWith(suffix)) {
        expanded.add(token.slice(0, -suffix.length));
      }
    }
  }
  return [...expanded];
}

export function rankUserMemoryEntries(params: {
  query: string;
  entries?: UserMemoryEntry[];
  topK?: number;
}): Array<{ entry: UserMemoryEntry; score: number }> {
  const entries = params.entries ?? readUserMemoryEntries();
  if (entries.length === 0) {
    return [];
  }
  const queryTokens = new Set(tokenize(params.query));
  const topK = Math.max(1, Math.min(8, Number(params.topK ?? 4) || 4));
  return entries
    .map((entry, index) => {
      const memoryTokens = tokenize(entry.text);
      const overlap = memoryTokens.filter((token) => {
        return [...queryTokens].some(
          (queryToken) =>
            queryToken === token ||
            queryToken.includes(token) ||
            token.includes(queryToken),
        );
      }).length;
      const recencyBoost = Math.max(0, entries.length - index) * 0.03;
      const manualBoost = entry.source === "manual" ? 0.25 : 0;
      const baseScore = overlap + recencyBoost + manualBoost;
      return {
        entry,
        score: queryTokens.size === 0 ? manualBoost + recencyBoost : baseScore,
      };
    })
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
    .slice(0, topK)
    .filter((row, index) => row.score > 0 || index === 0);
}

export function buildUserMemoryPromptBlock(entries: UserMemoryEntry[]): string {
  const normalized = entries
    .map((entry) => normalizeMemoryText(entry.text))
    .filter(Boolean)
    .slice(0, 4);
  if (normalized.length === 0) {
    return "";
  }
  return [
    "[사용자 장기 메모리]",
    ...normalized.map((line) => `- ${line}`),
    "위 메모리는 사용자의 장기 성향/제약입니다. 관련 있을 때만 반영하고, 현재 요청과 충돌하면 현재 요청을 우선하십시오.",
    "메모리에 없는 사실을 덧붙여 상상하지 마십시오.",
    "[/사용자 장기 메모리]",
  ].join("\n");
}
