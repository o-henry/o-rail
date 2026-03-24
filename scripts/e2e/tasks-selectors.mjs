export const TASKS_URL = process.env.RAIL_E2E_URL || "http://127.0.0.1:1420/";

export const TASKS_SELECTORS = {
  tasksWorkspace: '[data-e2e="tasks-workspace"]',
  tasksComposerInput: '[data-e2e="tasks-composer-input"]',
  tasksSendButton: '[data-e2e="tasks-send-button"]',
  tasksStopButton: '[data-e2e="tasks-stop-button"]',
  timeline: 'section[aria-label="대화 타임라인"]',
  finalResultRow: ".tasks-thread-message-row.is-assistant.is-terminal-result",
  livePlaceholder: ".tasks-thread-message-row.is-assistant.is-live-placeholder",
  artifactOpenButton: 'button[aria-label^="데이터베이스에서 산출물 열기"]',
  knowledgePage: '[data-e2e="knowledge-page"]',
  knowledgeDetailPanel: '[data-e2e="knowledge-detail-panel"]',
};

export const INTERNAL_DUMP_MARKERS = [
  "Formatting re-enabled",
  "<role_profile>",
  "<operating_rules>",
  "<response_contract>",
  "<task_request>",
  "[ROLE_KB_INJECT]",
];

export const TASKS_PROMPT = "나는 1인 인디 게임 개발자야. 창의적인 게임 아이디어가 필요해. 아이디어는 커뮤니티, 스팀, 메타크리틱 등 게임 관련 리소스들을 조사해서, 재밌는, 인기있는, 사람들이 좋아하는 게임이 무엇인지 학습한 후 나에게 아이디어 10개를 추천해줘. (단, 아류작은 안돼)";

