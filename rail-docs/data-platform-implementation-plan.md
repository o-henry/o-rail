# Data Platform Implementation Plan

Generated: 2026-03-19

## Constraints

- all collection and storage must work with free or local-only tooling
- raw collected data must remain inspectable later
- the app needs a stable repository layer before a `visualize` tab is added

## Priorities

1. `research-storage` foundation
2. app-facing query layer
3. community and critic source expansion
4. `visualize` tab and chart-spec workflow
5. explicit planner / collector / critic / synthesizer task flows

## Phase 1

Status: in progress

Goal:

- promote existing Steam cache into an immutable raw run store
- ingest normalized review facts into a local database
- expose read commands so RAIL can inspect collection runs and search reviews
- expose chart-ready aggregate and sentiment-series commands for future visualization
- add dynamic URL collection job specs with strategy resolution and researcher handoff payloads

Acceptance criteria:

- Steam cache can be promoted without network access
- promoted raw files are append-only by run
- normalized reviews are queryable from the app
- query results keep a pointer back to raw files
- aggregate and time-series results are available without rescanning raw files
- dynamic URL collection requests can be planned and persisted before execution

Implementation slice:

- `.rail/research/raw/steam/<run-id>/...`
- `.rail/research/app.db`
- Tauri commands:
  - `research_storage_ingest_steam_cache`
  - `research_storage_overview`
  - `research_storage_query_reviews`
  - `research_storage_list_games`
  - `research_storage_game_metrics`
  - `research_storage_sentiment_series`
  - `research_storage_plan_dynamic_job`
  - `research_storage_list_jobs`
  - `research_storage_load_job`
  - `research_storage_build_job_handoff`
- frontend runtime wrapper in `src/features/research-storage/runtime`

## Phase 2

Goal:

- add dataset browser UI
- show collection runs, games, and raw drilldown
- let users open full raw rows and markdown summaries

## Phase 3

Goal:

- ingest community sources through VIA collectors
- normalize community posts and critic facts into the same repository

## Phase 4

Goal:

- add `visualize` tab
- let Codex generate chart specs from filtered datasets
- render deterministic charts with row drilldown

## Phase 5

Goal:

- align Tasks with planner / collector / critic / synthesizer roles
- connect research-storage as long-term memory for research agents
