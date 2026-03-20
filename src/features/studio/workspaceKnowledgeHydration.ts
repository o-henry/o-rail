import type { KnowledgeEntry } from "./knowledgeTypes";
import {
  mergeKnowledgeEntryRows,
  normalizeKnowledgeEntries,
  readKnowledgeEntries,
  writeKnowledgeEntries,
} from "./knowledgeIndex";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function normalizeCwd(cwd: string): string {
  return String(cwd ?? "").trim().replace(/[\\/]+$/, "");
}

function mergeAndPersist(rows: KnowledgeEntry[]): KnowledgeEntry[] {
  const merged = mergeKnowledgeEntryRows(rows);
  writeKnowledgeEntries(merged);
  return merged;
}

export async function hydrateKnowledgeEntriesFromWorkspaceArtifacts(params: {
  cwd: string;
  invokeFn: InvokeFn;
}): Promise<KnowledgeEntry[]> {
  const cwd = normalizeCwd(params.cwd);
  if (!cwd) {
    return readKnowledgeEntries();
  }
  try {
    const raw = await params.invokeFn<unknown[]>("knowledge_scan_workspace_artifacts", { cwd });
    const workspaceRows = normalizeKnowledgeEntries(raw);
    if (workspaceRows.length === 0) {
      return readKnowledgeEntries();
    }
    return mergeAndPersist([...readKnowledgeEntries(), ...workspaceRows]);
  } catch {
    return readKnowledgeEntries();
  }
}

export async function hydrateKnowledgeEntriesFromWorkspaceSources(params: {
  cwd: string;
  invokeFn: InvokeFn;
}): Promise<KnowledgeEntry[]> {
  const cwd = normalizeCwd(params.cwd);
  if (!cwd) {
    return readKnowledgeEntries();
  }
  let merged = readKnowledgeEntries();
  try {
    const raw = await params.invokeFn<string>("workspace_read_text", {
      cwd,
      path: ".rail/studio_index/knowledge/index.json",
    });
    merged = mergeAndPersist([...merged, ...normalizeKnowledgeEntries(JSON.parse(String(raw ?? "[]")) as unknown)]);
  } catch {
    // ignore workspace index hydrate failures
  }
  return hydrateKnowledgeEntriesFromWorkspaceArtifacts({ cwd, invokeFn: params.invokeFn });
}
