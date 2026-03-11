import {
  DEFAULT_TURN_MODEL,
  TURN_EXECUTOR_OPTIONS,
  WEB_PROVIDER_OPTIONS,
  normalizeWebResultMode,
  toArtifactType,
  toQualityProfileId,
  toTurnModelDisplayName,
  type TurnExecutor,
  type WebProvider,
} from "../features/workflow/domain";
import { QUALITY_DEFAULT_THRESHOLD } from "../features/workflow/quality";
import {
  normalizeTurnContextBudget,
  normalizeTurnMaxInputChars,
  normalizeTurnTemperature,
  TURN_CONTEXT_BUDGET_MAX_INPUT_CHARS,
} from "../features/workflow/turnExecutionTuning";
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  KnowledgeConfig,
  KnowledgeFileRef,
  KnowledgeFileStatus,
  NodeAnchorSide,
  PortType,
} from "../features/workflow/types";
import {
  extractCompletedStatus,
  extractStringByPaths,
  readNumber,
} from "./mainAppUtils";
import { useI18n } from "../i18n";

export type WorkspaceTab =
  | "workbench"
  | "dashboard"
  | "intelligence"
  | "workflow"
  | "feed"
  | "agents"
  | "handoff"
  | "knowledge"
  | "adaptation"
  | "settings"
  | "bridge";

export type TurnTerminal = {
  ok: boolean;
  status: string;
  params: unknown;
};

export type WebBridgeProviderSeen = {
  provider: WebProvider;
  pageUrl?: string | null;
  lastSeenAt?: string | null;
};

export type WebBridgeStatus = {
  running: boolean;
  port: number;
  tokenMasked: string;
  token?: string;
  tokenStorage?: string;
  extensionOriginAllowlistConfigured?: boolean;
  allowedExtensionOriginCount?: number;
  extensionOriginPolicy?: "allowlist" | "token_only";
  lastSeenAt?: string | null;
  connectedProviders: WebBridgeProviderSeen[];
  queuedTasks: number;
  activeTasks: number;
};

export const GRAPH_SCHEMA_VERSION = 3;
export const KNOWLEDGE_DEFAULT_TOP_K = 0;
export const KNOWLEDGE_DEFAULT_MAX_CHARS = 2800;

function normalizeKnowledgeStatus(input: unknown): KnowledgeFileStatus | undefined {
  if (input === "ready" || input === "missing" || input === "unsupported" || input === "error") {
    return input;
  }
  return undefined;
}

function normalizeKnowledgeFile(input: unknown): KnowledgeFileRef | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const row = input as Record<string, unknown>;
  const rawPath = String(row.path ?? "").trim();
  if (!rawPath) {
    return null;
  }

  const id = String(row.id ?? "").trim() || rawPath;
  const name = String(row.name ?? "").trim() || rawPath.split(/[\\/]/).pop() || rawPath;
  const ext = String(row.ext ?? "").trim();
  const enabled = typeof row.enabled === "boolean" ? row.enabled : true;
  const sizeBytes = readNumber(row.sizeBytes);
  const mtimeMs = readNumber(row.mtimeMs);
  const status = normalizeKnowledgeStatus(row.status);
  const statusMessage = typeof row.statusMessage === "string" ? row.statusMessage : undefined;

  return {
    id,
    name,
    path: rawPath,
    ext,
    enabled,
    sizeBytes,
    mtimeMs,
    status,
    statusMessage,
  };
}

export function defaultKnowledgeConfig(): KnowledgeConfig {
  return {
    files: [],
    topK: KNOWLEDGE_DEFAULT_TOP_K,
    maxChars: KNOWLEDGE_DEFAULT_MAX_CHARS,
  };
}

export function normalizeKnowledgeConfig(input: unknown): KnowledgeConfig {
  if (!input || typeof input !== "object") {
    return defaultKnowledgeConfig();
  }
  const row = input as Record<string, unknown>;
  const files = Array.isArray(row.files) ? row.files.map(normalizeKnowledgeFile).filter(Boolean) : [];
  const topK = Math.max(0, Math.min(5, readNumber(row.topK) ?? KNOWLEDGE_DEFAULT_TOP_K));
  const maxChars = Math.max(300, Math.min(20_000, readNumber(row.maxChars) ?? KNOWLEDGE_DEFAULT_MAX_CHARS));
  return {
    files: files as KnowledgeFileRef[],
    topK,
    maxChars,
  };
}

