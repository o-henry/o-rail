# RAIL

> Local-first Multi-Agent Workflow Desktop for Codex + Web AI (Tauri + React + TypeScript)

RAIL is a desktop app that connects multiple agents (Codex / Web AI / local models) with a node graph (DAG), then executes end-to-end workflows from intake to analysis, validation, and final synthesis.

- Local-first runtime (Tauri)
- Reproducible run logs (`run-*.json`)
- Web AI integration without API keys via browser extension (Web Connect)

---

## Table of Contents

- [What It Solves](#what-it-solves)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Install (macOS)](#install-macos)
- [Usage Guide](#usage-guide)
- [Web Connect Setup](#web-connect-setup)
- [Data & Persistence](#data--persistence)
- [Security Model](#security-model)
- [Legal Notice](#legal-notice)
- [Architecture Rules (Guardrails)](#architecture-rules-guardrails)
- [Troubleshooting](#troubleshooting)
- [Development Scripts](#development-scripts)
- [Roadmap](#roadmap)

---

## What It Solves

Single-agent chat is fast, but often fails on reliability in long or complex workflows:

- weak evidence / hallucinations
- context pollution across long sessions
- low reproducibility and auditability
- missing role specialization (research / implementation / review / synthesis)

RAIL addresses this with **role-based agent nodes + run logs + quality gates**.

---

## Key Features

### 1) Workflow Canvas (Node Graph)
- `Turn / Transform / Gate` node types
- node linking, drag, selection, auto-alignment
- run / stop / undo / redo
- edge and runtime status visualization

### 2) Multi-Agent Execution
- Codex-powered agents
- semi-automated web agents (`web/gpt`, `web/gemini`, `web/claude`, `web/perplexity`, `web/grok`)
- local model support via Ollama
- automatic upstream-to-downstream input propagation on DAG

### 3) Feed (Result / Document View)
- card-based run outputs
- summary, full content, input snapshot, input sources
- follow-up requests to a specific agent card
- share (copy text / JSON), delete
- grouped runs by template/custom execution

### 4) Run Records (Reproducible Logs)
- stored in `src-tauri/runs/run-*.json`
- includes transitions, provider trace, quality summary
- supports post-run review and debugging

### 5) Settings / Engine
- engine start/stop
- Codex login/logout
- usage check
- CWD management

### 6) Web Connect (Browser Extension Bridge)
- local loopback only (`127.0.0.1`) + token auth
- prompt auto-injection + auto-send attempt
- one-click manual fallback when auto-send fails
- response capture and automatic handoff to next node

---

## How It Works

1. User enters a question in Workflow
2. Start node (or full DAG) runs
3. Each node processes its input
   - Turn: LLM execution
   - Transform: data shaping
   - Gate: conditional branching
4. Node outputs are passed downstream
5. Final output is saved to Feed and run record
6. Follow-up can be sent from Feed to re-run targeted nodes

---

## Project Structure

```txt
rail/
├─ src/
│  ├─ app/                # app root composition
│  ├─ pages/              # route-level pages
│  ├─ components/         # reusable UI
│  ├─ features/           # feature-level logic
│  ├─ shared/
│  │  ├─ tauri/           # IPC wrappers (invoke/listen)
│  │  └─ lib/             # shared utilities
│  └─ i18n/
├─ src-tauri/             # Rust backend + run persistence
├─ extension/rail-bridge/ # Chrome MV3 extension (Web Connect)
├─ scripts/               # helper/check scripts
├─ docs/
└─ public/
```

---

## Tech Stack

- Desktop: **Tauri v2**
- Frontend: **React 19 + TypeScript + Vite**
- Bridge: **Playwright Core + Chrome Extension (MV3)**
- Data format: JSON (graph / runs)

---

## Requirements

- Node.js 18+
- npm 9+
- Rust stable toolchain (for Tauri builds)
- macOS / Linux / Windows supported by Tauri

---

## Quick Start

```bash
npm install
npm run dev
```

Run as desktop app:

```bash
npm run tauri dev
```

Production build:

```bash
npm run build
```

Architecture + build checks:

```bash
npm run check
```

---

## Install (macOS)

RAIL is distributed as a desktop app (not a hosted web service).

### 1) Development run

```bash
npm install
npm run tauri dev
```

### 2) Build app bundle

```bash
npm run tauri build -- --bundles app
```

Generated output:

- `src-tauri/target/release/bundle/macos/rail.app`

### 3) Install / run locally

1. Copy `rail.app` into `Applications`
2. On first launch, use right-click → `Open` if macOS blocks execution

Run directly from terminal:

```bash
open src-tauri/target/release/bundle/macos/rail.app
```

If blocked due to quarantine:

```bash
xattr -dr com.apple.quarantine src-tauri/target/release/bundle/macos/rail.app
open src-tauri/target/release/bundle/macos/rail.app
```

---

## Usage Guide

### A) Basic flow

1. In `Workflow`, select a template or build nodes manually
2. Enter question
3. Click run
4. Review outputs in `Feed`

### B) Follow-up in Feed

1. Expand a card
2. Enter follow-up request
3. Send request
4. Result is appended in same run context

### C) Graph save/load

- Save: persist current graph
- Rename: rename saved graph file
- Delete: remove saved graph file
- Refresh: resync saved graph list

### D) Legal docs

- Third-party/fonts: `THIRD_PARTY_NOTICES.md`, `public/FONT_LICENSES.txt`
- Investment disclaimer: `DISCLAIMER.md`
- Terms/limitation: `TERMS.md`

---

## Web Connect Setup

### 1) Install extension

1. Open Chrome `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select `extension/rail-bridge`

### 1-1) Important when moving/deleting repo

- `rail.app` can run standalone, but Web Connect still requires the extension.
- If extension was loaded unpacked, and source folder is deleted/moved, extension breaks.
- Copy `extension/rail-bridge` to a stable path and reload it from that path.

### 2) Generate connection code in app

1. Open app `Web Connect` tab
2. Click `Copy Connect Code`
3. Paste URL/token in extension popup and save

### 3) Node setup

- choose a web executor (`web/gpt`, etc.)
- web result mode: `Bridge Assisted (Recommended)`

### 4) Runtime behavior

- app attempts auto-injection + auto-send
- if auto-send fails, user sends once in browser tab
- response is captured and sent to next node

---

## Data & Persistence

- graph files: `graphs/*.json`
- run records: `src-tauri/runs/run-*.json`
- UI locale: browser localStorage (`rail_ui_locale`)

---

## Security Model

### Principles
- local-first execution
- minimal sensitive data retention
- least-privilege bridge communication

### Web Connect protections
- `127.0.0.1` loopback only
- Bearer token authentication
- optional extension ID allowlist
- token rotation support

### Dev-time scan

```bash
bash scripts/secret_scan.sh --all
```

---

## Legal Notice

Review these files before distribution/operation:

- `TERMS.md` : Terms and limitation of liability
- `DISCLAIMER.md` : Investment/financial disclaimer
- `THIRD_PARTY_NOTICES.md` : Third-party notices
- `public/FONT_LICENSES.txt` : Font licenses

Important:
- Stock/financial output is informational, not investment advice.
- Final decisions and resulting gains/losses are user responsibility.

---

## Architecture Rules (Guardrails)

The repo includes structural checks to prevent architectural regressions.

```bash
npm run check:arch
```

Checks include:
- `src/main.tsx` entrypoint constraints
- max-lines limits (with explicit exceptions)
- layer dependency direction
- cross-slice import restrictions

---

## Troubleshooting

### 1) Web node finishes without useful response
- check Web Connect status
- confirm service tab is open
- re-run extension connection test
- perform one manual send if auto-send failed

### 2) Usage check fails
- verify login/session state
- some engine builds may not support usage API

### 3) Graph/feed differs from expectation
- inspect latest run JSON
- confirm grouping by same `runId`
- verify upstream/downstream edge connections

### 4) Dev performance issues
- check duplicated dev server/worker processes
- clean stale browser automation sessions

---

## Development Scripts

- `npm run dev` : Vite dev server
- `npm run tauri dev` : Tauri dev runtime
- `npm run tauri:dev:isolated` : Tauri dev with isolated Codex home (forced)
- `npm run tauri:dev:global` : Tauri dev with global `~/.codex` home (when needed)
- `npm run build` : Type-check + production bundle
- `npm run check:arch` : architecture guardrails
- `npm run check` : architecture + build checks

Note:
- Default runtime now uses an isolated Codex home to prevent mixing with VSCode Codex history.

---

## Roadmap

- further split oversized app modules (FSD enforcement)
- stronger page/feature-level tests
- richer feed rendering (tables/charts/media)
- better runtime/cost observability

---

## License

Follows project policy. See license and notice documents in repository.
