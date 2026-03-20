# RAIL

RAIL is a local-first Tauri desktop app for graph workflows, task threads, research collection, and workspace knowledge management.

It combines:

- a DAG canvas for structured multi-step execution
- a task thread surface for agent-driven work
- a research pipeline that can collect, normalize, and visualize evidence
- a local knowledge/database layer for stored runs, artifacts, and documents

RAIL is designed for fast iteration inside a single workspace without depending on a hosted orchestration backend.

## What RAIL Does

RAIL supports three main working styles:

1. Graph workflows
   Build node-based flows that combine role nodes, transforms, gates, and data collection.
2. Task threads
   Ask for work in a chat-like thread, tag role agents such as `@researcher`, and review artifacts as they are produced.
3. Research monitoring
   Run research-oriented collection jobs, inspect structured evidence, and view question-aware charts in the Visualize tab.

## Core Surfaces

### Graph

The Graph tab is the canvas-first workflow editor.

Typical use cases:

- build multi-node pipelines
- branch on pass / fail decisions
- combine role outputs into a final document
- inject files and grounded evidence into later nodes

The graph runtime is oriented around DAG execution and explicit node-to-node handoff.

### Tasks

The Tasks tab is the fastest way to ask for work.

Key behavior:

- create a thread
- tag one or more role agents such as `@researcher`
- stream status, logs, and artifacts into the thread
- stop a running request from the composer
- inspect related files and generated outputs in context

Tasks are useful when you want the system to choose the execution path for you instead of hand-building a graph.

### Visualize

The Visualize tab is the research monitor.

It is intended for questions such as:

- “What are the best-rated genres on Steam right now?”
- “Compare community sentiment for these games.”
- “Show the strongest evidence behind this research report.”

Visualize reads normalized research outputs and renders:

- question-aware charts
- timeline or aggregate tables when appropriate
- evidence streams
- research history / prior sessions

### Database

The Database tab is the local knowledge browser.

Use it to:

- inspect stored run artifacts
- open grouped documents
- review previously generated outputs
- manage saved research and knowledge entries

### Settings

The Settings tab contains operational controls for the app.

Current settings areas include:

- appearance and base preferences
- Web Connect / bridge status
- account and Codex-related controls
- memory and retention management
- locale selection

## Research Pipeline

RAIL includes a research-oriented collection path used by `@researcher`.

That flow can:

- interpret the user question
- choose a collection mode such as genre ranking or comparison
- collect relevant evidence
- normalize collected items into local storage
- generate a report spec for Visualize

The current system is built so that new research runs can be viewed later instead of being lost after a single answer.

## Web Connect

RAIL can expose a local bridge for browser-connected flows.

The bridge surface shows:

- local bridge URL
- full connection code for the extension or external client
- restart and refresh controls

The bridge is intended for local workflow integration, not public deployment.

## Storage Model

RAIL is local-first.

Important data is kept in the workspace, including:

- task runs
- studio role runs
- collected research artifacts
- normalized research storage
- knowledge/database entries

This makes it possible to inspect or reuse prior work without depending on a remote service.

## Internationalization

The current user-facing locale selector supports:

- Korean
- English

Some additional locale assets may still exist internally, but the current settings surface is intentionally limited to the actively supported options.

## Tech Stack

- Tauri
- React
- TypeScript
- Vite

## Development

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm run tauri:dev
```

Type-check:

```bash
./node_modules/.bin/tsc --noEmit
```

## Current Focus

RAIL is actively evolving around:

- reliable role-agent orchestration
- research collection quality
- better visualize/report generation
- local knowledge and artifact management
- low-noise desktop UX for everyday use
