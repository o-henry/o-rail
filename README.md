# RAIL

RAIL is a local-first multi-agent workflow desktop app built with Tauri.  
Its core interaction model is a graph canvas where you connect role nodes, data/RAG nodes, gate nodes, and transform nodes into a DAG. Each node receives structured output from upstream nodes, then synthesizes, reviews, ranks, or documents the next step.

RAIL is currently optimized around:

- beginner-friendly canvas-first UX
- role-based multi-agent collaboration
- attachment, RAG, and role-memory grounded context injection
- internal quality guardrails and workspace-specific self-improvement loops
- local document storage, run history, and assisted web-connected execution

---

## Tabs

- `Graph`
  Main canvas for building and running node-based workflows
- `Feed`
  Timeline of run results, logs, generated documents, and failures
- `Database`
  Explore stored run artifacts and reinject them into workflows
- `Adaptation`
  Inspect current workspace defaults, recent evaluations, and learned patterns
- `Agents`
  Agent workbench / mission control style execution surface
- `Settings`
  Base settings, web connection, memory management, and account controls
- `Intelligence`
  Dashboard Intelligence runs and topic snapshot management
- `Tasks`
  Thread-based task orchestration with role agents
- `Visualize`
  Research and evidence monitor for collected datasets

---

## Graph Canvas

The graph tab is where you build flows such as:

`direct question -> role nodes / data nodes -> synthesis / decision -> documentation`

Key behavior:

- multiple direct-input roots can run in parallel
- outputs from multiple parent nodes are passed downstream as structured packets
- final document nodes follow a no-truncation rule
- empty outputs hard-fail and do not propagate
- new nodes spawn around the current visible canvas center
- role nodes can expose hidden internal research / synthesis / verification chains

### Node Types

- `Role nodes`
  PM, client, systems, tooling, art pipeline, QA, release, documentation, and other role-oriented turn nodes
- `Data nodes`
  RAG / VIA-backed information gathering and evidence collection
- `Transform nodes`
  text extraction, templating, lightweight structure reshaping
- `Gate nodes`
  PASS / REJECT style branching logic

### Default Model

The default model for newly created turn nodes is currently `GPT-5.3-Codex`.

---

## Role Nodes

Role nodes are not just one-off answer generators. They interpret the input from a specialized perspective and pass forward structured work.

Current role families include:

- `PM / Planning`
- `Client`
- `Systems`
- `Tooling`
- `Art Pipeline`
- `QA`
- `Build / Release`
- `Documentation`

### Role Modes

Some roles support `creative` / `logical` modes.

- `Creative`
  better for divergence, ideation, and alternatives
- `Logical`
  better for realism, verification, and risk control

Important:

- creative does not mean uncontrolled hallucination
- critic / synthesis / final-document roles are intentionally more conservative

### Internal Role Work

Role nodes may have hidden internal research chains attached:

- internal research source
- research synthesis
- research verification
- final role node

These chains stay collapsed by default and can be expanded through the node’s internal-work UI.

### Automatic Research

Adding a role node currently includes automatic internal research behavior.  
That means a single visible role node may execute multiple hidden turns behind the scenes.

Implications:

- actual turn count can be higher than the visible node count
- usage can be higher than expected
- this is useful for grounded roles, but may be excessive for lightweight brainstorming

Web research nodes are excluded from auto-internal work. If web-grounded evidence is required, add a dedicated data node or web node explicitly.

### Saved Follow-up Instructions

The right-side role workspace is now a “store additional instructions” panel rather than an immediate execution panel.

Behavior:

- store additional instructions for the selected role node only
- saved instructions are injected on the next graph execution
- stored instructions can be deleted from the panel

---

## RAG / Data Nodes

RAIL supports RAG / VIA-style data nodes directly inside the graph.

Examples:

- `source.news`
- `source.community`
- `source.market`
- `source.dev`
- `transform.normalize`
- `transform.verify`
- `transform.rank`
- `agent.codex`
- `export.rag`

Key behavior:

- attached files are actually used as execution-time knowledge context
- attached graph files can be toggled on/off or removed
- the RAG workspace and role-internal research chains are intentionally separated in the UI
- when web results are required, explicit WEB or data nodes are usually more predictable

---

## Web Connection

Nodes that need browser automation can use the `WEB` executor.

Current flow:

- inspect web connection state
- open the service window
- copy prompts
- collect manual input through modals
- submit manual responses back into the run

Related overlays include:

- `approval required`
- `web response required`

WEB nodes also expose a direct `manual input` action from the node card.

---

## Memory

Long-term user memory is managed from the Settings tab.

Supported features:

- manual memory creation
- memory deletion
- automatic memory on/off
- memory / RAG usage activity visibility

This behaves similarly to ChatGPT-style memory, but is used conservatively inside workspace and graph execution context.

---

## Adaptation

The `Adaptation` tab shows internal evaluation state and workspace-specific self-improvement information.

Visible outputs include:

- `current recommended defaults`
- `recent evaluation results`
- `tested alternatives`
- `management controls`

Important:

- internal evaluation, candidate generation, and promotion logic are not exposed as graph nodes
- this tab is for monitoring, freezing, resuming, and resetting
- saved user graphs are not automatically rewritten

---

## Quality Guardrails

RAIL currently includes:

- no-truncation rules for document-style / final nodes
- quality failure on omitted / elided `...` style outputs
- hard fail on empty output
- structured multi-perspective input packets
- grounding / evidence / limitation checks for final synthesis nodes
- workspace-adaptive default learning

The goal is not “longer answers” but “role-distinct outputs with unsupported results filtered out”.

---

## Recommended Graph for Solo Indie Game Ideation

Recommended baseline:

```text
Direct question
-> PM (creative)
-> Client / Systems / QA / Art in parallel
-> PM (logical)
-> Documentation
```

Meaning:

- `PM (creative)` generates the initial direction
- `Client / Systems / QA / Art` review the same draft from specialized perspectives
- `PM (logical)` reconciles conflicting evaluations
- `Documentation` turns the result into a proposal and prototype plan

---

## Internationalization

RAIL currently has built-in UI locale registration for:

- `ko` Korean
- `en` English
- `jp` Japanese
- `zh` Chinese

The app ships locale dictionaries under [`src/i18n/messages`](./src/i18n/messages), and the selected locale is persisted in local storage.

---

## Quick Start

```bash
npm install
npm run tauri:dev
```

Run only the web UI:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Run all checks:

```bash
npm run check
```

---

## Project Structure

```txt
src/
  app/                # app composition, state, runtime handlers
  pages/              # top-level tabs and page UI
  features/           # workflow, studio, presets, adaptation domain logic
  styles/             # page and layout styling
scripts/via_runtime/  # embedded VIA Python runtime
src-tauri/            # Rust bridge and system commands
```

---

## Docs

- Security: [SECURITY.md](./SECURITY.md)
- Terms: [TERMS.md](./TERMS.md)
- Disclaimer: [DISCLAIMER.md](./DISCLAIMER.md)
- Third-party notices: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
