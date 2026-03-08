import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_TOPIC_IDS } from "../../features/dashboard/intelligence";
import { DEFAULT_RUNTIME_MODEL_VALUE } from "../../features/workflow/runtimeModelOptions";
import { useCodeChangeApproval } from "../../features/studio/useCodeChangeApproval";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";
import { AGENT_MODEL_OPTIONS, AGENT_REASON_LEVEL_OPTIONS } from "./agentOptions";
import { buildAgentDispatchPayload } from "./agentPrompt";
import { prependAgentRequest } from "./requestHistory";
import {
  buildGroupedSetOptions,
  buildPresetSnapshot,
  createCustomThread,
  createFallbackSetState,
  createInitialSetStateMap,
  createStateFromPresetSnapshot,
  restoreSetStateFromPreset,
} from "./agentSetState";
import { formatTopicToken, roleFromSetId, topicFromSetId } from "./agentsTopicUtils";
import type {
  AgentDataSourceItem,
  AgentSetOption,
  AgentSetPresetSnapshot,
  AgentSetState,
  AgentsPageProps,
  AttachedFile,
} from "./agentTypes";
type UseAgentsPageStateParams = Pick<AgentsPageProps,
  "codexMultiAgentMode" | "launchRequest" | "missionControl" | "onQuickAction" | "onRunRole" | "onRunDataTopic" | "runStateByTopic" | "topicSnapshots"