export function toWebBridgeStatus(raw: unknown): WebBridgeStatus {
  const fallback: WebBridgeStatus = {
    running: false,
    port: 38961,
    tokenMasked: "",
    extensionOriginAllowlistConfigured: false,
    allowedExtensionOriginCount: 0,
    extensionOriginPolicy: "token_only",
    connectedProviders: [],
    queuedTasks: 0,
    activeTasks: 0,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const row = raw as Record<string, unknown>;
  const connectedProviders = Array.isArray(row.connectedProviders)
    ? row.connectedProviders
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }
          const entry = item as Record<string, unknown>;
          const providerRaw = String(entry.provider ?? "").trim().toLowerCase();
          if (!WEB_PROVIDER_OPTIONS.includes(providerRaw as WebProvider)) {
            return null;
          }
          return {
            provider: providerRaw as WebProvider,
            pageUrl: typeof entry.pageUrl === "string" ? entry.pageUrl : entry.pageUrl == null ? null : undefined,
            lastSeenAt:
              typeof entry.lastSeenAt === "string"
                ? entry.lastSeenAt
                : entry.lastSeenAt == null
                  ? null
                  : undefined,
          } as WebBridgeProviderSeen;
        })
        .filter(Boolean) as WebBridgeProviderSeen[]
    : [];
  return {
    running: row.running === true,
    port: Number(row.port ?? 38961) || 38961,
    tokenMasked: typeof row.tokenMasked === "string" ? row.tokenMasked : "",
    token: typeof row.token === "string" ? row.token : undefined,
    tokenStorage: typeof row.tokenStorage === "string" ? row.tokenStorage : undefined,
    extensionOriginAllowlistConfigured: row.extensionOriginAllowlistConfigured === true,
    allowedExtensionOriginCount: Math.max(0, Number(row.allowedExtensionOriginCount ?? 0) || 0),
    extensionOriginPolicy:
      row.extensionOriginPolicy === "allowlist" || row.extensionOriginPolicy === "token_only"
        ? row.extensionOriginPolicy
        : "token_only",
    lastSeenAt: typeof row.lastSeenAt === "string" ? row.lastSeenAt : row.lastSeenAt == null ? null : undefined,
    connectedProviders,
    queuedTasks: Math.max(0, Number(row.queuedTasks ?? 0) || 0),
    activeTasks: Math.max(0, Number(row.activeTasks ?? 0) || 0),
  };
}

export function NavIcon({ tab, active = false }: { tab: WorkspaceTab; active?: boolean }) {
  if (tab === "workbench") {
    return <img alt="" aria-hidden="true" className="nav-workflow-image" src="/workflow.svg" />;
  }
  if (tab === "dashboard") {
    return <img alt="" aria-hidden="true" className="nav-workflow-image" src="/home.svg" />;
  }
  if (tab === "intelligence") {
    return <img alt="" aria-hidden="true" className="nav-workflow-image" src="/data-service-svgrepo-com.svg" />;
  }
  if (tab === "workflow") {
    return (
      <img alt="" aria-hidden="true" className="nav-workflow-image" src="/node-svgrepo-com.svg" />
    );
  }
  if (tab === "feed") {
    return (
      <img
        alt=""
        aria-hidden="true"
        className="nav-workflow-image nav-feed-image"
        src={active ? "/post.svg" : "/post.svg"}
      />
    );
  }
  if (tab === "agents") {
    return (
      <img alt="" aria-hidden="true" className="nav-workflow-image" src="/workflow.svg" />
    );
  }
  if (tab === "settings") {
    return <img alt="" aria-hidden="true" className="nav-workflow-image" src="/setting.svg" />;
  }
  if (tab === "adaptation") {
    return (
      <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
        <path
          d="M12 4.5l1.8 3.7 4.1.6-2.9 2.9.7 4.1-3.7-2-3.7 2 .7-4.1-2.9-2.9 4.1-.6 1.8-3.7z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
      </svg>
    );
  }
  if (tab === "handoff") {
    return <img alt="" aria-hidden="true" className="nav-workflow-image" src="/scroll.svg" />;
  }
  if (tab === "knowledge") {
    return <img alt="" aria-hidden="true" className="nav-workflow-image" src="/data-service-svgrepo-com.svg" />;
  }
  if (tab === "bridge") {
    return <img alt="" aria-hidden="true" className="nav-workflow-image" src="/scroll.svg" />;
  }
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path
        d="M12 3.5l2 1.1 2.3-.2 1 2 2 .9-.1 2.4 1.4 1.8-1.4 1.8.1 2.4-2 .9-1 2-2.3-.2-2 1.1-2-1.1-2.3.2-1-2-2-.9.1-2.4-1.4-1.8 1.4-1.8-.1-2.4 2-.9 1-2 2.3.2 2-1.1z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function InspectorSectionTitle({
  title,
  help,
  className,
}: {
  title: string;
  help: string;
  className?: string;
}) {
  const { t } = useI18n();
  const rootClassName = className ? `inspector-section-title ${className}` : "inspector-section-title";
  return (
    <div className={rootClassName}>
      <h3>{title}</h3>
      <span aria-label={`${title} ${t("common.help")}`} className="help-tooltip" data-tooltip={help} role="note" tabIndex={0}>
        ?
      </span>
      <div className="help-tooltip-panel" role="tooltip">
        {help}
      </div>
    </div>
  );
}

