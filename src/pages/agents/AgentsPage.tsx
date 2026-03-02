import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_TOPIC_IDS, type DashboardTopicId } from "../../features/dashboard/intelligence";
import { useI18n } from "../../i18n";
import { AGENT_MODEL_OPTIONS, AGENT_REASON_LEVEL_OPTIONS } from "./agentOptions";
import { AgentSetIndexView } from "./AgentSetIndexView";
import { AgentsWorkspaceView } from "./AgentsWorkspaceView";
import { buildAgentDispatchPayload } from "./agentPrompt";
import { DEFAULT_RUNTIME_MODEL_VALUE } from "../../features/workflow/runtimeModelOptions";
import { STUDIO_ROLE_TEMPLATES } from "../../features/studio/roleTemplates";
import { useCodeChangeApproval } from "../../app/hooks/useCodeChangeApproval";
import {
  buildGroupedSetOptions,
  buildPresetSnapshot,
  createCustomThread,
  createFallbackSetState,
  createInitialSetStateMap,
  restoreSetStateFromPreset,
  createStateFromPresetSnapshot,
} from "./agentSetState";
import type {
  AgentDataSourceItem,
  AgentSetPresetSnapshot,
  AgentSetState,
  AgentsPageProps,
  AttachedFile,
} from "./agentTypes";

function topicFromSetId(setId: string | null): DashboardTopicId | null {
  if (!setId || !setId.startsWith("data-")) {
    return null;
  }
  const candidate = setId.slice(5);
  return DASHBOARD_TOPIC_IDS.includes(candidate as DashboardTopicId) ? (candidate as DashboardTopicId) : null;
}

