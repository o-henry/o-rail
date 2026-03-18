#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");

const LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"];
const LAYER_RANK = {
  shared: 0,
  entities: 1,
  features: 2,
  widgets: 3,
  pages: 4,
  app: 5,
};

const FILE_SOFT_LIMIT = 300;
const FILE_HARD_LIMIT = 500;
const MAIN_FILE_LIMIT = 80;

const TEMP_LINE_ALLOWLIST = new Map([
  [
    "src/app/MainApp.tsx",
    {
      maxLines: 3100,
      expiresOn: "2026-09-30",
      reason:
        "Main app controller split in progress (agentic orchestration/dashboard wiring/VIA runtime wiring extraction pending)",
    },
  ],
  [
    "src/i18n/messages/en.ts",
    {
      maxLines: 540,
      expiresOn: "2026-07-31",
      reason: "Message dictionary modularization pending (dashboard intelligence keys added)",
    },
  ],
  [
    "src/i18n/messages/ko.ts",
    {
      maxLines: 540,
      expiresOn: "2026-07-31",
      reason: "Message dictionary modularization pending (dashboard intelligence keys added)",
    },
  ],
  [
    "src/i18n/messages/ja.ts",
    {
      maxLines: 540,
      expiresOn: "2026-07-31",
      reason: "Message dictionary modularization pending (dashboard intelligence keys added)",
    },
  ],
  [
    "src/i18n/messages/zh.ts",
    {
      maxLines: 540,
      expiresOn: "2026-07-31",
      reason: "Message dictionary modularization pending (dashboard intelligence keys added)",
    },
  ],
  [
    "src/pages/feed/FeedPage.tsx",
    {
      maxLines: 980,
      expiresOn: "2026-05-31",
      reason: "Feed page decomposition in progress",
    },
  ],
  [
    "src/app/main/runtime/dashboardIntelligenceRunner.ts",
    {
      maxLines: 900,
      expiresOn: "2026-05-31",
      reason: "Dashboard intelligence runtime split pending (crawler/prompt/quality gate modules)",
    },
  ],
  [
    "src/app/main/runtime/dashboardIntelligenceRunner.test.ts",
    {
      maxLines: 820,
      expiresOn: "2026-05-31",
      reason: "Dashboard intelligence test suite split pending",
    },
  ],
  [
    "src/app/hooks/useAgenticOrchestrationBridge.ts",
    {
      maxLines: 940,
      expiresOn: "2026-05-31",
      reason: "Agentic orchestration bridge split pending (Tasks collaboration/runtime dispatch extraction)",
    },
  ],
  [
    "src/pages/tasks/TasksPage.tsx",
    {
      maxLines: 1100,
      expiresOn: "2026-05-31",
      reason: "Unity Tasks shell decomposition pending (detail dock, mention UI, and shell extraction)",
    },
  ],
  [
    "src/pages/tasks/useTasksThreadState.ts",
    {
      maxLines: 1850,
      expiresOn: "2026-05-31",
      reason: "Unity Tasks thread state split pending (browser store/actions and collaboration dispatch extraction)",
    },
  ],
]);

const LEGACY_IMPORT_EXCEPTIONS = new Set([
  "src/features/feed/derivedState.ts -> ../workflow/domain",
  "src/features/feed/derivedState.ts -> ../workflow/labels",
  "src/features/feed/derivedState.ts -> ../workflow/quality",
  "src/pages/shell/ShellPage.tsx -> ../tasks/TaskTerminalViewport",
  "src/pages/shell/ShellPage.tsx -> ../tasks/useTasksThreadState",
  "src/pages/shell/shellTerminalGridState.ts -> ../tasks/taskTerminalTypes",
  "src/pages/shell/useShellTerminalGrid.ts -> ../tasks/taskThreadTerminalState",
  "src/pages/shell/useShellTerminalGrid.ts -> ../tasks/taskTerminalTypes",
  "src/pages/shell/useShellTerminalGrid.ts -> ../tasks/taskTerminalBufferStore",
  "src/pages/shell/useShellTerminalGrid.ts -> ../tasks/threadTypes",
]);

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function parseLayerInfo(fileRel) {
  const parts = fileRel.split("/");
  if (parts[0] !== "src") return null;
  const layer = parts[1];
  if (!LAYERS.includes(layer)) return null;
  const slice = parts[2] ?? null;
  return { layer, slice, parts };
}

function parseMainPartition(fileRel) {
  const parts = fileRel.split("/");
  if (parts[0] !== "src" || parts[1] !== "app" || parts[2] !== "main") {
    return null;
  }
  const partition = parts[3] ?? "root";
  if (!["root", "runtime", "canvas", "presentation"].includes(partition)) {
    return "root";
  }
  return partition;
}

