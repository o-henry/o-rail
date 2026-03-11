import { useRef, useState } from "react";
import { t } from "../../i18n";
import type {
  AuthMode,
  CodexMultiAgentMode,
  NodeRunState,
  PendingApproval,
  RunRecord,
} from "../main";
import type { TurnTerminal } from "../mainAppGraphHelpers";

export function useExecutionState(options: {
  defaultAuthMode: AuthMode;
  defaultCodexMultiAgentMode: CodexMultiAgentMode;
  defaultLoginCompleted: boolean;
}) {
  const { defaultAuthMode, defaultCodexMultiAgentMode, defaultLoginCompleted } = options;

  const [engineStarted, setEngineStarted] = useState(false);
  const [status, setStatus] = useState(() => t("settings.engine.waiting"));
  const [running, setRunning] = useState(false);
  const [error, setErrorState] = useState("");
  const [, setErrorLogs] = useState<string[]>([]);

  const [usageInfoText, setUsageInfoText] = useState("");
  const [usageResultClosed, setUsageResultClosed] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(defaultAuthMode);
  const [codexMultiAgentMode, setCodexMultiAgentMode] =
    useState<CodexMultiAgentMode>(defaultCodexMultiAgentMode);
  const [loginCompleted, setLoginCompleted] = useState(defaultLoginCompleted);
  const [codexAuthBusy, setCodexAuthBusy] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);

  const [nodeStates, setNodeStates] = useState<Record<string, NodeRunState>>({});
  const [isGraphRunning, setIsGraphRunning] = useState(false);
  const [isGraphPaused, setIsGraphPaused] = useState(false);
  const [isRunStarting, setIsRunStarting] = useState(false);
  const [runtimeNowMs, setRuntimeNowMs] = useState(() => Date.now());

  const cancelRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const activeTurnNodeIdRef = useRef<string>("");
  const activeTurnThreadByNodeIdRef = useRef<Record<string, string>>({});
  const turnTerminalResolverRef = useRef<((terminal: TurnTerminal) => void) | null>(null);
  const activeRunDeltaRef = useRef<Record<string, string>>({});
  const collectingRunRef = useRef(false);
  const runLogCollectorRef = useRef<Record<string, string[]>>({});
  const feedRunCacheRef = useRef<Record<string, RunRecord>>({});
  const runStartGuardRef = useRef(false);

  const authLoginRequiredProbeCountRef = useRef(0);
  const lastAuthenticatedAtRef = useRef<number>(defaultLoginCompleted ? Date.now() : 0);
  const codexLoginLastAttemptAtRef = useRef(0);

  return {
    engineStarted,
    setEngineStarted,
    status,
    setStatus,
    running,
    setRunning,
    error,
    setErrorState,
    setErrorLogs,
    usageInfoText,
    setUsageInfoText,
    usageResultClosed,
    setUsageResultClosed,
    authMode,
    setAuthMode,
    codexMultiAgentMode,
    setCodexMultiAgentMode,
    loginCompleted,
    setLoginCompleted,
    codexAuthBusy,
    setCodexAuthBusy,
    pendingApprovals,
    setPendingApprovals,
    approvalSubmitting,
    setApprovalSubmitting,
    nodeStates,
    setNodeStates,
    isGraphRunning,
    setIsGraphRunning,
    isGraphPaused,
    setIsGraphPaused,
    isRunStarting,
    setIsRunStarting,
    runtimeNowMs,
    setRuntimeNowMs,
    cancelRequestedRef,
    pauseRequestedRef,
    activeTurnNodeIdRef,
    activeTurnThreadByNodeIdRef,
    turnTerminalResolverRef,
    activeRunDeltaRef,
    collectingRunRef,
    runLogCollectorRef,
    feedRunCacheRef,
    runStartGuardRef,
    authLoginRequiredProbeCountRef,
    lastAuthenticatedAtRef,
    codexLoginLastAttemptAtRef,
  };
}