export function normalizeGraph(input: unknown): GraphData {
  if (!input || typeof input !== "object") {
    return { version: GRAPH_SCHEMA_VERSION, nodes: [], edges: [], knowledge: defaultKnowledgeConfig() };
  }

  const data = input as Record<string, unknown>;
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const version = typeof data.version === "number" ? data.version : 1;

  const normalizedNodes = nodes
    .filter((node): node is GraphNode => Boolean(node))
    .map((node) => {
      if (node.type !== "turn") {
        return node;
      }
      const config = (node.config ?? {}) as Record<string, unknown>;
      const rawExecutor = typeof config.executor === "string" ? config.executor : "codex";
      const executor = TURN_EXECUTOR_OPTIONS.includes(rawExecutor as TurnExecutor)
        ? rawExecutor
        : "codex";
      const contextBudget = normalizeTurnContextBudget(config.contextBudget);
      const normalizedConfig = {
        ...config,
        executor,
        webResultMode: normalizeWebResultMode(config.webResultMode),
        model: toTurnModelDisplayName(String(config.model ?? DEFAULT_TURN_MODEL)),
        temperature: normalizeTurnTemperature(config.temperature),
        contextBudget,
        maxInputChars: normalizeTurnMaxInputChars(
          config.maxInputChars,
          TURN_CONTEXT_BUDGET_MAX_INPUT_CHARS[contextBudget],
        ),
        knowledgeEnabled:
          typeof config.knowledgeEnabled === "boolean" ? config.knowledgeEnabled : true,
        qualityProfile: toQualityProfileId(config.qualityProfile) ?? undefined,
        qualityThreshold: normalizeQualityThreshold(
          readNumber(config.qualityThreshold) ?? QUALITY_DEFAULT_THRESHOLD,
        ),
        qualityCommandEnabled:
          typeof config.qualityCommandEnabled === "boolean" ? config.qualityCommandEnabled : false,
        qualityCommands: String(config.qualityCommands ?? "npm run build"),
        outputSchemaJson: String(config.outputSchemaJson ?? ""),
        artifactType: toArtifactType(config.artifactType),
      };
      return {
        ...node,
        config: normalizedConfig,
      };
    });

  const normalizedEdges = edges
    .map((edge) => {
      if (!edge || typeof edge !== "object") {
        return null;
      }
      const row = edge as Record<string, unknown>;
      const from = row.from as Record<string, unknown> | undefined;
      const to = row.to as Record<string, unknown> | undefined;
      if (!from || !to) {
        return null;
      }
      const fromNodeId = String(from.nodeId ?? "").trim();
      const toNodeId = String(to.nodeId ?? "").trim();
      if (!fromNodeId || !toNodeId) {
        return null;
      }
      const controlRow =
        row.control && typeof row.control === "object"
          ? (row.control as Record<string, unknown>)
          : null;
      const controlX = controlRow ? readNumber(controlRow.x) : undefined;
      const controlY = controlRow ? readNumber(controlRow.y) : undefined;
      return {
        from: {
          nodeId: fromNodeId,
          port: "out" as PortType,
          side:
            from.side === "top" || from.side === "right" || from.side === "bottom" || from.side === "left"
              ? (from.side as NodeAnchorSide)
              : undefined,
        },
        to: {
          nodeId: toNodeId,
          port: "in" as PortType,
          side: to.side === "top" || to.side === "right" || to.side === "bottom" || to.side === "left"
            ? (to.side as NodeAnchorSide)
            : undefined,
        },
        control:
          typeof controlX === "number" && typeof controlY === "number"
            ? { x: controlX, y: controlY }
            : undefined,
      } as GraphEdge;
    })
    .filter(Boolean) as GraphEdge[];

  return {
    version: Math.max(version, GRAPH_SCHEMA_VERSION),
    nodes: normalizedNodes,
    edges: normalizedEdges,
    knowledge: normalizeKnowledgeConfig(data.knowledge),
  };
}