> & {
  translate: (key: string) => string;
};
export function useAgentsPageState(params: UseAgentsPageStateParams) {
  const setOptions = useMemo<AgentSetOption[]>(
    () =>
      STUDIO_ROLE_TEMPLATES.map((role) => ({
        id: `role-${role.id}`,
        label: `${role.label} 에이전트`,
        description: role.goal,
      })),
    [],
  );
  const setPresetById = useMemo<Record<string, AgentSetPresetSnapshot>>(
    () =>
      setOptions.reduce<Record<string, AgentSetPresetSnapshot>>((acc, option) => {
        acc[option.id] = buildPresetSnapshot(option);
        return acc;
      }, {}),
    [setOptions],
  );
  const groupedSetOptions = useMemo(() => buildGroupedSetOptions(setOptions), [setOptions]);
  const modelOptions = useMemo(() => AGENT_MODEL_OPTIONS, []);
  const reasonLevelOptions = useMemo(() => AGENT_REASON_LEVEL_OPTIONS, []);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [setStateMap, setSetStateMap] = useState<Record<string, AgentSetState>>(() =>
    createInitialSetStateMap(setOptions, setPresetById),
  );
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isReasonMenuOpen, setIsReasonMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_RUNTIME_MODEL_VALUE);
  const [selectedReasonLevel, setSelectedReasonLevel] = useState("중간");
  const { pendingApprovals, requestApproval, resolveApproval } = useCodeChangeApproval();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const reasonMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setSetStateMap((prev) => {
      const next = { ...prev };
      for (const setOption of setOptions) {
        if (!next[setOption.id]) {
          const preset = setPresetById[setOption.id];
          next[setOption.id] = preset ? createStateFromPresetSnapshot(preset) : createFallbackSetState();
        }
      }
      return next;
    });
  }, [setOptions, setPresetById]);
  useEffect(() => {
    if (!params.launchRequest) {
      return;
    }
    const nextSetId = String(params.launchRequest.setId ?? "").trim();
    if (!nextSetId || !setOptions.some((option) => option.id === nextSetId)) {
      return;
    }
    setActiveSetId(nextSetId);
    const nextDraft = String(params.launchRequest.draft ?? "").trim();
    if (!nextDraft) {
      return;
    }
    setSetStateMap((prev) => {
      const current = prev[nextSetId] ?? createFallbackSetState();
      return {
        ...prev,
        [nextSetId]: {
          ...current,
          draft: nextDraft,
        },
      };
    });
  }, [params.launchRequest, setOptions]);
  const activeSetOption = useMemo(
    () => (activeSetId ? setOptions.find((option) => option.id === activeSetId) ?? null : null),
    [activeSetId, setOptions],
  );
  const currentSetState = useMemo(() => {
    if (!activeSetId) {
      return null;
    }
    return setStateMap[activeSetId] ?? createFallbackSetState();
  }, [activeSetId, setStateMap]);
  const activeDataTopicId = useMemo(() => topicFromSetId(activeSetOption?.id ?? null), [activeSetOption?.id]);
  const activeDataRunState = activeDataTopicId ? params.runStateByTopic[activeDataTopicId] : undefined;
  const activeDataSnapshotRunId = useMemo(() => (
    activeDataTopicId
      ? String(params.topicSnapshots[activeDataTopicId]?.runId ?? params.topicSnapshots[activeDataTopicId]?.generatedAt ?? "").trim() || null
      : null
  ), [activeDataTopicId, params.topicSnapshots]);
  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === selectedModel) ?? modelOptions[0],
    [modelOptions, selectedModel],
  );
  const isReasonLevelSelectable = selectedModelOption?.allowsReasonLevel !== false;
  const threads = currentSetState?.threads ?? [];
  const activeThreadId = currentSetState?.activeThreadId ?? "";
  const draft = currentSetState?.draft ?? "";
  const attachedFiles = currentSetState?.attachedFiles ?? [];
  const setMission = currentSetState?.setMission ?? "";
  const dashboardInsights = currentSetState?.dashboardInsights ?? [];
  const enabledAttachedFileNames = currentSetState?.enabledAttachedFileNames ?? [];
  const enabledDataSourceIds = currentSetState?.enabledDataSourceIds ?? [];
  const requestHistory = currentSetState?.requestHistory ?? [];
  const recentDataSources = useMemo<AgentDataSourceItem[]>(
    () =>
      DASHBOARD_TOPIC_IDS.map((topic) => {
        const snapshot = params.topicSnapshots[topic];
        if (!snapshot) {
          return null;
        }
        const summary = String(snapshot.summary ?? "").trim();
        if (!summary) {
          return null;
        }
        const runId = String(snapshot.runId ?? snapshot.generatedAt ?? "").trim();
        return {
          id: `${topic}:${runId || summary.slice(0, 24)}`,
          label: params.translate(`dashboard.widget.${topic}.title`),
          detail: `${formatTopicToken(topic)} · ${summary}`,
          topic,
          runId,
          snapshotAt: String(snapshot.generatedAt ?? "").trim(),
        } satisfies AgentDataSourceItem;
      })
        .filter((item): item is AgentDataSourceItem => item !== null)
        .slice(0, 8),
    [params.topicSnapshots, params.translate],
  );
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null,
    [activeThreadId, threads],
  );
  const updateActiveSetState = (updater: (current: AgentSetState) => AgentSetState) => {
    if (!activeSetId) {
      return;
    }
    setSetStateMap((prev) => {
      const current = prev[activeSetId] ?? createFallbackSetState();
      const nextState = updater(current);
      if (nextState === current) {
        return prev;
      }
      return {
        ...prev,
        [activeSetId]: nextState,
      };
    });
  };
  useEffect(() => {
    if (!activeSetId) {
      return;
    }
    const availableIds = new Set(recentDataSources.map((item) => item.id));
    updateActiveSetState((current) => {
      const nextEnabled = current.enabledDataSourceIds.filter((id) => availableIds.has(id));
      if (nextEnabled.length === 0 && recentDataSources.length > 0) {
        return {
          ...current,
          enabledDataSourceIds: recentDataSources.slice(0, 3).map((item) => item.id),
        };
      }
      if (nextEnabled.length === current.enabledDataSourceIds.length) {
        return current;
      }
      return {
        ...current,
        enabledDataSourceIds: nextEnabled,
      };
    });
  }, [activeSetId, recentDataSources]);
  useEffect(() => {
    if (!modelOptions.some((option) => option.value === selectedModel)) {
      setSelectedModel(modelOptions[0].value);
    }
  }, [modelOptions, selectedModel]);
  useEffect(() => {
    if (isReasonLevelSelectable) {
      return;
    }
    setIsReasonMenuOpen(false);
  }, [isReasonLevelSelectable]);
  useEffect(() => {
    if (!isModelMenuOpen && !isReasonMenuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
      if (!reasonMenuRef.current?.contains(event.target as Node)) {
        setIsReasonMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [isModelMenuOpen, isReasonMenuOpen]);
  const onSelectSet = (setId: string) => {
    setActiveSetId(setId);
    setIsModelMenuOpen(false);
    setIsReasonMenuOpen(false);
  };
  const onBackToSetList = () => {
    setActiveSetId(null);
    setIsModelMenuOpen(false);
    setIsReasonMenuOpen(false);
  };
  const onRestoreTemplateSet = () => {
    if (!activeSetId) {
      return;
    }
    const preset = setPresetById[activeSetId];
    if (!preset) {
      return;
    }
    updateActiveSetState((current) => restoreSetStateFromPreset(current, preset));
    setIsModelMenuOpen(false);
    setIsReasonMenuOpen(false);
  };
  const onAddThread = () => {
    updateActiveSetState((current) => {
      const nextIndex =
        current.threads.reduce((max, thread) => {
          const byName = /^agent-(\d+)$/.exec(thread.name)?.[1];
          const byId = /^agent-(\d+)$/.exec(thread.id)?.[1];
          const parsed = Number(byName ?? byId ?? 0);
          return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
        }, 0) + 1;
      const nextLabel = `agent-${nextIndex}`;
      const nextThread = createCustomThread(nextLabel);
      return {
        ...current,
        threads: [...current.threads, nextThread],
        activeThreadId: nextThread.id,
      };
    });
  };
  const onCloseThread = (threadId: string) => {
    updateActiveSetState((current) => {
      const filtered = current.threads.filter((thread) => thread.id !== threadId);
      const nextThreads = filtered.length > 0 ? filtered : [createCustomThread("agent-1")];
      const nextActive = nextThreads.some((thread) => thread.id === current.activeThreadId)
        ? current.activeThreadId
        : nextThreads[0].id;
      return {
        ...current,
        threads: nextThreads,
        activeThreadId: nextActive,
      };
    });
  };
  const onSetActiveThreadId = (threadId: string) => {
    updateActiveSetState((current) => ({
      ...current,
      activeThreadId: threadId,
    }));
  };
  const onSetDraft = (value: string) => {
    updateActiveSetState((current) => ({
      ...current,
      draft: value,
    }));
  };
  const onQueuePrompt = (prompt: string) => {
    const next = String(prompt ?? "").trim();
    if (!next) {
      return;
    }
    updateActiveSetState((current) => ({
      ...current,
      draft: current.draft.trim().length > 0 ? `${current.draft.trim()}\n${next}` : next,
    }));
  };
  const clearDraftAndAttachments = () => {
    updateActiveSetState((current) => ({
      ...current,
      draft: "",
      attachedFiles: [],
    }));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  const onSend = () => {
    const text = draft.trim();
    if (!text && attachedFiles.length === 0) {
      return;
    }
    updateActiveSetState((current) => ({
      ...current,
      requestHistory: prependAgentRequest(
        current.requestHistory,
        text,
        activeThread?.id ?? (activeDataTopicId ? "data-runner" : "agent"),
        activeThread?.name ?? (activeDataTopicId ? "data-runner" : "agent"),
      ),
    }));
    if (activeDataTopicId) {
      params.onRunDataTopic(activeDataTopicId, text || undefined);
      clearDraftAndAttachments();
      return;
    }
    const selectedDataSources = recentDataSources
      .filter((item) => enabledDataSourceIds.includes(item.id))
      .filter((item) => (activeDataTopicId ? item.topic === activeDataTopicId : true));
    const selectedAttachedFiles = attachedFiles.filter((file) => enabledAttachedFileNames.includes(file.name));
    const resolvedRoleId = activeSetOption ? roleFromSetId(activeSetOption.id) : null;
    const payload = buildAgentDispatchPayload({
      threadName: activeThread?.name,
      threadRoleId: resolvedRoleId ?? undefined,
      threadRole: activeThread?.role,
      threadGuidance: activeThread?.guidance ?? [],
      threadStarterPrompt: activeThread?.starterPrompt,
      selectedModel,
      selectedReasonLevel,
      isReasonLevelSelectable,
      text,
      attachedFileNames: selectedAttachedFiles.map((file) => file.name),
      selectedDataSourceIds: selectedDataSources.map((item) => item.id),
      selectedDataSourceDetails: selectedDataSources.map((item) => item.detail),
      codexMultiAgentMode: params.codexMultiAgentMode,
    });
    params.onQuickAction({
      prompt: payload,
      modelValue: selectedModelOption?.value ?? selectedModel,
      modelLabel: selectedModelOption?.label ?? selectedModel,
      executor: selectedModelOption?.executor ?? "codex",
      turnModel: selectedModelOption?.turnModel,
      selectedDataSourceIds: selectedDataSources.map((item) => item.id),
      selectedDataSourceDetails: selectedDataSources.map((item) => item.detail),
    });
    if (activeSetOption) {
      const nextTaskId = activeThread?.id ?? "TASK-UNKNOWN";
      const missionHandle = resolvedRoleId
        ? params.missionControl.launchMission({
            roleId: resolvedRoleId,
            roleLabel: activeSetOption.label,
            taskId: nextTaskId,
            prompt: text || activeThread?.starterPrompt || activeSetOption.description || nextTaskId,
          })
        : null;
      params.onRunRole?.({
        roleId: resolvedRoleId ?? activeSetOption.id,
        taskId: nextTaskId,
        prompt: text || undefined,
        runId: missionHandle?.implementerRunId,
      });
      requestApproval({
        id: `approval-${Date.now()}`,
        runId: missionHandle?.parentRunId,
        roleId: resolvedRoleId ?? "technical_writer",
        taskId: nextTaskId,
        title: `${activeSetOption.label} 변경 제안`,
        summary: text.slice(0, 120),
        patchPreview: text,
      });
      params.missionControl.recordCompanionEvent("approval_requested", `${activeSetOption.label} 승인 요청`);
    }
    clearDraftAndAttachments();
  };
  const onOpenFilePicker = () => {
    fileInputRef.current?.click();
  };
  const onAttachFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    const nextFiles: AttachedFile[] = Array.from(files).map((file, index) => ({
      id: `${file.name}-${index}-${Date.now()}`,
      name: file.name,
    }));
    updateActiveSetState((current) => {
      const seen = new Set(current.attachedFiles.map((file) => file.name));
      const merged = [...current.attachedFiles];
      nextFiles.forEach((file) => {
        if (!seen.has(file.name)) {
          seen.add(file.name);
          merged.push(file);
        }
      });
      return {
        ...current,
        attachedFiles: merged,
        enabledAttachedFileNames: Array.from(
          new Set([...current.enabledAttachedFileNames, ...nextFiles.map((file) => file.name)]),
        ),
      };
    });
    event.target.value = "";
  };
  const onToggleAttachedFile = (fileName: string) => {
    updateActiveSetState((current) => {
      const exists = current.enabledAttachedFileNames.includes(fileName);
      return {
        ...current,
        enabledAttachedFileNames: exists
          ? current.enabledAttachedFileNames.filter((name) => name !== fileName)
          : [...current.enabledAttachedFileNames, fileName],
      };
    });
  };
  const onToggleDataSource = (sourceId: string) => {
    updateActiveSetState((current) => {
      const exists = current.enabledDataSourceIds.includes(sourceId);
      return {
        ...current,
        enabledDataSourceIds: exists
          ? current.enabledDataSourceIds.filter((id) => id !== sourceId)
          : [...current.enabledDataSourceIds, sourceId],
      };
    });
  };
  return {
    activeDataRunState,
    activeDataSnapshotRunId,
    activeDataTopicId,
    activeSetId,
    activeSetOption,
    activeThread,
    activeThreadId,
    attachedFiles,
    dashboardInsights,
    draft,
    enabledAttachedFileNames,
    enabledDataSourceIds,
    fileInputRef,
    groupedSetOptions,
    isModelMenuOpen,
    isReasonLevelSelectable,
    isReasonMenuOpen,
    modelMenuRef,
    modelOptions,
    onAddThread,
    onAttachFiles,
    onBackToSetList,
    onCloseThread,
    onOpenFilePicker,
    onQueuePrompt,
    onResolveApproval: resolveApproval,
    onRestoreTemplateSet,
    onSelectModel: setSelectedModel,
    onSelectReasonLevel: setSelectedReasonLevel,
    onSelectSet,
    onSend,
    onSetActiveThreadId,
    onSetDraft,
    onToggleAttachedFile,
    onToggleDataSource,
    pendingApprovals,
    reasonLevelOptions,
    reasonMenuRef,
    recentDataSources,
    requestHistory,
    selectedModel,
    selectedModelOptionLabel: selectedModelOption?.label ?? selectedModel,
    selectedReasonLevel,
    sendDisabled: !draft.trim() && attachedFiles.length === 0,
    setIsModelMenuOpen,
    setIsReasonMenuOpen,
    setMission,
    threads,
    setStateMap,
  };
}
