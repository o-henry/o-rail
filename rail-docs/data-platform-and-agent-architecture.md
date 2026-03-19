# Data Platform And Agent Architecture

Generated: 2026-03-19

## Goal

RAIL should support:

- full-fidelity collection of Steam reviews, communities, and critic signals
- preserving all collected data for later re-query, filtering, and audit
- database-backed access inside the app
- a future `visualize` tab that turns collected data into charts and decision aids
- safer, more production-like multi-agent orchestration for Tasks and research workflows

## Current State

- Steam review sampling is implemented with a cautious direct endpoint probe:
  - [steam_review_probe.py](/Users/henry/Documents/code/vibe/hybrid/rail/scripts/steam_review_probe.py)
  - output markdown: [steam-review.md](/Users/henry/Documents/code/vibe/hybrid/rail/rail-docs/steam-review.md)
  - raw cache: [.rail/cache/steam-review-probe](/Users/henry/Documents/code/vibe/hybrid/rail/.rail/cache/steam-review-probe)
- RAIL already has real `Scrapling` and `PinchTab` execution paths in VIA:
  - [server.py](/Users/henry/Documents/code/vibe/hybrid/rail/scripts/via_runtime/server.py#L1699)
  - [server.py](/Users/henry/Documents/code/vibe/hybrid/rail/scripts/via_runtime/server.py#L1940)
  - [server.py](/Users/henry/Documents/code/vibe/hybrid/rail/scripts/via_runtime/server.py#L2231)
- Dashboard crawler and role-knowledge crawler exist separately:
  - [dashboard_crawler.rs](/Users/henry/Documents/code/vibe/hybrid/rail/src-tauri/src/dashboard_crawler.rs#L1471)
  - [roleKnowledgePipeline.ts](/Users/henry/Documents/code/vibe/hybrid/rail/src/app/main/runtime/roleKnowledgePipeline.ts#L150)

## Data Recommendation

Use a `raw -> normalized -> metrics` layout.

### Raw

Store immutable source payloads first.

- `steam/raw/*.json`
- `reddit/raw/*.json`
- `community/raw/*.html|json`
- `critics/raw/*.json`

Keep:

- request metadata
- collected timestamp
- source URL
- source type
- raw payload

Why:

- lets us re-parse later without recollecting
- supports debugging and trust
- supports "show me everything we collected" and "only show X" equally well

### Normalized

Create source-agnostic tables with stable keys.

- `game_dim`
- `source_dim`
- `reviews_fact`
- `critic_fact`
- `collection_runs`

Suggested review fields:

- `source`
- `source_item_id`
- `game_id`
- `title`
- `body`
- `lang`
- `author_id_hash`
- `rating_direction`
- `rating_numeric`
- `helpful_votes`
- `playtime_hours`
- `created_at`
- `collected_at`
- `raw_ref`

### Metrics

Precompute chart-friendly rollups.

- daily review volume
- positive / negative ratio
- topic cluster counts
- critic vs player score gap
- trend by source and language

## Storage Recommendation

Phase 1:

- raw files in `rail-docs` or `.rail/cache`
- DuckDB over Parquet for local analytics

Phase 2:

- keep raw files in object/file storage
- materialize normalized + metrics into ClickHouse if scale grows

Why this path:

- DuckDB is ideal for local-first analysis and query-on-file workflows
- ClickHouse is strong when the `visualize` tab needs fast interactive aggregation

References:

- DuckDB Parquet overview: https://duckdb.org/docs/stable/data/parquet/overview
- Query Parquet directly: https://duckdb.org/docs/stable/guides/file_formats/query_parquet
- dbt incremental models: https://docs.getdbt.com/docs/build/incremental-models
- Delta Lake: https://docs.delta.io/
- Apache Iceberg: https://iceberg.apache.org/docs/1.6.0/spark-queries/
- ClickHouse materialized views: https://clickhouse.com/blog/using-materialized-views-in-clickhouse

## Collection Strategy

### Steam Reviews

Primary:

- direct Steam review endpoint

Fallback:

- Scrapling only when we need page text outside the review API

Last resort:

- PinchTab for page interaction or JS-only paths

Reason:

- the official review endpoint is quieter, lighter, and less bot-like than headless browser scraping

Reference:

- Steam user reviews list API: https://partner.steamgames.com/doc/store/getreviews

### Communities

Primary:

- official/community APIs when public and practical

Secondary:

- Scrapling for extraction-oriented crawling

Tertiary:

- PinchTab for dynamic JS sites, auth profiles, or interaction-heavy pages

Suggested source buckets:

- Reddit
- Steam Community
- itch.io comments/devlogs
- Discourse forums
- Lemmy
- DCInside
- 5ch
- V2EX
- Tieba / Zhihu / Weibo when explicitly targeted

References:

- Reddit API: https://www.reddit.com/dev/api/
- Reddit developer terms: https://redditinc.com/policies/developer-terms
- Discourse API: https://docs.discourse.org/
- Lemmy API: https://join-lemmy.org/docs/en/contributors/04-api.html

### Critic Scores

Prefer structured sources first.

- IGDB aggregated critic fields
- RAWG where appropriate

References:

- IGDB docs: https://api-docs.igdb.com/
- RAWG API: https://rawg.io/apidocs

## Anti-Block Guardrails

Apply these by default:

- low concurrency per domain
- jittered delays
- exponential backoff on `429` and `5xx`
- no immediate retry on `403`
- cache raw responses aggressively
- domain cooldown after repeated failures
- separate direct/API collectors from browser collectors
- use browser collectors only when direct collection is not possible

For RAIL specifically:

- keep Steam on direct endpoint
- keep community crawling in VIA with `Scrapling` first, `PinchTab` second
- add SSRF-style URL validation to VIA dynamic URL collection

Code references:

- PinchTab collection flow: [server.py](/Users/henry/Documents/code/vibe/hybrid/rail/scripts/via_runtime/server.py#L776)
- Scrapling collection flow: [server.py](/Users/henry/Documents/code/vibe/hybrid/rail/scripts/via_runtime/server.py#L1019)
- dynamic source handling: [server.py](/Users/henry/Documents/code/vibe/hybrid/rail/scripts/via_runtime/server.py#L2131)
- dashboard URL guard precedent: [dashboard_crawler.rs](/Users/henry/Documents/code/vibe/hybrid/rail/src-tauri/src/dashboard_crawler.rs#L1229)

## App Integration

### Database Access In RAIL

Expose a repository layer instead of raw source files to the UI.

Suggested modules:

- `src/features/research-storage/domain`
- `src/features/research-storage/runtime`
- `src/features/research-storage/presentation`

Suggested queries:

- `listCollectionRuns()`
- `searchReviews(filters)`
- `getGameSentimentSeries(gameId)`
- `getCriticPlayerGap(gameId)`
- `getTopicClusters(gameId, sourceType)`

### Visualize Tab

Add a dedicated workspace tab:

- `visualize`

Use Codex to produce a chart spec from filtered data, then render it with a deterministic chart layer.

Recommended renderers:

- ECharts
- Vega-Lite
- Plotly.js

Recommended flow:

1. user selects dataset or asks a question
2. backend query returns normalized or metric data
3. Codex generates chart intent + explanation + spec
4. renderer draws chart
5. user can inspect underlying rows

References:

- ECharts: https://github.com/apache/echarts
- Vega-Lite: https://vega.github.io/vega-lite/
- Plotly.js: https://github.com/plotly/plotly.js
- Apache Superset: https://github.com/apache/superset
- Metabase: https://github.com/metabase/metabase
- Lightdash: https://github.com/lightdash/lightdash
- Evidence: https://github.com/evidence-dev/evidence

## Multi-Agent Guidance For RAIL

The most useful patterns for RAIL are:

- sequential pipelines for stable ETL-like work
- parallel fan-out for source collection and independent analysis
- loop/critic patterns for iterative refinement
- human approval on risky actions
- explicit tool permissions per role
- explicit short-term and long-term memory separation

Google Cloud guidance that maps well to RAIL:

- tools should be modular, observable, and safely governed
- MCP is a strong fit for modular tool integration
- short-term and long-term memory should be separated
- parallel agents are best when collecting different sources or viewpoints
- sequential agents are best for fixed pipelines
- human-in-the-loop and narrow permissions matter for safety

References:

- agent tools and MCP: https://docs.cloud.google.com/architecture/choose-agentic-ai-architecture-components?hl=ko
- agent memory: https://docs.cloud.google.com/architecture/choose-agentic-ai-architecture-components?hl=ko
- sequential pattern: https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system?hl=ko
- parallel pattern: https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system?hl=ko
- multi-agent reliability/security guidance: https://docs.cloud.google.com/architecture/multiagent-ai-system?hl=ko

Practical RAIL mapping:

- `planner` agent decides slice and success criteria
- `collector` agents fan out across sources
- `critic` agent checks quality, duplication, and confidence
- `synthesizer` agent prepares the final brief or chart explanation
- human approval gates destructive actions, external publishing, and high-cost runs

## AutoResearch

`karpathy/autoresearch` is not a generic framework for model self-improvement in the "agent weights get smarter by themselves" sense.

It is closer to:

- autonomous research workflow orchestration
- repeated experiment editing
- iterative improvement of research instructions and code

Important note:

- the repo explicitly centers on editing `train.py` and iterating on `program.md`
- that means the system improves experiments and workflow behavior, not the agent foundation model weights by default

Reference:

- https://github.com/karpathy/autoresearch

## Skills In This Environment

Relevant built-in skills currently available in this Codex environment:

- `linear`
- `notion-research-documentation`
- `notion-spec-to-implementation`
- `slides`
- `figma`
- `openai-docs`
- `spreadsheet`

There is no dedicated "BI chart builder for the rail app" skill right now.

For RAIL, the most realistic path is:

- use Codex to generate chart specs
- render with ECharts or Vega-Lite in-app
- optionally export polished decks with `slides`

## Recommended Next Steps

1. Move Steam raw cache into a first-class `research-storage` layer.
2. Add a normalized local DuckDB database and ingest Steam review facts into it.
3. Extend collectors to Reddit/Discourse/Lemmy/community sources using VIA.
4. Add `critic_fact` support through IGDB or another structured source.
5. Add a `visualize` workspace tab backed by chart specs and raw row drilldown.
6. Upgrade Tasks multi-agent flows to explicit planner/collector/critic/synthesizer roles with better observability.