function resolveImport(fileRel, spec) {
  if (spec.startsWith("@/")) {
    return `src/${spec.slice(2)}`;
  }
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const base = path.dirname(fileRel);
    return path.normalize(path.join(base, spec)).replace(/\\/g, "/");
  }
  return null;
}

function extractImports(content) {
  const matches = content.matchAll(/from\s+["']([^"']+)["']/g);
  return Array.from(matches, (m) => m[1]);
}

function isAllowlistExpired(expiresOn) {
  const expiry = new Date(`${expiresOn}T23:59:59.999Z`);
  return Number.isNaN(expiry.getTime()) ? true : Date.now() > expiry.getTime();
}

const errors = [];
const warnings = [];

const files = walk(SRC_DIR);

for (const file of files) {
  const fileRel = rel(file);
  const content = fs.readFileSync(file, "utf8");
  const lineCount = content.split("\n").length;

  if (fileRel === "src/main.tsx") {
    if (lineCount > MAIN_FILE_LIMIT) {
      errors.push(`${fileRel}: line count ${lineCount} > ${MAIN_FILE_LIMIT}`);
    }
    const disallowed = /(invoke\(|listen\(|function\s+|useState\(|useEffect\(|const\s+[A-Z][A-Za-z0-9_]*\s*=\s*\()/;
    if (disallowed.test(content)) {
      errors.push(`${fileRel}: must remain entrypoint-only (render/bootstrap only)`);
    }
  }

  const allow = TEMP_LINE_ALLOWLIST.get(fileRel);
  if (allow && isAllowlistExpired(allow.expiresOn)) {
    errors.push(
      `${fileRel}: temporary line allowlist expired on ${allow.expiresOn} (${allow.reason})`,
    );
  }

  if (lineCount > FILE_HARD_LIMIT) {
    if (!allow) {
      errors.push(`${fileRel}: line count ${lineCount} > hard limit ${FILE_HARD_LIMIT}`);
    } else if (lineCount > allow.maxLines) {
      errors.push(
        `${fileRel}: line count ${lineCount} > allowlist max ${allow.maxLines} (expires ${allow.expiresOn})`,
      );
    } else {
      warnings.push(
        `${fileRel}: temporary allowlist active (${lineCount} lines, max ${allow.maxLines}, expires ${allow.expiresOn})`,
      );
    }
  } else if (lineCount > FILE_SOFT_LIMIT) {
    warnings.push(`${fileRel}: line count ${lineCount} > soft limit ${FILE_SOFT_LIMIT}`);
  }

  const importer = parseLayerInfo(fileRel);
  if (!importer) continue;

  const imports = extractImports(content);
  for (const spec of imports) {
    const resolved = resolveImport(fileRel, spec);
    if (!resolved || !resolved.startsWith("src/")) continue;

    const target = parseLayerInfo(resolved);
    if (!target) continue;

    const importerRank = LAYER_RANK[importer.layer];
    const targetRank = LAYER_RANK[target.layer];
    const importKey = `${fileRel} -> ${spec}`;
    if (targetRank > importerRank && !LEGACY_IMPORT_EXCEPTIONS.has(importKey)) {
      errors.push(`${fileRel}: invalid layer dependency ${importer.layer} -> ${target.layer} (${spec})`);
    }

    const restrictedSameLayer = new Set(["pages", "widgets", "features", "entities"]);
    if (
      importer.layer === target.layer &&
      restrictedSameLayer.has(importer.layer) &&
      importer.slice &&
      target.slice &&
      importer.slice !== target.slice &&
      !LEGACY_IMPORT_EXCEPTIONS.has(importKey)
    ) {
      errors.push(`${fileRel}: cross-slice import within ${importer.layer} is not allowed (${spec})`);
    }

    if (spec.startsWith("@/") && target.slice) {
      const specParts = spec.slice(2).split("/");
      if (specParts.length > 2 && specParts[2] !== "index.ts" && specParts[2] !== "index.tsx") {
        errors.push(`${fileRel}: deep import blocked by public API rule (${spec})`);
      }
    }

    const importerPartition = parseMainPartition(fileRel);
    const targetPartition = parseMainPartition(resolved);
    if (importerPartition && targetPartition) {
      if (importerPartition === "runtime" && targetPartition === "presentation") {
        errors.push(`${fileRel}: app/main/runtime must not depend on presentation (${spec})`);
      }
    }

    if (importer.layer === "features" && importer.slice === "orchestration" && target.layer === "app") {
      errors.push(`${fileRel}: features/orchestration must not depend on app layer (${spec})`);
    }
  }
}

if (warnings.length > 0) {
  console.warn("Architecture warnings:\n");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
  console.warn("");
}

if (errors.length > 0) {
  console.error("Architecture check failed:\n");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log("Architecture check passed.");
