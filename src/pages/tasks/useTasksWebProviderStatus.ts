import { useCallback, useEffect, useMemo, useState } from "react";
import { getWebProviderFromExecutor, type WebProvider } from "../../features/workflow/domain";
import { findRuntimeModelOption } from "../../features/workflow/runtimeModelOptions";

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type WebProviderHealthRecord = {
  sessionState?: string | null;
  message?: string | null;
  url?: string | null;
  ready?: boolean;
};

type WebWorkerHealth = {
  running?: boolean;
  lastError?: string | null;
  providers?: unknown;
  bridge?: unknown;
};

type WebBridgeConnectedProvider = {
  provider?: string | null;
};

type WebProviderOpenSessionResult = {
  ok?: boolean;
  sessionState?: string | null;
  message?: string | null;
  error?: string | null;
  errorCode?: string | null;
};

export type TasksWebProviderStatus = {
  modelValue: string;
  provider: WebProvider;
  label: string;
  state: "idle" | "checking" | "active" | "login_required" | "unavailable" | "error";
  message: string;
  url: string;
  connected: boolean;
};

function toObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toProviderLabel(modelValue: string): string {
  return findRuntimeModelOption(modelValue).label;
}

function resolveWebProviderForModel(modelValue: string): WebProvider | null {
  const option = findRuntimeModelOption(modelValue);
  return getWebProviderFromExecutor(option.executor);
}

function resolveSelectedProviders(modelValues: string[]): Array<{ modelValue: string; provider: WebProvider; label: string }> {
  const seen = new Set<string>();
  const rows: Array<{ modelValue: string; provider: WebProvider; label: string }> = [];
  for (const modelValue of modelValues) {
    const normalized = String(modelValue ?? "").trim();
    const provider = resolveWebProviderForModel(normalized);
    if (!normalized || !provider || seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    rows.push({
      modelValue: normalized,
      provider,
      label: toProviderLabel(normalized),
    });
  }
  return rows;
}

export function buildTasksWebProviderStatusSelectionKey(modelValues: string[]): string {
  return resolveSelectedProviders(modelValues)
    .map(({ provider, modelValue }) => `${provider}:${modelValue}`)
    .join("|");
}

function resolveConnectedProviders(bridge: unknown): Set<string> {
  const bridgeRecord = toObjectRecord(bridge);
  const connectedProviders = Array.isArray(bridgeRecord.connectedProviders)
    ? bridgeRecord.connectedProviders
    : [];
  return new Set(
    connectedProviders
      .map((row) => String((row as WebBridgeConnectedProvider | null)?.provider ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
}

export function buildTasksWebProviderStatuses(params: {
  modelValues: string[];
  health: WebWorkerHealth | null;
  checking?: boolean;
}): TasksWebProviderStatus[] {
  const selectedProviders = resolveSelectedProviders(params.modelValues);
  const healthRecord = params.health ? toObjectRecord(params.health.providers) : {};
  const connectedProviders = resolveConnectedProviders(params.health?.bridge);
  const showCheckingState = Boolean(params.checking && !params.health);
  return selectedProviders.map(({ modelValue, provider, label }) => {
    if (showCheckingState) {
      return {
        modelValue,
        provider,
        label,
        state: "checking",
        message: "상태 확인 중",
        url: "",
        connected: connectedProviders.has(provider),
      };
    }
    const providerHealth = toObjectRecord(healthRecord[provider]) as WebProviderHealthRecord;
    const sessionState = String(providerHealth.sessionState ?? "").trim().toLowerCase();
    const message = String(providerHealth.message ?? "").trim();
    const url = String(providerHealth.url ?? "").trim();
    const connected = connectedProviders.has(provider);
    if (sessionState === "active" || providerHealth.ready === true) {
      return {
        modelValue,
        provider,
        label,
        state: "active",
        message: connected ? "브리지 연결됨" : message || "세션 준비됨",
        url,
        connected,
      };
    }
    if (sessionState === "login_required") {
      return {
        modelValue,
        provider,
        label,
        state: "login_required",
        message: message || "로그인 필요",
        url,
        connected,
      };
    }
    if (params.health && params.health.running === false && !providerHealth.ready && !sessionState) {
      return {
        modelValue,
        provider,
        label,
        state: "unavailable",
        message: "워커 미시작",
        url: "",
        connected,
      };
    }
    if (message || url || sessionState) {
      return {
        modelValue,
        provider,
        label,
        state: "unavailable",
        message: message || sessionState || "세션 확인 필요",
        url,
        connected,
      };
    }
    return {
      modelValue,
      provider,
      label,
      state: "idle",
      message: "상태 확인 필요",
      url: "",
      connected,
    };
  });
}

export function useTasksWebProviderStatus(params: {
  hasTauriRuntime: boolean;
  invokeFn: InvokeFn;
  modelValues: string[];
  setStatus: (message: string) => void;
}) {
  const selectedProviders = useMemo(() => resolveSelectedProviders(params.modelValues), [params.modelValues]);
  const selectedProviderKey = useMemo(
    () => buildTasksWebProviderStatusSelectionKey(params.modelValues),
    [params.modelValues],
  );
  const [health, setHealth] = useState<WebWorkerHealth | null>(null);
  const [checking, setChecking] = useState(false);

  const refreshStatuses = useCallback(async () => {
    if (!params.hasTauriRuntime || selectedProviders.length === 0) {
      setHealth(null);
      return null;
    }
    setChecking(true);
    try {
      const nextHealth = await params.invokeFn<WebWorkerHealth>("web_provider_health");
      setHealth(nextHealth);
      return nextHealth;
    } finally {
      setChecking(false);
    }
  }, [params.hasTauriRuntime, params.invokeFn, selectedProviderKey, selectedProviders.length]);

  const openProviderSession = useCallback(async (provider: WebProvider) => {
    if (!params.hasTauriRuntime) {
      return;
    }
    setChecking(true);
    try {
      const result = await params.invokeFn<WebProviderOpenSessionResult>("web_provider_open_session", { provider });
      const message = String(result?.message ?? "").trim();
      const sessionState = String(result?.sessionState ?? "").trim().toLowerCase();
      if (sessionState === "active") {
        params.setStatus(`${provider.toUpperCase()} 세션이 준비되었습니다.`);
      } else if (sessionState === "login_required") {
        params.setStatus(`${provider.toUpperCase()} 로그인 창을 열었습니다.`);
      } else if (message) {
        params.setStatus(message);
      }
      await refreshStatuses();
      return result;
    } finally {
      setChecking(false);
    }
  }, [params.hasTauriRuntime, params.invokeFn, params.setStatus, refreshStatuses]);

  useEffect(() => {
    if (selectedProviders.length === 0) {
      setHealth(null);
      return;
    }
    void refreshStatuses();
  }, [refreshStatuses, selectedProviderKey, selectedProviders.length]);

  return {
    providerStatuses: buildTasksWebProviderStatuses({
      modelValues: params.modelValues,
      health,
      checking,
    }),
    providerStatusPending: checking,
    refreshProviderStatuses: refreshStatuses,
    openProviderSession,
  };
}
