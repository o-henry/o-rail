#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const MAX_IMPORTANT_COUNT = 20;

function walkCss(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCss(full, out);
      continue;
    }
    if (entry.isFile() && full.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

const files = walkCss(SRC_DIR);
let total = 0;
const details = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('!important')) {
      total += 1;
      details.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}`);
    }
  }
}

if (total > MAX_IMPORTANT_COUNT) {
  console.error(`CSS check failed: !important count ${total} > ${MAX_IMPORTANT_COUNT}`);
  if (details.length > 0) {
    console.error(details.join('\n'));
  }
  process.exit(1);
}

console.log(`CSS check passed: !important count ${total} <= ${MAX_IMPORTANT_COUNT}`);