function formatTopicToken(topic: string): string {
  return String(topic ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toUpperCase();
}

export default function AgentsPage({
  onQuickAction,
  onRunRole,
  topicSnapshots,
  codexMultiAgentMode,
  runStateByTopic,
  onRunDataTopic,
  launchRequest,
  onOpenDataTab,
}: AgentsPageProps) {
  const { t } = useI18n();
  const setOptions = useMemo(
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

  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [setStateMap, setSetStateMap] = useState<Record<string, AgentSetState>>(() =>
    createInitialSetStateMap(setOptions, setPresetById),
  );
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isReasonMenuOpen, setIsReasonMenuOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_RUNTIME_MODEL_VALUE);
  const [selectedReasonLevel, setSelectedReasonLevel] = useState("보통");
  const { pendingApprovals, requestApproval, resolveApproval } = useCodeChangeApproval();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const reasonMenuRef = useRef<HTMLDivElement | null>(null);

  const modelOptions = useMemo(() => AGENT_MODEL_OPTIONS, []);
  const reasonLevelOptions = useMemo(() => AGENT_REASON_LEVEL_OPTIONS, []);
  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === selectedModel) ?? modelOptions[0],
    [modelOptions, selectedModel],
  );
  const isReasonLevelSelectable = selectedModelOption?.allowsReasonLevel !== false;

  const groupedSetOptions = useMemo(() => buildGroupedSetOptions(setOptions), [setOptions]);

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
    if (!launchRequest) {
      return;
    }
    const nextSetId = String(launchRequest.setId ?? "").trim();
    if (!nextSetId || !setOptions.some((option) => option.id === nextSetId)) {
      return;
    }
    setActiveSetId(nextSetId);
    const nextDraft = String(launchRequest.draft ?? "").trim();
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
  }, [launchRequest, setOptions]);
  const currentSetState = useMemo(() => {
    if (!activeSetId) {
      return null;
    }
    return setStateMap[activeSetId] ?? createFallbackSetState();
  }, [activeSetId, setStateMap]);
  const activeSetOption = useMemo(
    () => (activeSetId ? setOptions.find((option) => option.id === activeSetId) ?? null : null),
    [activeSetId, setOptions],
  );
  const activeDataTopicId = useMemo(() => topicFromSetId(activeSetOption?.id ?? null), [activeSetOption?.id]);
  const activeDataRunState = activeDataTopicId ? runStateByTopic[activeDataTopicId] : undefined;
  const activeDataSnapshotRunId = useMemo(
    () => (activeDataTopicId ? String(topicSnapshots[activeDataTopicId]?.runId ?? "").trim() || null : null),
    [activeDataTopicId, topicSnapshots],
  );
  const threads = currentSetState?.threads ?? [];
  const activeThreadId = currentSetState?.activeThreadId ?? "";
  const draft = currentSetState?.draft ?? "";
  const attachedFiles = currentSetState?.attachedFiles ?? [];
  const setMission = currentSetState?.setMission ?? "";
  const dashboardInsights = currentSetState?.dashboardInsights ?? [];
  const enabledAttachedFileNames = currentSetState?.enabledAttachedFileNames ?? [];
  const enabledDataSourceIds = currentSetState?.enabledDataSourceIds ?? [];
  const recentDataSources = useMemo<AgentDataSourceItem[]>(
    () =>
      DASHBOARD_TOPIC_IDS.map((topic) => {
        const snapshot = topicSnapshots[topic];
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
          label: t(`dashboard.widget.${topic}.title`),
          detail: `${formatTopicToken(topic)} · ${summary}`,
          topic,
          runId,
          snapshotAt: String(snapshot.generatedAt ?? "").trim(),
        } satisfies AgentDataSourceItem;
      })
        .filter((item): item is AgentDataSourceItem => item !== null)
        .slice(0, 8),
    [t, topicSnapshots],
  );

  const activeThread = useMemo(() => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null, [activeThreadId, threads]);
  const updateActiveSetState = (updater: (current: AgentSetState) => AgentSetState) => {
    if (!activeSetId) {
      return;
    }
    setSetStateMap((prev) => {
      const current = prev[activeSetId] ?? createFallbackSetState();
      return {
        ...prev,
        [activeSetId]: updater(current),
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

  const onSend = () => {
    const text = draft.trim();
    if (!text && attachedFiles.length === 0) {
      return;
    }
    if (activeDataTopicId) {
      onRunDataTopic(activeDataTopicId, text || undefined);
      updateActiveSetState((current) => ({
        ...current,
        draft: "",
        attachedFiles: [],
      }));
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    const selectedDataSources = recentDataSources
      .filter((item) => enabledDataSourceIds.includes(item.id))
      .filter((item) => (activeDataTopicId ? item.topic === activeDataTopicId : true));
    const selectedAttachedFiles = attachedFiles.filter((file) => enabledAttachedFileNames.includes(file.name));
    const payload = buildAgentDispatchPayload({
      threadName: activeThread?.name,
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
      codexMultiAgentMode,
    });
    onQuickAction({
      prompt: payload,
      modelValue: selectedModelOption?.value ?? selectedModel,
      modelLabel: selectedModelOption?.label ?? selectedModel,
      executor: selectedModelOption?.executor ?? "codex",
      turnModel: selectedModelOption?.turnModel,
      selectedDataSourceIds: selectedDataSources.map((item) => item.id),
      selectedDataSourceDetails: selectedDataSources.map((item) => item.detail),
    });
    if (activeSetOption) {
      onRunRole?.({
        roleId: activeSetOption.id,
        taskId: activeThread?.id ?? "TASK-UNKNOWN",
        prompt: text || undefined,
      });
      requestApproval({
        id: `approval-${Date.now()}`,
        runId: undefined,
        roleId: "technical_writer",
        taskId: activeThread?.id ?? "TASK-UNKNOWN",
        title: `${activeSetOption.label} 변경 제안`,
        summary: text.slice(0, 120),
        patchPreview: text,
      });
    }
    updateActiveSetState((current) => ({
      ...current,
      draft: "",
      attachedFiles: [],
    }));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

  if (!activeSetId) {
    return (
      <AgentSetIndexView
        groupedSetOptions={groupedSetOptions}
        onSelectSet={onSelectSet}
        setStateMap={setStateMap}
      />
    );
  }

  return (
    <AgentsWorkspaceView
      activeSetOption={activeSetOption}
      activeThread={activeThread}
      activeThreadId={activeThreadId}
      attachedFiles={attachedFiles}
      codexMultiAgentMode={codexMultiAgentMode}
      dashboardInsights={dashboardInsights}
      recentDataSources={recentDataSources}
      enabledAttachedFileNames={enabledAttachedFileNames}
      enabledDataSourceIds={enabledDataSourceIds}
      draft={draft}
      fileInputRef={fileInputRef}
      isModelMenuOpen={isModelMenuOpen}
      isReasonLevelSelectable={isReasonLevelSelectable}
      isReasonMenuOpen={isReasonMenuOpen}
      modelMenuRef={modelMenuRef}
      modelOptions={modelOptions}
      onAddThread={onAddThread}
      onAttachFiles={onAttachFiles}
      onBackToSetList={onBackToSetList}
      onCloseThread={onCloseThread}
      onOpenDataTab={onOpenDataTab}
      pendingApprovals={pendingApprovals}
      onOpenFilePicker={onOpenFilePicker}
      onQueuePrompt={onQueuePrompt}
      onToggleAttachedFile={onToggleAttachedFile}
      onToggleDataSource={onToggleDataSource}
      onRestoreTemplateSet={onRestoreTemplateSet}
      onSelectModel={setSelectedModel}
      onSelectReasonLevel={setSelectedReasonLevel}
      onSend={onSend}
      onSetActiveThreadId={onSetActiveThreadId}
      onSetDraft={onSetDraft}
      reasonLevelOptions={reasonLevelOptions}
      reasonMenuRef={reasonMenuRef}
      selectedModel={selectedModel}
      selectedModelOptionLabel={selectedModelOption?.label ?? selectedModel}
      selectedReasonLevel={selectedReasonLevel}
      sendDisabled={!draft.trim() && attachedFiles.length === 0}
      setIsModelMenuOpen={setIsModelMenuOpen}
      setIsReasonMenuOpen={setIsReasonMenuOpen}
      setMission={setMission}
      onResolveApproval={(id, decision) => resolveApproval(id, decision)}
      dataTopicId={activeDataTopicId}
      dataTopicRunState={activeDataRunState ?? null}
      dataTopicRunId={activeDataRunState?.runId ?? activeDataSnapshotRunId}
      t={(key) => t(key)}
      threads={threads}
    />
  );
}
