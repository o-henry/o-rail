import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const outDir = path.resolve("tmp/e2e-artifacts");
fs.mkdirSync(outDir, { recursive: true });
const screenshotPath = path.join(outDir, "tasks-tauri-smoke.png");
const processName = process.env.RAIL_MAC_PROCESS_NAME || "rail";

function runAppleScript(lines) {
  return execFileSync("osascript", lines.flatMap((line) => ["-e", line]), {
    encoding: "utf8",
  }).trim();
}

const windowDump = runAppleScript([
  'tell application "System Events"',
  `if not (exists process "${processName}") then error "process-not-found:${processName}"`,
  `tell process "${processName}"`,
  'set frontmost to true',
  'get {name, position, size} of every window',
  'end tell',
  'end tell',
]);

assert.ok(windowDump, "rail 앱 창을 찾지 못했습니다.");

execFileSync("screencapture", ["-x", screenshotPath]);
process.stdout.write(`[tasks-tauri-smoke] windows=${windowDump}\n`);
process.stdout.write(`[tasks-tauri-smoke] screenshot=${screenshotPath}\n`);
