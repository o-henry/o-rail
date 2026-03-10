import type { ApprovalDecision } from "./types";

export type SelectOption = { value: string; label: string };

export const APPROVAL_DECISIONS: ApprovalDecision[] = ["accept", "acceptForSession", "decline", "cancel"];
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 136;
export const DEFAULT_STAGE_WIDTH = 1400;
export const DEFAULT_STAGE_HEIGHT = 900;
export const STAGE_GROW_MARGIN = 120;
export const STAGE_GROW_LIMIT = 720;
export const MAX_STAGE_WIDTH = 4200;
export const MAX_STAGE_HEIGHT = 3200;
export const GRAPH_STAGE_INSET_X = 90;
export const GRAPH_STAGE_INSET_Y = 220;
export const GRAPH_STAGE_INSET_BOTTOM = 120;
export const MIN_CANVAS_ZOOM = 0.6;
export const MAX_CANVAS_ZOOM = 1.8;
export const QUESTION_INPUT_MAX_HEIGHT = 132;
export const NODE_DRAG_MARGIN = 60;
export const AUTO_LAYOUT_SNAP_THRESHOLD = 44;
export const AUTO_LAYOUT_DRAG_SNAP_THRESHOLD = 36;
export const AUTO_LAYOUT_NODE_AXIS_SNAP_THRESHOLD = 38;
export const AGENT_RULE_CACHE_TTL_MS = 12_000;
export const AGENT_RULE_MAX_DOCS = 16;
export const AGENT_RULE_MAX_DOC_CHARS = 6_000;
export const AUTH_LOGIN_REQUIRED_CONFIRM_COUNT = 3;
export const AUTH_LOGIN_REQUIRED_GRACE_MS = 120_000;
export const CODEX_LOGIN_COOLDOWN_MS = 45_000;
export const WEB_BRIDGE_CLAIM_WARN_MS = 8_000;
export const WEB_BRIDGE_PROMPT_FILLED_WARN_MS = 8_000;
export const WEB_TURN_FLOATING_DEFAULT_X = 24;
export const WEB_TURN_FLOATING_DEFAULT_Y = 92;
export const WEB_TURN_FLOATING_MARGIN = 12;
export const WEB_TURN_FLOATING_MIN_VISIBLE_WIDTH = 120;
export const WEB_TURN_FLOATING_MIN_VISIBLE_HEIGHT = 72;
export const TURN_OUTPUT_SCHEMA_ENABLED = true;
export const TURN_OUTPUT_SCHEMA_MAX_RETRY = 1;
export const FORCE_AGENT_RULES_ALL_TURNS = false;
export const SIMPLE_WORKFLOW_UI = true;

export const KNOWLEDGE_TOP_K_OPTIONS: SelectOption[] = [
  { value: "0", label: "0개" },
  { value: "1", label: "1개" },
  { value: "2", label: "2개" },
  { value: "3", label: "3개" },
  { value: "4", label: "4개" },
  { value: "5", label: "5개" },
];

export const KNOWLEDGE_MAX_CHARS_OPTIONS: SelectOption[] = [
  { value: "1600", label: "짧게 (빠름)" },
  { value: "2800", label: "보통 (균형)" },
  { value: "4000", label: "길게 (정밀)" },
  { value: "5600", label: "아주 길게 (최대)" },
];
