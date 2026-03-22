import type { StudioRoleId } from "./handoffTypes";

const ROLE_KNOWLEDGE_STORAGE_KEY = "rail.studio.role_knowledge.v1";

function getStorage(): Storage | null {
  const candidate = typeof globalThis !== "undefined" ? (globalThis as { localStorage?: Storage }).localStorage : undefined;
  return candidate ?? null;
}

export type RoleKnowledgeSource = {
  url: string;
  provider?: string;
  status: "ok" | "error";
  summary?: string;
  content?: string;
  markdownPath?: string;
  jsonPath?: string;
  error?: string;
  fetchedAt?: string;
};

export type RoleKnowledgeProfile = {
  roleId: StudioRoleId;
  scope?: "shared" | "instance";
  instanceId?: string;
  roleLabel: string;
  goal: string;
  taskId: string;
  runId: string;
  summary: string;
  keyPoints: string[];
  sources: RoleKnowledgeSource[];
  updatedAt: string;
  markdownPath?: string;
  jsonPath?: string;
};

function normalizeRoleId(raw: unknown): StudioRoleId | null {
  const value = String(raw ?? "").trim();
  if (
    value === "pm_planner" ||
    value === "pm_creative_director" ||
    value === "pm_feasibility_critic" ||
    value === "research_analyst" ||
    value === "client_programmer" ||
    value === "system_programmer" ||
    value === "tooling_engineer" ||
    value === "art_pipeline" ||
    value === "qa_engineer" ||
    value === "build_release" ||
    value === "technical_writer"
  ) {
    return value;
  }
  return null;
}

function normalizeSource(raw: unknown): RoleKnowledgeSource | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const url = String(row.url ?? "").trim();
  if (!url) {
    return null;
  }
  const status = String(row.status ?? "").trim().toLowerCase() === "ok" ? "ok" : "error";
  return {
    url,
    provider: String(row.provider ?? "").trim() || undefined,
    status,
    summary: String(row.summary ?? "").trim() || undefined,
    content: String(row.content ?? "").trim() || undefined,
    markdownPath: String(row.markdownPath ?? "").trim() || undefined,
    jsonPath: String(row.jsonPath ?? "").trim() || undefined,
    error: String(row.error ?? "").trim() || undefined,
    fetchedAt: String(row.fetchedAt ?? "").trim() || undefined,
  };
}

function normalizeProfile(raw: unknown): RoleKnowledgeProfile | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const roleId = normalizeRoleId(row.roleId);
  if (!roleId) {
    return null;
  }
  const runId = String(row.runId ?? "").trim();
  const summary = String(row.summary ?? "").trim();
  if (!runId || !summary) {
    return null;
  }
  return {
    roleId,
    scope: String(row.scope ?? "").trim().toLowerCase() === "instance" ? "instance" : "shared",
    instanceId: String(row.instanceId ?? "").trim() || undefined,
    roleLabel: String(row.roleLabel ?? "").trim() || roleId,
    goal: String(row.goal ?? "").trim(),
    taskId: String(row.taskId ?? "").trim() || "TASK-001",
    runId,
    summary,
    keyPoints: Array.isArray(row.keyPoints)
      ? row.keyPoints.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [],
    sources: Array.isArray(row.sources)
      ? row.sources.map((value) => normalizeSource(value)).filter((value): value is RoleKnowledgeSource => value !== null)
      : [],
    updatedAt: String(row.updatedAt ?? "").trim() || new Date().toISOString(),
    markdownPath: String(row.markdownPath ?? "").trim() || undefined,
    jsonPath: String(row.jsonPath ?? "").trim() || undefined,
  };
}

export function readRoleKnowledgeProfiles(): RoleKnowledgeProfile[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  const raw = storage.getItem(ROLE_KNOWLEDGE_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((row) => normalizeProfile(row)).filter((row): row is RoleKnowledgeProfile => row !== null);
  } catch {
    return [];
  }
}

export function writeRoleKnowledgeProfiles(rows: RoleKnowledgeProfile[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.setItem(ROLE_KNOWLEDGE_STORAGE_KEY, JSON.stringify(rows));
}

export function getRoleKnowledgeProfile(roleId: StudioRoleId): RoleKnowledgeProfile | null {
  return readRoleKnowledgeProfiles().find((row) => row.roleId === roleId && (row.scope ?? "shared") === "shared") ?? null;
}

export function upsertRoleKnowledgeProfile(profile: RoleKnowledgeProfile): RoleKnowledgeProfile[] {
  const current = readRoleKnowledgeProfiles();
  const normalizedScope = profile.scope ?? "shared";
  const normalizedInstanceId = String(profile.instanceId ?? "").trim() || undefined;
  const matchesProfile = (row: RoleKnowledgeProfile) =>
    row.roleId === profile.roleId &&
    (row.scope ?? "shared") === normalizedScope &&
    (String(row.instanceId ?? "").trim() || undefined) === normalizedInstanceId;
  const next = current.some(matchesProfile)
    ? current.map((row) => (matchesProfile(row) ? { ...profile, scope: normalizedScope, instanceId: normalizedInstanceId } : row))
    : [...current, { ...profile, scope: normalizedScope, instanceId: normalizedInstanceId }];
  writeRoleKnowledgeProfiles(next);
  return next;
}

export function getRoleInstanceKnowledgeProfile(
  roleId: StudioRoleId,
  instanceId: string,
): RoleKnowledgeProfile | null {
  const normalizedInstanceId = String(instanceId ?? "").trim();
  if (!normalizedInstanceId) {
    return null;
  }
  return (
    readRoleKnowledgeProfiles().find(
      (row) =>
        row.roleId === roleId &&
        (row.scope ?? "shared") === "instance" &&
        String(row.instanceId ?? "").trim() === normalizedInstanceId,
    ) ?? null
  );
}

export async function persistRoleKnowledgeProfilesToWorkspace(params: {
  cwd: string;
  invokeFn: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  rows: RoleKnowledgeProfile[];
}): Promise<string | null> {
  const cwd = String(params.cwd ?? "").trim().replace(/[\\/]+$/, "");
  if (!cwd) {
    return null;
  }
  try {
    const payload = `${JSON.stringify(params.rows, null, 2)}\n`;
    const path = await params.invokeFn<string>("workspace_write_text", {
      cwd: `${cwd}/.rail/studio_index/role_kb`,
      name: "profiles.json",
      content: payload,
    });
    return path;
  } catch {
    return null;
  }
}
