import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import {
  INTERNAL_DUMP_MARKERS,
  TASKS_PROMPT,
  TASKS_SELECTORS,
  TASKS_URL,
} from "./tasks-selectors.mjs";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outDir = path.resolve("tmp/e2e-artifacts");
fs.mkdirSync(outDir, { recursive: true });

function log(message) {
  process.stdout.write(`[tasks-e2e] ${message}\n`);
}

async function gotoWithRetry(page, url, attempts = 20) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }
  throw lastError ?? new Error(`failed to open ${url}`);
}

async function clickFirstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click();
      return true;
    }
  }
  return false;
}

async function openTasksTab(page) {
  const candidates = [
    page.getByRole("button", { name: /tasks|태스크/i }),
    page.getByTitle(/tasks|태스크/i),
  ];
  for (const candidate of candidates) {
    if (await clickFirstVisible(candidate)) {
      return;
    }
  }
  throw new Error("Tasks 탭 버튼을 찾지 못했습니다.");
}

async function openKnowledgeTab(page) {
  const candidates = [
    page.getByRole("button", { name: /database|데이터베이스|knowledge/i }),
    page.getByTitle(/database|데이터베이스|knowledge/i),
  ];
  for (const candidate of candidates) {
    if (await clickFirstVisible(candidate)) {
      return;
    }
  }
  throw new Error("데이터베이스 탭 버튼을 찾지 못했습니다.");
}

async function createNewThread(page) {
  const button = page.getByRole("button", { name: /새 스레드|new thread/i });
  await button.first().click();
}

async function waitForRunStart(page) {
  await page.waitForFunction((selectors) => {
    return Boolean(
      document.querySelector(selectors.tasksStopButton)
      || document.querySelector(selectors.livePlaceholder),
    );
  }, TASKS_SELECTORS, { timeout: 15000 });
}

async function waitForFinalResult(page) {
  await page.waitForFunction((selectors) => {
    return Boolean(document.querySelector(selectors.finalResultRow));
  }, TASKS_SELECTORS, { timeout: 120000 });
  await page.waitForFunction((selectors) => {
    return !document.querySelector(selectors.tasksStopButton);
  }, TASKS_SELECTORS, { timeout: 30000 });
}

async function assertAppResponsive(page) {
  await openKnowledgeTab(page);
  await page.waitForSelector(TASKS_SELECTORS.knowledgePage, { timeout: 10000 });
  await openTasksTab(page);
  await page.waitForSelector(TASKS_SELECTORS.tasksWorkspace, { timeout: 10000 });
}

async function assertFinalAnswerLooksClean(page) {
  const finalText = await page.locator(TASKS_SELECTORS.finalResultRow).last().innerText();
  assert.ok(finalText.trim().length > 0, "최종 답변이 비어 있습니다.");
  for (const marker of INTERNAL_DUMP_MARKERS) {
    assert.ok(!finalText.includes(marker), `최종 답변에 내부 덤프 마커가 노출되었습니다: ${marker}`);
  }
}

async function dumpBrowserTasksState(page) {
  return page.evaluate(() => {
    const rawStore = window.sessionStorage.getItem("rail.tasks.browser-state.v4");
    const activeThreadRaw = window.sessionStorage.getItem("rail.tasks.active-thread.v1");
    const store = rawStore ? JSON.parse(rawStore) : null;
    const activeThread = activeThreadRaw ? JSON.parse(activeThreadRaw) : null;
    const activeThreadId = String(activeThread?.threadId ?? "");
    const detail = activeThreadId && store?.details ? store.details[activeThreadId] : null;
    return {
      activeThreadId,
      messageCount: Array.isArray(detail?.messages) ? detail.messages.length : null,
      lastMessage: Array.isArray(detail?.messages) && detail.messages.length > 0 ? detail.messages.at(-1) : null,
      renderedTerminalCount: document.querySelectorAll(".tasks-thread-message-row.is-terminal-result").length,
      renderedConversationTextLength: String(document.querySelector(".tasks-thread-timeline")?.textContent ?? "").trim().length,
    };
  });
}

async function maybeOpenArtifact(page) {
  const artifactButton = page.locator(TASKS_SELECTORS.artifactOpenButton);
  if (await artifactButton.count() === 0) {
    return false;
  }
  await artifactButton.first().click();
  await page.waitForSelector(TASKS_SELECTORS.knowledgePage, { timeout: 10000 });
  await page.waitForSelector(TASKS_SELECTORS.knowledgeDetailPanel, { timeout: 10000 });
  return true;
}

const browser = await chromium.launch({
  executablePath,
  headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 980 },
});
const page = await context.newPage();

try {
  log(`open ${TASKS_URL}`);
  await gotoWithRetry(page, TASKS_URL);
  await openTasksTab(page);
  await page.waitForSelector(TASKS_SELECTORS.tasksWorkspace, { timeout: 10000 });

  log("create new thread");
  await createNewThread(page);
  await page.waitForSelector(TASKS_SELECTORS.tasksComposerInput, { timeout: 10000 });

  log("submit prompt");
  await page.locator(TASKS_SELECTORS.tasksComposerInput).fill(TASKS_PROMPT);
  await page.locator(TASKS_SELECTORS.tasksSendButton).click();

  log("wait for run start");
  await waitForRunStart(page);

  log("check tab switching responsiveness while run is active");
  await assertAppResponsive(page);

  log("wait for final result");
  await waitForFinalResult(page);
  await assertFinalAnswerLooksClean(page);

  log("open artifact in knowledge if available");
  await maybeOpenArtifact(page);

  const screenshotPath = path.join(outDir, "tasks-regression-success.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  log(`success screenshot saved: ${screenshotPath}`);
} catch (error) {
  const screenshotPath = path.join(outDir, "tasks-regression-failure.png");
  const stateDumpPath = path.join(outDir, "tasks-regression-state.json");
  const stateDump = await dumpBrowserTasksState(page).catch((dumpError) => ({ error: String(dumpError) }));
  fs.writeFileSync(stateDumpPath, JSON.stringify(stateDump, null, 2));
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  log(`failure screenshot saved: ${screenshotPath}`);
  log(`failure state dump saved: ${stateDumpPath}`);
  throw error;
} finally {
  await context.close();
  await browser.close();
}