export function validateSimpleSchema(schema: unknown, data: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object") {
    return [];
  }

  const rule = schema as Record<string, unknown>;
  const errors: string[] = [];

  if (Array.isArray(rule.enum) && rule.enum.length > 0) {
    const exists = rule.enum.some((item) => JSON.stringify(item) === JSON.stringify(data));
    if (!exists) {
      errors.push(`${path}: value must be one of enum`);
      return errors;
    }
  }

  const expectedType = typeof rule.type === "string" ? rule.type : "";
  if (expectedType) {
    const typeOk =
      (expectedType === "object" && data !== null && typeof data === "object" && !Array.isArray(data)) ||
      (expectedType === "array" && Array.isArray(data)) ||
      (expectedType === "string" && typeof data === "string") ||
      (expectedType === "number" && typeof data === "number") ||
      (expectedType === "integer" && Number.isInteger(data)) ||
      (expectedType === "boolean" && typeof data === "boolean") ||
      (expectedType === "null" && data === null);
    if (!typeOk) {
      errors.push(`${path}: expected type ${expectedType}`);
      return errors;
    }
  }

  if (expectedType === "object" && data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (Array.isArray(rule.required)) {
      for (const key of rule.required) {
        if (typeof key === "string" && !(key in record)) {
          errors.push(`${path}.${key}: required`);
        }
      }
    }
    if (rule.properties && typeof rule.properties === "object") {
      const properties = rule.properties as Record<string, unknown>;
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in record) {
          errors.push(...validateSimpleSchema(childSchema, record[key], `${path}.${key}`));
        }
      }
    }
  }

  if (expectedType === "array" && Array.isArray(data) && rule.items) {
    for (let i = 0; i < data.length; i += 1) {
      errors.push(...validateSimpleSchema(rule.items, data[i], `${path}[${i}]`));
    }
  }

  return errors;
}

export function isTurnTerminalEvent(method: string, params: unknown): TurnTerminal | null {
  if (method === "turn/completed") {
    return { ok: true, status: "completed", params };
  }
  if (method === "turn/failed") {
    return { ok: false, status: "failed", params };
  }

  if (method === "item/completed") {
    const kind = extractStringByPaths(params, ["type", "kind", "item.type", "item.kind"]);
    if (kind && !kind.toLowerCase().includes("turn")) {
      return null;
    }
    const status = (extractCompletedStatus(params) ?? "").toLowerCase();
    if (["failed", "error", "cancelled", "rejected"].includes(status)) {
      return { ok: false, status, params };
    }
    if (["completed", "done", "success", "succeeded"].includes(status)) {
      return { ok: true, status, params };
    }
  }

  return null;
}

function normalizeQualityThreshold(value: unknown): number {
  const parsed = Number(value);
  const fallback = QUALITY_DEFAULT_THRESHOLD;
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  const clamped = Math.max(10, Math.min(100, safe));
  return Math.round(clamped / 10) * 10;
}
