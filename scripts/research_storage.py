#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import shutil
import sqlite3
import socket
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

RAW_ROOT = Path(".rail/research/raw/steam")
DB_PATH = Path(".rail/research/app.db")
CACHE_ROOT = Path(".rail/cache/steam-review-probe")
MAX_DYNAMIC_JOB_URLS = 24
MAX_DYNAMIC_JOB_KEYWORDS = 12

COMMUNITY_HOST_HINTS = (
    "reddit.com",
    "steamcommunity.com",
    "itch.io",
    "dcinside.com",
    "5ch.net",
    "lemmy",
    "resetera.com",
    "tieba.baidu.com",
    "zhihu.com",
    "weibo.com",
    "discourse",
)
CRITIC_HOST_HINTS = (
    "metacritic.com",
    "opencritic.com",
    "eurogamer.net",
    "rockpapershotgun.com",
    "pcgamer.com",
    "ign.com",
    "gamespot.com",
)
DEV_HOST_HINTS = (
    "gamedev.net",
    "news.ycombinator.com",
    "dev.to",
    "github.com",
    "gamasutra.com",
)
MARKET_HOST_HINTS = (
    "rawg.io",
    "steamdb.info",
    "itch.io",
)
PINCHTAB_HOST_HINTS = (
    "reddit.com",
    "steamcommunity.com",
    "dcinside.com",
    "5ch.net",
    "weibo.com",
    "zhihu.com",
)
RSS_PATH_HINTS = ("/rss", "/feed", ".xml")

PROMPT_DOMAIN_HINTS: dict[str, tuple[str, ...]] = {
    "steam": ("store.steampowered.com", "steamcommunity.com"),
    "스팀": ("store.steampowered.com", "steamcommunity.com"),
    "reddit": ("reddit.com",),
    "레딧": ("reddit.com",),
    "community": ("reddit.com", "steamcommunity.com"),
    "커뮤니티": ("reddit.com", "steamcommunity.com", "dcinside.com"),
    "critic": ("opencritic.com", "metacritic.com"),
    "critics": ("opencritic.com", "metacritic.com"),
    "평론": ("opencritic.com", "metacritic.com"),
    "점수": ("opencritic.com", "metacritic.com"),
    "review": ("opencritic.com", "metacritic.com", "steamcommunity.com"),
    "reviews": ("opencritic.com", "metacritic.com", "steamcommunity.com"),
    "리뷰": ("opencritic.com", "metacritic.com", "steamcommunity.com"),
    "genre": ("reddit.com", "steamcommunity.com", "opencritic.com"),
    "장르": ("reddit.com", "steamcommunity.com", "opencritic.com"),
    "평가": ("opencritic.com", "metacritic.com", "reddit.com"),
}

PROMPT_QUERY_HINTS: dict[str, str] = {
    "steam": "steam recent reviews",
    "스팀": "steam recent reviews",
    "genre": "game genre reception",
    "장르": "game genre reception",
    "critic": "critic review scores",
    "평론": "critic review scores",
    "community": "player community opinion",
    "커뮤니티": "player community opinion",
    "review": "game review impressions",
    "리뷰": "game review impressions",
}

DEFAULT_GAMES: list[tuple[int, str]] = [
    (2379780, "Balatro"),
    (413150, "Stardew Valley"),
    (646570, "Slay the Spire"),
    (1794680, "Vampire Survivors"),
    (1942280, "Brotato"),
    (960090, "Bloons TD 6"),
]

def stable_slug(raw: str) -> str:
    value = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(raw or ""))
    value = "-".join(part for part in value.split("-") if part)
    return value or "item"


GAME_NAME_BY_APPID = {str(appid): name for appid, name in DEFAULT_GAMES}
GAME_NAME_BY_SLUG = {stable_slug(name): name for _, name in DEFAULT_GAMES}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_run_id(prefix: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    return f"{prefix}-{stamp}"


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_parent(path)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_text(payload: str) -> str:
    return sha256_bytes(payload.encode("utf-8"))


def normalize_workspace(workspace: str) -> Path:
    path = Path(workspace).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise RuntimeError(f"workspace not found: {path}")
    return path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Promote Steam cache into research storage and query it.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest-steam-cache", help="Promote cached Steam pages into research storage.")
    ingest.add_argument("--workspace", required=True, help="Workspace root")

    overview = subparsers.add_parser("overview", help="Show research storage overview.")
    overview.add_argument("--workspace", required=True, help="Workspace root")

    query = subparsers.add_parser("query-reviews", help="Query normalized reviews.")
    query.add_argument("--workspace", required=True, help="Workspace root")
    query.add_argument("--source", default="steam", help="Source filter")
    query.add_argument("--game-key", default="", help="Game key filter, e.g. steam:2379780")
    query.add_argument("--sentiment", default="", help="positive or negative")
    query.add_argument("--language", default="", help="Language filter")
    query.add_argument("--search", default="", help="Body text search")
    query.add_argument("--limit", type=int, default=50, help="Page size")
    query.add_argument("--offset", type=int, default=0, help="Query offset")

    list_games = subparsers.add_parser("list-games", help="List normalized games in research storage.")
    list_games.add_argument("--workspace", required=True, help="Workspace root")
    list_games.add_argument("--source", default="steam", help="Source filter")

    metrics = subparsers.add_parser("game-metrics", help="Return chart-friendly per-game aggregates.")
    metrics.add_argument("--workspace", required=True, help="Workspace root")
    metrics.add_argument("--source", default="steam", help="Source filter")

    series = subparsers.add_parser("sentiment-series", help="Return daily sentiment series for a game.")
    series.add_argument("--workspace", required=True, help="Workspace root")
    series.add_argument("--game-key", required=True, help="Game key filter, e.g. steam:2379780")
    series.add_argument("--source", default="steam", help="Source filter")
    series.add_argument("--limit", type=int, default=90, help="Max day buckets")

    plan_job = subparsers.add_parser("plan-dynamic-job", help="Plan a dynamic URL collection job and persist it.")
    plan_job.add_argument("--workspace", required=True, help="Workspace root")
    plan_job.add_argument("--urls-json", required=True, help="JSON array of urls")
    plan_job.add_argument("--keywords-json", default="[]", help="JSON array of keywords")
    plan_job.add_argument("--label", default="", help="Optional human label")
    plan_job.add_argument("--requested-source-type", default="auto", help="auto, community, critic, dev, market, news")
    plan_job.add_argument("--max-items", type=int, default=40, help="Requested max items")

    list_jobs = subparsers.add_parser("list-jobs", help="List planned collection jobs.")
    list_jobs.add_argument("--workspace", required=True, help="Workspace root")

    load_job = subparsers.add_parser("load-job", help="Load a planned collection job.")
    load_job.add_argument("--workspace", required=True, help="Workspace root")
    load_job.add_argument("--job-id", required=True, help="Job id")

    build_handoff = subparsers.add_parser("build-job-handoff", help="Build an agent handoff payload for a collection job.")
    build_handoff.add_argument("--workspace", required=True, help="Workspace root")
    build_handoff.add_argument("--job-id", required=True, help="Job id")
    build_handoff.add_argument("--agent-role", default="researcher", help="Target agent role")

    plan_agent_job = subparsers.add_parser("plan-agent-job", help="Plan a collection job from a natural-language researcher request.")
    plan_agent_job.add_argument("--workspace", required=True, help="Workspace root")
    plan_agent_job.add_argument("--prompt", required=True, help="Natural language research request")
    plan_agent_job.add_argument("--label", default="", help="Optional human label")
    plan_agent_job.add_argument("--requested-source-type", default="auto", help="auto, community, critic, dev, market, news")
    plan_agent_job.add_argument("--max-items", type=int, default=40, help="Requested max items")

    list_items = subparsers.add_parser("list-collection-items", help="List normalized collection items.")
    list_items.add_argument("--workspace", required=True, help="Workspace root")
    list_items.add_argument("--job-id", default="", help="Optional job id filter")
    list_items.add_argument("--source-type", default="", help="Optional source type filter")
    list_items.add_argument("--verification-status", default="", help="verified, warning, conflicted")
    list_items.add_argument("--search", default="", help="Search over title/summary/excerpt")
    list_items.add_argument("--limit", type=int, default=50, help="Page size")
    list_items.add_argument("--offset", type=int, default=0, help="Query offset")

    collection_metrics_cmd = subparsers.add_parser("collection-metrics", help="Return chart-ready collection item aggregates.")
    collection_metrics_cmd.add_argument("--workspace", required=True, help="Workspace root")
    collection_metrics_cmd.add_argument("--job-id", default="", help="Optional job id filter")

    execute_job = subparsers.add_parser("execute-job", help="Execute a planned collection job against the VIA runtime.")
    execute_job.add_argument("--workspace", required=True, help="Workspace root")
    execute_job.add_argument("--job-id", required=True, help="Job id")
    execute_job.add_argument("--via-base-url", required=True, help="VIA runtime base url")
    execute_job.add_argument("--flow-id", type=int, default=1, help="VIA flow id")

    record_job_run = subparsers.add_parser("record-job-run", help="Persist a collection job execution result.")
    record_job_run.add_argument("--workspace", required=True, help="Workspace root")
    record_job_run.add_argument("--job-id", required=True, help="Job id")
    record_job_run.add_argument("--flow-id", type=int, default=1, help="VIA flow id")
    record_job_run.add_argument("--result-json", required=True, help="JSON execution result")

    return parser.parse_args()


def connect_db(db_path: Path) -> sqlite3.Connection:
    ensure_parent(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS collection_runs (
            run_id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            collector TEXT NOT NULL,
            collected_at TEXT NOT NULL,
            raw_root TEXT NOT NULL,
            manifest_path TEXT NOT NULL,
            game_count INTEGER NOT NULL DEFAULT 0,
            raw_document_count INTEGER NOT NULL DEFAULT 0,
            review_count INTEGER NOT NULL DEFAULT 0,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS game_dim (
            game_key TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            source_game_id TEXT NOT NULL,
            slug TEXT NOT NULL,
            name TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS raw_documents (
            raw_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            source TEXT NOT NULL,
            game_key TEXT NOT NULL,
            page_index INTEGER NOT NULL,
            raw_path TEXT NOT NULL,
            source_url TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS reviews_fact (
            review_key TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            source TEXT NOT NULL,
            source_item_id TEXT NOT NULL,
            game_key TEXT NOT NULL,
            game_name TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL,
            lang TEXT NOT NULL DEFAULT '',
            author_id_hash TEXT NOT NULL DEFAULT '',
            rating_direction TEXT NOT NULL,
            rating_numeric REAL,
            helpful_votes INTEGER NOT NULL DEFAULT 0,
            funny_votes INTEGER NOT NULL DEFAULT 0,
            playtime_hours REAL,
            created_at TEXT NOT NULL,
            collected_at TEXT NOT NULL,
            raw_id TEXT NOT NULL,
            raw_path TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_collection_runs_source ON collection_runs(source, collected_at DESC);
        CREATE INDEX IF NOT EXISTS idx_raw_documents_run ON raw_documents(run_id, game_key);
        CREATE INDEX IF NOT EXISTS idx_reviews_fact_source ON reviews_fact(source, game_key, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reviews_fact_language ON reviews_fact(lang);
        CREATE INDEX IF NOT EXISTS idx_reviews_fact_sentiment ON reviews_fact(rating_direction);

        CREATE TABLE IF NOT EXISTS collection_jobs (
            job_id TEXT PRIMARY KEY,
            job_kind TEXT NOT NULL,
            status TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            requested_source_type TEXT NOT NULL,
            resolved_source_type TEXT NOT NULL,
            via_source_type TEXT NOT NULL DEFAULT '',
            collector_strategy TEXT NOT NULL,
            max_items INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            job_spec_json TEXT NOT NULL DEFAULT '{}',
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS collection_job_targets (
            target_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            url TEXT NOT NULL,
            host TEXT NOT NULL DEFAULT '',
            resolved_source_type TEXT NOT NULL,
            collector_strategy TEXT NOT NULL,
            interaction_mode TEXT NOT NULL DEFAULT 'passive',
            requires_browser INTEGER NOT NULL DEFAULT 0,
            target_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS collection_job_handoffs (
            handoff_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            agent_role TEXT NOT NULL,
            title TEXT NOT NULL,
            prompt TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collection_job_runs (
            job_run_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            via_run_id TEXT NOT NULL DEFAULT '',
            flow_id INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            result_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS collection_items_fact (
            item_fact_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            job_run_id TEXT NOT NULL,
            via_run_id TEXT NOT NULL DEFAULT '',
            source_type TEXT NOT NULL,
            source_name TEXT NOT NULL DEFAULT '',
            country TEXT NOT NULL DEFAULT '',
            adapter TEXT NOT NULL DEFAULT '',
            item_key TEXT NOT NULL,
            source_item_id TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            content_excerpt TEXT NOT NULL DEFAULT '',
            published_at TEXT NOT NULL DEFAULT '',
            fetched_at TEXT NOT NULL DEFAULT '',
            verification_status TEXT NOT NULL DEFAULT 'warning',
            score INTEGER NOT NULL DEFAULT 0,
            hot_score INTEGER NOT NULL DEFAULT 0,
            source_count INTEGER NOT NULL DEFAULT 1,
            raw_export_path TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_collection_jobs_updated ON collection_jobs(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_collection_job_targets_job ON collection_job_targets(job_id, position ASC);
        CREATE INDEX IF NOT EXISTS idx_collection_job_handoffs_job ON collection_job_handoffs(job_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_collection_job_runs_job ON collection_job_runs(job_id, executed_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_fact_job_key ON collection_items_fact(job_id, item_key);
        CREATE INDEX IF NOT EXISTS idx_collection_items_fact_source ON collection_items_fact(source_type, published_at DESC);
        CREATE INDEX IF NOT EXISTS idx_collection_items_fact_verification ON collection_items_fact(verification_status, score DESC);
        """
    )
    return conn


def parse_appid(source_url: str) -> str:
    parsed = urlparse(source_url)
    match = re.search(r"/appreviews/(\d+)", parsed.path)
    if not match:
        raise RuntimeError(f"failed to parse appid from url: {source_url}")
    return match.group(1)


def parse_page_index(path: Path) -> int:
    match = re.search(r"page-(\d+)\.json$", path.name)
    return int(match.group(1)) if match else 0


def infer_game_name(game_slug: str, appid: str) -> str:
    return GAME_NAME_BY_APPID.get(appid) or GAME_NAME_BY_SLUG.get(game_slug) or game_slug.replace("-", " ").title()


def discover_cache_files(workspace: Path) -> list[Path]:
    cache_root = workspace / CACHE_ROOT
    return sorted(path for path in cache_root.glob("*/*.json") if path.is_file())


def parse_json_list(raw: str, *, limit: int) -> list[str]:
    try:
        parsed = json.loads(str(raw or "[]"))
    except Exception as exc:
        raise RuntimeError(f"invalid json list: {exc}") from exc
    if not isinstance(parsed, list):
        raise RuntimeError("json list input must be an array")
    out: list[str] = []
    seen: set[str] = set()
    for value in parsed:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
        if len(out) >= limit:
            break
    return out


def parse_host(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    host = str(parsed.hostname or parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def is_disallowed_collection_host(host: str) -> bool:
    normalized = host.strip().lower().rstrip(".")
    if not normalized:
        return True
    if normalized in {"localhost", "0.0.0.0"} or normalized.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast)
    except ValueError:
        pass
    try:
        for _, _, _, _, sockaddr in socket.getaddrinfo(normalized, None):
            raw_ip = str(sockaddr[0])
            ip = ipaddress.ip_address(raw_ip)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return True
    except Exception:
        # DNS resolution failure should not make a public hostname automatically invalid at plan time.
        return False
    return False


def validate_collection_urls(urls: list[str]) -> None:
    for url in urls:
        host = parse_host(url)
        if is_disallowed_collection_host(host):
            raise RuntimeError(f"disallowed collection host: {host or url}")


def extract_urls_from_prompt(prompt: str) -> list[str]:
    matches = re.findall(r"https?://[^\s)>\]]+", str(prompt or ""))
    out: list[str] = []
    for value in matches:
        normalized = value.strip().rstrip(".,")
        if normalized and normalized not in out:
            out.append(normalized)
    return out[:MAX_DYNAMIC_JOB_URLS]


def infer_domains_from_prompt(prompt: str) -> list[str]:
    text = str(prompt or "").lower()
    out: list[str] = []
    for token, domains in PROMPT_DOMAIN_HINTS.items():
        if token in text:
            for domain in domains:
                if domain not in out:
                    out.append(domain)
    return out[:24]


def build_prompt_keywords(prompt: str) -> list[str]:
    text = re.sub(r"@[a-z0-9_-]+", " ", str(prompt or "").strip(), flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    queries: list[str] = [text[:140]]
    lowered = text.lower()
    for token, query in PROMPT_QUERY_HINTS.items():
        if token in lowered and query not in queries:
            queries.append(query)
    return queries[:MAX_DYNAMIC_JOB_KEYWORDS]


def to_safe_text(value: Any, *, limit: int) -> str:
    return " ".join(str(value or "").split()).strip()[:limit]


def to_safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return default


def classify_dynamic_source_type(urls: list[str], requested_source_type: str) -> str:
    requested = str(requested_source_type or "auto").strip().lower()
    alias = {
        "community": "community",
        "critic": "critic",
        "dev": "dev",
        "developer": "dev",
        "market": "market",
        "news": "news",
        "sns": "sns",
        "social": "sns",
    }
    if requested in alias:
        return alias[requested]

    scores = {
        "community": 0,
        "critic": 0,
        "dev": 0,
        "market": 0,
        "news": 0,
        "sns": 0,
    }
    for url in urls:
        host = parse_host(url)
        if any(hint in host for hint in COMMUNITY_HOST_HINTS):
            scores["community"] += 2
        if any(hint in host for hint in CRITIC_HOST_HINTS):
            scores["critic"] += 2
        if any(hint in host for hint in DEV_HOST_HINTS):
            scores["dev"] += 2
        if any(hint in host for hint in MARKET_HOST_HINTS):
            scores["market"] += 1
        if host.endswith("x.com") or host.endswith("threads.net"):
            scores["sns"] += 2
        if scores["community"] == 0 and scores["critic"] == 0 and scores["dev"] == 0 and scores["market"] == 0:
            scores["news"] += 1
    priority = {"community": 6, "critic": 5, "dev": 4, "market": 3, "sns": 2, "news": 1}
    best = max(scores.items(), key=lambda item: (item[1], priority.get(item[0], 0)))[0]
    return best or "news"


def to_via_source_type(source_type: str) -> str:
    mapping = {
        "community": "source.community",
        "critic": "source.news",
        "dev": "source.dev",
        "market": "source.market",
        "news": "source.news",
        "sns": "source.sns",
    }
    return mapping.get(source_type, "source.news")


def resolve_target_strategy(url: str, source_type: str) -> dict[str, Any]:
    host = parse_host(url)
    path = urlparse(url).path.lower()
    strategy = "scrapling"
    interaction_mode = "passive"
    reasons: list[str] = []
    if any(path.endswith(suffix) or suffix in path for suffix in RSS_PATH_HINTS):
        strategy = "rss"
        reasons.append("rss_or_feed_path")
    elif any(hint in host for hint in PINCHTAB_HOST_HINTS):
        strategy = "pinchtab"
        interaction_mode = "interactive"
        reasons.append("interaction_heavy_host")
    elif source_type == "critic":
        strategy = "scrapling"
        reasons.append("article_like_review_source")
    elif source_type == "dev":
        strategy = "scrapling"
        reasons.append("documentation_or_forum_source")
    else:
        reasons.append("default_text_extraction")

    interaction_steps = ["open_url", "extract_primary_content"]
    if strategy == "pinchtab":
        interaction_steps = ["open_url", "wait_for_content", "expand_more_if_present", "paginate_if_present", "extract_primary_content"]
    if strategy == "rss":
        interaction_steps = ["fetch_feed", "parse_items"]

    return {
        "host": host,
        "strategy": strategy,
        "interactionMode": interaction_mode,
        "requiresBrowser": strategy == "pinchtab",
        "reasons": reasons,
        "interactionSteps": interaction_steps,
    }


def summarize_job_strategy(targets: list[dict[str, Any]]) -> str:
    if not targets:
        return "dynamic_search"
    strategies = {str(row.get("collectorStrategy") or "") for row in targets}
    if len(strategies) == 1:
        return next(iter(strategies))
    if "pinchtab" in strategies:
        return "mixed_browser"
    if "rss" in strategies and len(strategies) == 2:
        return "mixed_feed"
    return "mixed"


def build_dynamic_collection_job(
    *,
    urls: list[str],
    keywords: list[str],
    seed_domains: list[str] | None = None,
    label: str,
    requested_source_type: str,
    max_items: int,
) -> dict[str, Any]:
    normalized_urls = [url for url in urls if url.startswith("http://") or url.startswith("https://")]
    normalized_keywords = [str(value).strip() for value in keywords if str(value).strip()]
    normalized_domains = [str(value or "").strip().lower() for value in (seed_domains or []) if str(value or "").strip()]
    if normalized_urls:
        validate_collection_urls(normalized_urls)
    if not normalized_urls and not normalized_keywords and not normalized_domains:
        raise RuntimeError("at least one url, keyword, or domain hint is required")
    resolved_source_type = classify_dynamic_source_type(normalized_urls or [f"https://{domain}" for domain in normalized_domains], requested_source_type)
    via_source_type = to_via_source_type(resolved_source_type)
    targets: list[dict[str, Any]] = []
    domains: list[str] = []
    for domain in normalized_domains:
        if domain not in domains:
            domains.append(domain)
    for index, url in enumerate(normalized_urls):
        strategy = resolve_target_strategy(url, resolved_source_type)
        target_id = sha256_text(f"{url}:{index}")[:20]
        host = str(strategy["host"])
        if host and host not in domains:
            domains.append(host)
        targets.append(
            {
                "targetId": target_id,
                "position": index,
                "url": url,
                "host": host,
                "resolvedSourceType": resolved_source_type,
                "collectorStrategy": str(strategy["strategy"]),
                "interactionMode": str(strategy["interactionMode"]),
                "requiresBrowser": bool(strategy["requiresBrowser"]),
                "reasons": list(strategy["reasons"]),
                "interactionSteps": list(strategy["interactionSteps"]),
            }
        )
    collector_strategy = summarize_job_strategy(targets)
    return {
        "specVersion": 1,
        "jobId": build_run_id("collect"),
        "jobKind": "dynamic_url_collection",
        "status": "planned",
        "label": label.strip() or f"Dynamic collection {resolved_source_type}",
        "requestedSourceType": requested_source_type.strip().lower() or "auto",
        "resolvedSourceType": resolved_source_type,
        "viaSourceType": via_source_type,
        "collectorStrategy": collector_strategy,
        "maxItems": max(1, min(120, int(max_items))),
        "urls": normalized_urls,
        "keywords": normalized_keywords[:MAX_DYNAMIC_JOB_KEYWORDS],
        "domains": domains,
        "targets": targets,
        "sourceOptions": {
            "urls": normalized_urls,
            "keywords": normalized_keywords[:MAX_DYNAMIC_JOB_KEYWORDS],
            "domains": domains,
            "max_items": max(1, min(120, int(max_items))),
            "targets": [
                {
                    "url": str(target["url"]),
                    "host": str(target["host"]),
                    "collectorStrategy": str(target["collectorStrategy"]),
                    "interactionMode": str(target["interactionMode"]),
                    "requiresBrowser": bool(target["requiresBrowser"]),
                    "interactionSteps": list(target["interactionSteps"]),
                }
                for target in targets
            ],
        },
    }


def persist_dynamic_collection_job(conn: sqlite3.Connection, job: dict[str, Any]) -> dict[str, Any]:
    created_at = now_iso()
    with conn:
        conn.execute(
            """
            INSERT INTO collection_jobs
              (job_id, job_kind, status, label, requested_source_type, resolved_source_type, via_source_type,
               collector_strategy, max_items, created_at, updated_at, job_spec_json, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(job["jobId"]),
                str(job["jobKind"]),
                str(job["status"]),
                str(job["label"]),
                str(job["requestedSourceType"]),
                str(job["resolvedSourceType"]),
                str(job["viaSourceType"]),
                str(job["collectorStrategy"]),
                int(job["maxItems"]),
                created_at,
                created_at,
                json.dumps(job, ensure_ascii=False),
                json.dumps({"createdFrom": "dynamic-url-planner"}, ensure_ascii=False),
            ),
        )
        for target in job.get("targets") or []:
            conn.execute(
                """
                INSERT INTO collection_job_targets
                  (target_id, job_id, position, url, host, resolved_source_type, collector_strategy, interaction_mode,
                   requires_browser, target_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(target["targetId"]),
                    str(job["jobId"]),
                    int(target["position"]),
                    str(target["url"]),
                    str(target["host"]),
                    str(target["resolvedSourceType"]),
                    str(target["collectorStrategy"]),
                    str(target["interactionMode"]),
                    1 if bool(target["requiresBrowser"]) else 0,
                    json.dumps(target, ensure_ascii=False),
                ),
            )
    job["createdAt"] = created_at
    job["updatedAt"] = created_at
    return job


def plan_dynamic_collection_job(
    workspace: Path,
    *,
    urls_json: str,
    keywords_json: str,
    label: str,
    requested_source_type: str,
    max_items: int,
) -> dict[str, Any]:
    urls = parse_json_list(urls_json, limit=MAX_DYNAMIC_JOB_URLS)
    keywords = parse_json_list(keywords_json, limit=MAX_DYNAMIC_JOB_KEYWORDS)
    job = build_dynamic_collection_job(
        urls=urls,
        keywords=keywords,
        seed_domains=[],
        label=label,
        requested_source_type=requested_source_type,
        max_items=max_items,
    )
    db_path = workspace / DB_PATH
    with connect_db(db_path) as conn:
        persisted = persist_dynamic_collection_job(conn, job)
    return {
        "dbPath": str(db_path),
        "job": persisted,
    }


def plan_agent_collection_job(
    workspace: Path,
    *,
    prompt: str,
    label: str,
    requested_source_type: str,
    max_items: int,
) -> dict[str, Any]:
    normalized_prompt = str(prompt or "").strip()
    if not normalized_prompt:
        raise RuntimeError("prompt is required")
    urls = extract_urls_from_prompt(normalized_prompt)
    keywords = build_prompt_keywords(normalized_prompt)
    domains = infer_domains_from_prompt(normalized_prompt)
    job = build_dynamic_collection_job(
        urls=urls,
        keywords=keywords,
        seed_domains=domains,
        label=label.strip() or f"Researcher · {normalized_prompt[:48]}",
        requested_source_type=requested_source_type,
        max_items=max_items,
    )
    job["planner"] = {
        "mode": "natural_language_request",
        "prompt": normalized_prompt,
        "derivedUrls": urls,
        "derivedKeywords": keywords,
        "derivedDomains": domains,
    }
    db_path = workspace / DB_PATH
    with connect_db(db_path) as conn:
        persisted = persist_dynamic_collection_job(conn, job)
    return {
        "dbPath": str(db_path),
        "job": persisted,
    }


def list_collection_jobs(workspace: Path) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        return {"dbPath": str(db_path), "items": []}
    with connect_db(db_path) as conn:
        rows = conn.execute(
            """
            SELECT job_id, job_kind, status, label, requested_source_type, resolved_source_type,
                   via_source_type, collector_strategy, max_items, created_at, updated_at
            FROM collection_jobs
            ORDER BY updated_at DESC
            """
        ).fetchall()
    return {
        "dbPath": str(db_path),
        "items": [
            {
                "jobId": str(row["job_id"]),
                "jobKind": str(row["job_kind"]),
                "status": str(row["status"]),
                "label": str(row["label"]),
                "requestedSourceType": str(row["requested_source_type"]),
                "resolvedSourceType": str(row["resolved_source_type"]),
                "viaSourceType": str(row["via_source_type"]),
                "collectorStrategy": str(row["collector_strategy"]),
                "maxItems": int(row["max_items"] or 0),
                "createdAt": str(row["created_at"]),
                "updatedAt": str(row["updated_at"]),
            }
            for row in rows
        ],
    }


def load_collection_job(workspace: Path, *, job_id: str) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        raise RuntimeError(f"research db not found: {db_path}")
    with connect_db(db_path) as conn:
        row = conn.execute(
            """
            SELECT job_id, created_at, updated_at, job_spec_json
            FROM collection_jobs
            WHERE job_id = ?
            """,
            (job_id.strip(),),
        ).fetchone()
        if row is None:
            raise RuntimeError(f"collection job not found: {job_id}")
        payload = json.loads(str(row["job_spec_json"] or "{}"))
        payload["createdAt"] = str(row["created_at"])
        payload["updatedAt"] = str(row["updated_at"])
    return {"dbPath": str(db_path), "job": payload}


def build_collection_job_handoff(workspace: Path, *, job_id: str, agent_role: str) -> dict[str, Any]:
    loaded = load_collection_job(workspace, job_id=job_id)
    job = dict(loaded["job"])
    handoff_id = build_run_id("handoff")
    role = str(agent_role or "researcher").strip() or "researcher"
    target_lines = []
    for target in job.get("targets") or []:
        steps = ", ".join(target.get("interactionSteps") or [])
        target_lines.append(
            f"- {target.get('url')} [{target.get('collectorStrategy')}] steps: {steps}"
        )
    prompt = "\n".join(
        [
            f"Collection job: {job.get('label')}",
            f"Resolved source type: {job.get('resolvedSourceType')}",
            f"Primary strategy: {job.get('collectorStrategy')}",
            "Targets:",
            *target_lines,
            "",
            "Collect raw evidence safely, preserve full source pointers, and summarize extraction risks.",
        ]
    ).strip()
    payload = {
        "handoffId": handoff_id,
        "jobId": str(job["jobId"]),
        "agentRole": role,
        "title": f"Collect {job.get('label')}",
        "prompt": prompt,
        "job": job,
        "sourceOptions": job.get("sourceOptions") or {},
        "preferredExecutionOrder": ["rss", "scrapling", "pinchtab"],
    }
    db_path = workspace / DB_PATH
    with connect_db(db_path) as conn:
        with conn:
            conn.execute(
                """
                INSERT INTO collection_job_handoffs
                  (handoff_id, job_id, agent_role, title, prompt, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    handoff_id,
                    str(job["jobId"]),
                    role,
                    str(payload["title"]),
                    prompt,
                    json.dumps(payload, ensure_ascii=False),
                    now_iso(),
                ),
            )
    return {"dbPath": str(db_path), "handoff": payload}


def via_run_flow_request(base_url: str, *, flow_id: int, source_type: str, source_options: dict[str, Any]) -> dict[str, Any]:
    normalized = str(base_url or "").strip().rstrip("/")
    if not normalized.startswith("http://127.0.0.1") and not normalized.startswith("http://localhost"):
        raise RuntimeError("via base url must use localhost/127.0.0.1")
    url = f"{normalized}/api/flows/{int(flow_id)}/run"
    request = Request(
        url,
        data=json.dumps(
            {
                "trigger": "research_storage.execute_job",
                "source_type": source_type,
                "source_options": source_options,
            }
        ).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=180) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
    if not isinstance(payload, dict):
        raise RuntimeError("via runtime returned invalid json payload")
    return payload


def extract_collection_result_payload(result: dict[str, Any]) -> dict[str, Any]:
    candidates = [
        result.get("detail", {}).get("payload"),
        result.get("payload"),
        result,
    ]
    for candidate in candidates:
        if isinstance(candidate, dict) and (
            isinstance(candidate.get("items_all"), list) or isinstance(candidate.get("items"), list)
        ):
            return candidate
    return {}


def extract_collection_export_path(result: dict[str, Any]) -> str:
    artifacts = result.get("artifacts")
    if not isinstance(artifacts, list):
        return ""
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        if str(artifact.get("format") or "").strip().lower() != "json":
            continue
        path = str(artifact.get("path") or "").strip()
        if path:
            return path
    return ""


def build_collection_item_key(row: dict[str, Any]) -> str:
    normalized_key = to_safe_text(row.get("normalized_key"), limit=120)
    if normalized_key:
        return normalized_key
    source_item_id = to_safe_text(row.get("id"), limit=160)
    url = to_safe_text(row.get("url"), limit=500)
    title = to_safe_text(row.get("title"), limit=220).lower()
    published_at = to_safe_text(row.get("published_at"), limit=64)
    source_name = to_safe_text(row.get("source_name"), limit=120).lower()
    return sha256_text("|".join([source_item_id, url, title, published_at, source_name]))


def normalize_collection_item(
    row: dict[str, Any],
    *,
    job_id: str,
    job_run_id: str,
    via_run_id: str,
    executed_at: str,
    raw_export_path: str,
    default_source_type: str,
) -> dict[str, Any] | None:
    url = to_safe_text(row.get("url"), limit=500)
    title = to_safe_text(row.get("title"), limit=220)
    if not url and not title:
        return None
    item_key = build_collection_item_key(row)
    item_fact_id = sha256_text(f"{job_id}:{item_key}")
    source_type = to_safe_text(row.get("source_type"), limit=64) or default_source_type or "source.news"
    source_name = to_safe_text(row.get("source_name"), limit=120)
    published_at = to_safe_text(row.get("published_at"), limit=64)
    fetched_at = to_safe_text(row.get("fetched_at"), limit=64) or executed_at
    known_fields = {
        "adapter",
        "comments",
        "content_excerpt",
        "country",
        "engagement",
        "fetched_at",
        "headline",
        "hot_rank",
        "hot_score",
        "hot_topic_hint",
        "id",
        "like_count",
        "normalized_key",
        "published_at",
        "rank",
        "repost_count",
        "score",
        "source_count",
        "source_name",
        "source_type",
        "stars_today",
        "summary",
        "title",
        "upvotes",
        "url",
        "verification_status",
        "view_count",
    }
    metadata = {key: value for key, value in row.items() if key not in known_fields}
    return {
        "itemFactId": item_fact_id,
        "jobId": job_id,
        "jobRunId": job_run_id,
        "viaRunId": via_run_id,
        "sourceType": source_type,
        "sourceName": source_name,
        "country": to_safe_text(row.get("country"), limit=32),
        "adapter": to_safe_text(row.get("adapter"), limit=120),
        "itemKey": item_key,
        "sourceItemId": to_safe_text(row.get("id"), limit=160),
        "title": title,
        "url": url,
        "summary": to_safe_text(row.get("summary"), limit=600),
        "contentExcerpt": to_safe_text(row.get("content_excerpt"), limit=1200),
        "publishedAt": published_at,
        "fetchedAt": fetched_at,
        "verificationStatus": to_safe_text(row.get("verification_status"), limit=32) or "warning",
        "score": to_safe_int(row.get("score"), 0),
        "hotScore": to_safe_int(row.get("hot_score"), 0),
        "sourceCount": max(1, to_safe_int(row.get("source_count"), 1)),
        "rawExportPath": raw_export_path,
        "metadataJson": json.dumps(metadata, ensure_ascii=False),
    }


def ingest_collection_items(
    conn: sqlite3.Connection,
    *,
    job_id: str,
    job_run_id: str,
    via_run_id: str,
    executed_at: str,
    raw_export_path: str,
    result: dict[str, Any],
    default_source_type: str,
) -> int:
    payload = extract_collection_result_payload(result)
    raw_items = payload.get("items_all")
    if not isinstance(raw_items, list):
        raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        return 0

    inserted = 0
    for row in raw_items:
        if not isinstance(row, dict):
            continue
        normalized = normalize_collection_item(
            row,
            job_id=job_id,
            job_run_id=job_run_id,
            via_run_id=via_run_id,
            executed_at=executed_at,
            raw_export_path=raw_export_path,
            default_source_type=default_source_type,
        )
        if not normalized:
            continue
        conn.execute(
            """
            INSERT INTO collection_items_fact
              (item_fact_id, job_id, job_run_id, via_run_id, source_type, source_name, country, adapter, item_key,
               source_item_id, title, url, summary, content_excerpt, published_at, fetched_at, verification_status,
               score, hot_score, source_count, raw_export_path, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id, item_key) DO UPDATE SET
              job_run_id = excluded.job_run_id,
              via_run_id = excluded.via_run_id,
              source_type = excluded.source_type,
              source_name = excluded.source_name,
              country = excluded.country,
              adapter = excluded.adapter,
              source_item_id = excluded.source_item_id,
              title = excluded.title,
              url = excluded.url,
              summary = excluded.summary,
              content_excerpt = excluded.content_excerpt,
              published_at = excluded.published_at,
              fetched_at = excluded.fetched_at,
              verification_status = excluded.verification_status,
              score = excluded.score,
              hot_score = excluded.hot_score,
              source_count = excluded.source_count,
              raw_export_path = excluded.raw_export_path,
              metadata_json = excluded.metadata_json
            """,
            (
                normalized["itemFactId"],
                normalized["jobId"],
                normalized["jobRunId"],
                normalized["viaRunId"],
                normalized["sourceType"],
                normalized["sourceName"],
                normalized["country"],
                normalized["adapter"],
                normalized["itemKey"],
                normalized["sourceItemId"],
                normalized["title"],
                normalized["url"],
                normalized["summary"],
                normalized["contentExcerpt"],
                normalized["publishedAt"],
                normalized["fetchedAt"],
                normalized["verificationStatus"],
                normalized["score"],
                normalized["hotScore"],
                normalized["sourceCount"],
                normalized["rawExportPath"],
                normalized["metadataJson"],
            ),
        )
        inserted += 1
    return inserted


def record_collection_job_run(workspace: Path, *, job_id: str, flow_id: int, result: dict[str, Any]) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    executed_at = now_iso()
    status = str(result.get("status") or "unknown")
    via_run_id = str(result.get("run_id") or result.get("runId") or "")
    job_run_id = build_run_id("jobrun")
    with connect_db(db_path) as conn:
        job_row = conn.execute(
            """
            SELECT resolved_source_type
            FROM collection_jobs
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()
        default_source_type = to_via_source_type(str(job_row["resolved_source_type"] or "news")) if job_row else "source.news"
        raw_export_path = extract_collection_export_path(result)
        with conn:
            conn.execute(
                """
                INSERT INTO collection_job_runs
                  (job_run_id, job_id, via_run_id, flow_id, status, executed_at, result_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_run_id,
                    job_id,
                    via_run_id,
                    int(flow_id),
                    status,
                    executed_at,
                    json.dumps(result, ensure_ascii=False),
                ),
            )
            conn.execute(
                """
                UPDATE collection_jobs
                SET status = ?,
                    updated_at = ?,
                    metadata_json = ?
                WHERE job_id = ?
                """,
                (
                    status,
                    executed_at,
                    json.dumps(
                        {
                            "lastViaRunId": via_run_id,
                            "lastFlowId": int(flow_id),
                            "lastStatus": status,
                            "lastExecutedAt": executed_at,
                            "lastRawExportPath": raw_export_path,
                        },
                        ensure_ascii=False,
                    ),
                    job_id,
                ),
            )
            item_count = ingest_collection_items(
                conn,
                job_id=job_id,
                job_run_id=job_run_id,
                via_run_id=via_run_id,
                executed_at=executed_at,
                raw_export_path=raw_export_path,
                result=result,
                default_source_type=default_source_type,
            )
    return {
        "jobRunId": job_run_id,
        "jobId": job_id,
        "viaRunId": via_run_id,
        "flowId": int(flow_id),
        "status": status,
        "executedAt": executed_at,
        "itemCount": item_count,
        "rawExportPath": raw_export_path,
        "result": result,
    }


def execute_collection_job(workspace: Path, *, job_id: str, via_base_url: str, flow_id: int) -> dict[str, Any]:
    loaded = load_collection_job(workspace, job_id=job_id)
    job = dict(loaded["job"])
    result = via_run_flow_request(
        via_base_url,
        flow_id=int(flow_id),
        source_type=str(job.get("viaSourceType") or "source.news"),
        source_options=dict(job.get("sourceOptions") or {}),
    )
    recorded = record_collection_job_run(workspace, job_id=str(job["jobId"]), flow_id=int(flow_id), result=result)
    return {
        "dbPath": str(workspace / DB_PATH),
        "job": job,
        "execution": recorded,
    }


def record_collection_job_run_command(workspace: Path, *, job_id: str, flow_id: int, result_json: str) -> dict[str, Any]:
    try:
        result = json.loads(result_json)
    except Exception as exc:
        raise RuntimeError(f"invalid result json: {exc}") from exc
    if not isinstance(result, dict):
        raise RuntimeError("result json must be an object")
    recorded = record_collection_job_run(workspace, job_id=job_id, flow_id=flow_id, result=result)
    return {"dbPath": str(workspace / DB_PATH), "execution": recorded}


def promote_steam_cache(workspace: Path) -> dict[str, Any]:
    cache_files = discover_cache_files(workspace)
    if not cache_files:
        raise RuntimeError(f"no Steam cache files found under {(workspace / CACHE_ROOT)}")

    run_id = build_run_id("steam")
    raw_root = workspace / RAW_ROOT / run_id
    docs: list[dict[str, Any]] = []
    game_keys: set[str] = set()
    review_count = 0

    for cache_path in cache_files:
        game_slug = cache_path.parent.name
        payload = read_json(cache_path)
        source_url = str(payload.get("url") or "")
        fetched_at = str(payload.get("fetchedAt") or now_iso())
        appid = parse_appid(source_url)
        game_key = f"steam:{appid}"
        game_name = infer_game_name(game_slug, appid)
        relative_path = Path(game_slug) / cache_path.name
        promoted_path = raw_root / relative_path
        ensure_parent(promoted_path)
        shutil.copy2(cache_path, promoted_path)
        promoted_bytes = promoted_path.read_bytes()
        review_rows = payload.get("payload", {}).get("reviews", [])
        docs.append(
            {
                "rawId": sha256_text(f"{run_id}:{relative_path.as_posix()}"),
                "gameKey": game_key,
                "gameSlug": game_slug,
                "gameName": game_name,
                "appid": appid,
                "pageIndex": parse_page_index(cache_path),
                "sourceUrl": source_url,
                "fetchedAt": fetched_at,
                "rawPath": str(promoted_path),
                "sha256": sha256_bytes(promoted_bytes),
                "querySummary": payload.get("payload", {}).get("query_summary") or {},
                "payload": payload.get("payload") or {},
                "reviewCount": len(review_rows) if isinstance(review_rows, list) else 0,
            }
        )
        game_keys.add(game_key)
        review_count += len(review_rows) if isinstance(review_rows, list) else 0

    manifest = {
        "runId": run_id,
        "source": "steam",
        "collector": "steam-review-probe-cache-import",
        "collectedAt": now_iso(),
        "workspace": str(workspace),
        "rawRoot": str(raw_root),
        "gameCount": len(game_keys),
        "rawDocumentCount": len(docs),
        "reviewCount": review_count,
        "documents": [
            {
                "rawId": row["rawId"],
                "gameKey": row["gameKey"],
                "gameSlug": row["gameSlug"],
                "gameName": row["gameName"],
                "appid": row["appid"],
                "pageIndex": row["pageIndex"],
                "sourceUrl": row["sourceUrl"],
                "fetchedAt": row["fetchedAt"],
                "rawPath": row["rawPath"],
                "sha256": row["sha256"],
                "reviewCount": row["reviewCount"],
            }
            for row in docs
        ],
    }
    manifest_path = raw_root / "manifest.json"
    write_json(manifest_path, manifest)
    manifest["manifestPath"] = str(manifest_path)
    manifest["_documents"] = docs
    return manifest


def ingest_manifest(conn: sqlite3.Connection, manifest: dict[str, Any]) -> dict[str, Any]:
    run_id = str(manifest["runId"])
    docs = list(manifest.get("_documents") or [])
    collected_at = str(manifest["collectedAt"])
    manifest_path = str(manifest["manifestPath"])

    with conn:
        conn.execute(
            """
            INSERT INTO collection_runs
              (run_id, source, collector, collected_at, raw_root, manifest_path, game_count, raw_document_count, review_count, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                "steam",
                str(manifest.get("collector") or "steam-review-probe-cache-import"),
                collected_at,
                str(manifest["rawRoot"]),
                manifest_path,
                int(manifest["gameCount"]),
                int(manifest["rawDocumentCount"]),
                int(manifest["reviewCount"]),
                json.dumps({"workspace": manifest.get("workspace", "")}, ensure_ascii=False),
            ),
        )

        for doc in docs:
            game_key = str(doc["gameKey"])
            appid = str(doc["appid"])
            created_at = collected_at
            conn.execute(
                """
                INSERT INTO game_dim
                  (game_key, source, source_game_id, slug, name, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(game_key) DO UPDATE SET
                  slug = excluded.slug,
                  name = excluded.name,
                  metadata_json = excluded.metadata_json,
                  updated_at = excluded.updated_at
                """,
                (
                    game_key,
                    "steam",
                    appid,
                    str(doc["gameSlug"]),
                    str(doc["gameName"]),
                    json.dumps({"appid": appid}, ensure_ascii=False),
                    created_at,
                    created_at,
                ),
            )
            conn.execute(
                """
                INSERT INTO raw_documents
                  (raw_id, run_id, source, game_key, page_index, raw_path, source_url, fetched_at, sha256, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(doc["rawId"]),
                    run_id,
                    "steam",
                    game_key,
                    int(doc["pageIndex"]),
                    str(doc["rawPath"]),
                    str(doc["sourceUrl"]),
                    str(doc["fetchedAt"]),
                    str(doc["sha256"]),
                    json.dumps({"querySummary": doc.get("querySummary") or {}}, ensure_ascii=False),
                ),
            )
            payload = doc.get("payload") or {}
            reviews = payload.get("reviews") or []
            for index, review in enumerate(reviews):
                if not isinstance(review, dict):
                    continue
                body = " ".join(str(review.get("review") or "").split()).strip()
                if not body:
                    continue
                source_item_id = str(review.get("recommendationid") or f"{doc['rawId']}:{index}")
                author = review.get("author") or {}
                timestamp_created = int(review.get("timestamp_created") or 0)
                created_iso = (
                    datetime.fromtimestamp(timestamp_created, tz=timezone.utc).isoformat()
                    if timestamp_created > 0
                    else collected_at
                )
                rating_direction = "positive" if bool(review.get("voted_up")) else "negative"
                review_key = sha256_text(f"{run_id}:{source_item_id}:{index}")
                author_id = str(author.get("steamid") or "")
                author_id_hash = sha256_text(author_id) if author_id else ""
                playtime_hours = round(float(author.get("playtime_forever") or 0) / 60.0, 1)
                metadata = {
                    "commentCount": int(review.get("comment_count") or 0),
                    "steamPurchase": bool(review.get("steam_purchase")),
                    "receivedForFree": bool(review.get("received_for_free")),
                    "refunded": bool(review.get("refunded")),
                    "writtenDuringEarlyAccess": bool(review.get("written_during_early_access")),
                    "primarilySteamDeck": bool(review.get("primarily_steam_deck")),
                    "timestampUpdated": int(review.get("timestamp_updated") or 0),
                    "reactions": review.get("reactions") or [],
                }
                conn.execute(
                    """
                    INSERT INTO reviews_fact
                      (review_key, run_id, source, source_item_id, game_key, game_name, title, body, lang, author_id_hash,
                       rating_direction, rating_numeric, helpful_votes, funny_votes, playtime_hours, created_at, collected_at,
                       raw_id, raw_path, metadata_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        review_key,
                        run_id,
                        "steam",
                        source_item_id,
                        game_key,
                        str(doc["gameName"]),
                        "",
                        body,
                        str(review.get("language") or ""),
                        author_id_hash,
                        rating_direction,
                        1.0 if rating_direction == "positive" else 0.0,
                        int(review.get("votes_up") or 0),
                        int(review.get("votes_funny") or 0),
                        playtime_hours,
                        created_iso,
                        collected_at,
                        str(doc["rawId"]),
                        str(doc["rawPath"]),
                        json.dumps(metadata, ensure_ascii=False),
                    ),
                )

    return {
        "runId": run_id,
        "source": "steam",
        "dbPath": str(conn.execute("PRAGMA database_list").fetchone()["file"]),
        "rawRoot": str(manifest["rawRoot"]),
        "manifestPath": manifest_path,
        "games": int(manifest["gameCount"]),
        "rawDocuments": int(manifest["rawDocumentCount"]),
        "reviews": int(manifest["reviewCount"]),
    }


def ingest_steam_cache(workspace: Path) -> dict[str, Any]:
    manifest = promote_steam_cache(workspace)
    db_path = workspace / DB_PATH
    with connect_db(db_path) as conn:
        result = ingest_manifest(conn, manifest)
    return result


def load_overview(workspace: Path) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        return {
            "dbPath": str(db_path),
            "totals": {"runs": 0, "games": 0, "rawDocuments": 0, "reviews": 0, "collectionItems": 0},
            "runs": [],
        }
    with connect_db(db_path) as conn:
        runs = [
            dict(row)
            for row in conn.execute(
                """
                SELECT run_id, source, collector, collected_at, raw_root, manifest_path,
                       game_count, raw_document_count, review_count
                FROM collection_runs
                ORDER BY collected_at DESC
                """
            ).fetchall()
        ]
        counts = conn.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM collection_runs) AS runs,
              (SELECT COUNT(*) FROM game_dim) AS games,
              (SELECT COUNT(*) FROM raw_documents) AS raw_documents,
              (SELECT COUNT(*) FROM reviews_fact) AS reviews,
              (SELECT COUNT(*) FROM collection_items_fact) AS collection_items
            """
        ).fetchone()
    return {
        "dbPath": str(db_path),
        "totals": {
            "runs": int(counts["runs"] or 0),
            "games": int(counts["games"] or 0),
            "rawDocuments": int(counts["raw_documents"] or 0),
            "reviews": int(counts["reviews"] or 0),
            "collectionItems": int(counts["collection_items"] or 0),
        },
        "runs": [
            {
                "runId": str(row["run_id"]),
                "source": str(row["source"]),
                "collector": str(row["collector"]),
                "collectedAt": str(row["collected_at"]),
                "rawRoot": str(row["raw_root"]),
                "manifestPath": str(row["manifest_path"]),
                "gameCount": int(row["game_count"] or 0),
                "rawDocumentCount": int(row["raw_document_count"] or 0),
                "reviewCount": int(row["review_count"] or 0),
            }
            for row in runs
        ],
    }


def query_reviews(
    workspace: Path,
    *,
    source: str,
    game_key: str,
    sentiment: str,
    language: str,
    search: str,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        return {"dbPath": str(db_path), "total": 0, "items": []}

    where = ["1 = 1"]
    params: list[Any] = []
    if source.strip():
        where.append("source = ?")
        params.append(source.strip())
    if game_key.strip():
        where.append("game_key = ?")
        params.append(game_key.strip())
    if sentiment.strip():
        where.append("rating_direction = ?")
        params.append(sentiment.strip().lower())
    if language.strip():
        where.append("lang = ?")
        params.append(language.strip())
    if search.strip():
        where.append("LOWER(body) LIKE ?")
        params.append(f"%{search.strip().lower()}%")

    where_sql = " AND ".join(where)
    safe_limit = max(1, min(200, int(limit)))
    safe_offset = max(0, int(offset))

    with connect_db(db_path) as conn:
        total = int(
            conn.execute(f"SELECT COUNT(*) AS count FROM reviews_fact WHERE {where_sql}", params).fetchone()["count"] or 0
        )
        rows = conn.execute(
            f"""
            SELECT review_key, run_id, source, source_item_id, game_key, game_name, body, lang, rating_direction,
                   rating_numeric, helpful_votes, funny_votes, playtime_hours, created_at, collected_at, raw_id, raw_path
            FROM reviews_fact
            WHERE {where_sql}
            ORDER BY created_at DESC, helpful_votes DESC, review_key ASC
            LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        ).fetchall()

    return {
        "dbPath": str(db_path),
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [
            {
                "reviewKey": str(row["review_key"]),
                "runId": str(row["run_id"]),
                "source": str(row["source"]),
                "sourceItemId": str(row["source_item_id"]),
                "gameKey": str(row["game_key"]),
                "gameName": str(row["game_name"]),
                "body": str(row["body"]),
                "language": str(row["lang"]),
                "ratingDirection": str(row["rating_direction"]),
                "ratingNumeric": float(row["rating_numeric"] or 0.0),
                "helpfulVotes": int(row["helpful_votes"] or 0),
                "funnyVotes": int(row["funny_votes"] or 0),
                "playtimeHours": float(row["playtime_hours"] or 0.0),
                "createdAt": str(row["created_at"]),
                "collectedAt": str(row["collected_at"]),
                "rawId": str(row["raw_id"]),
                "rawPath": str(row["raw_path"]),
            }
            for row in rows
        ],
    }


def list_games(workspace: Path, *, source: str) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        return {"dbPath": str(db_path), "items": []}

    with connect_db(db_path) as conn:
        rows = conn.execute(
            """
            SELECT game_dim.game_key, game_dim.source, game_dim.source_game_id, game_dim.slug, game_dim.name,
                   COUNT(reviews_fact.review_key) AS review_count,
                   MAX(reviews_fact.created_at) AS latest_review_at
            FROM game_dim
            LEFT JOIN reviews_fact ON reviews_fact.game_key = game_dim.game_key
            WHERE game_dim.source = ?
            GROUP BY game_dim.game_key, game_dim.source, game_dim.source_game_id, game_dim.slug, game_dim.name
            ORDER BY review_count DESC, game_dim.name ASC
            """,
            (source.strip() or "steam",),
        ).fetchall()

    return {
        "dbPath": str(db_path),
        "items": [
            {
                "gameKey": str(row["game_key"]),
                "source": str(row["source"]),
                "sourceGameId": str(row["source_game_id"]),
                "slug": str(row["slug"]),
                "name": str(row["name"]),
                "reviewCount": int(row["review_count"] or 0),
                "latestReviewAt": str(row["latest_review_at"] or ""),
            }
            for row in rows
        ],
    }


def game_metrics(workspace: Path, *, source: str) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        return {"dbPath": str(db_path), "items": []}

    with connect_db(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
              game_key,
              game_name,
              COUNT(*) AS total_reviews,
              SUM(CASE WHEN rating_direction = 'positive' THEN 1 ELSE 0 END) AS positive_reviews,
              SUM(CASE WHEN rating_direction = 'negative' THEN 1 ELSE 0 END) AS negative_reviews,
              COUNT(DISTINCT lang) AS language_count,
              AVG(CAST(helpful_votes AS REAL)) AS avg_helpful_votes,
              AVG(CAST(playtime_hours AS REAL)) AS avg_playtime_hours,
              MAX(created_at) AS latest_review_at
            FROM reviews_fact
            WHERE source = ?
            GROUP BY game_key, game_name
            ORDER BY total_reviews DESC, game_name ASC
            """,
            (source.strip() or "steam",),
        ).fetchall()

    return {
        "dbPath": str(db_path),
        "items": [
            {
                "gameKey": str(row["game_key"]),
                "gameName": str(row["game_name"]),
                "totalReviews": int(row["total_reviews"] or 0),
                "positiveReviews": int(row["positive_reviews"] or 0),
                "negativeReviews": int(row["negative_reviews"] or 0),
                "positiveRatio": round(
                    int(row["positive_reviews"] or 0) / max(1, int(row["total_reviews"] or 0)),
                    4,
                ),
                "languageCount": int(row["language_count"] or 0),
                "avgHelpfulVotes": round(float(row["avg_helpful_votes"] or 0.0), 2),
                "avgPlaytimeHours": round(float(row["avg_playtime_hours"] or 0.0), 2),
                "latestReviewAt": str(row["latest_review_at"] or ""),
            }
            for row in rows
        ],
    }


def sentiment_series(workspace: Path, *, source: str, game_key: str, limit: int) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        return {"dbPath": str(db_path), "gameKey": game_key, "items": []}

    safe_limit = max(1, min(365, int(limit)))
    with connect_db(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
              substr(created_at, 1, 10) AS bucket_date,
              COUNT(*) AS total_reviews,
              SUM(CASE WHEN rating_direction = 'positive' THEN 1 ELSE 0 END) AS positive_reviews,
              SUM(CASE WHEN rating_direction = 'negative' THEN 1 ELSE 0 END) AS negative_reviews
            FROM reviews_fact
            WHERE source = ? AND game_key = ?
            GROUP BY substr(created_at, 1, 10)
            ORDER BY bucket_date DESC
            LIMIT ?
            """,
            (source.strip() or "steam", game_key.strip(), safe_limit),
        ).fetchall()
    ordered = list(reversed(rows))
    return {
        "dbPath": str(db_path),
        "source": source.strip() or "steam",
        "gameKey": game_key.strip(),
        "items": [
            {
                "bucketDate": str(row["bucket_date"]),
                "totalReviews": int(row["total_reviews"] or 0),
                "positiveReviews": int(row["positive_reviews"] or 0),
                "negativeReviews": int(row["negative_reviews"] or 0),
            }
            for row in ordered
        ],
    }


def list_collection_items(
    workspace: Path,
    *,
    job_id: str,
    source_type: str,
    verification_status: str,
    search: str,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        return {"dbPath": str(db_path), "total": 0, "limit": limit, "offset": offset, "items": []}

    where = ["1 = 1"]
    params: list[Any] = []
    if job_id.strip():
        where.append("job_id = ?")
        params.append(job_id.strip())
    if source_type.strip():
        where.append("source_type = ?")
        params.append(source_type.strip())
    if verification_status.strip():
        where.append("verification_status = ?")
        params.append(verification_status.strip())
    if search.strip():
        where.append("(LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(content_excerpt) LIKE ?)")
        needle = f"%{search.strip().lower()}%"
        params.extend([needle, needle, needle])

    where_sql = " AND ".join(where)
    safe_limit = max(1, min(200, int(limit)))
    safe_offset = max(0, int(offset))
    with connect_db(db_path) as conn:
        total = int(
            conn.execute(f"SELECT COUNT(*) AS count FROM collection_items_fact WHERE {where_sql}", params).fetchone()["count"] or 0
        )
        rows = conn.execute(
            f"""
            SELECT item_fact_id, job_id, job_run_id, via_run_id, source_type, source_name, country, adapter, item_key,
                   source_item_id, title, url, summary, content_excerpt, published_at, fetched_at, verification_status,
                   score, hot_score, source_count, raw_export_path
            FROM collection_items_fact
            WHERE {where_sql}
            ORDER BY score DESC, published_at DESC, title ASC
            LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        ).fetchall()
    return {
        "dbPath": str(db_path),
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [
            {
                "itemFactId": str(row["item_fact_id"]),
                "jobId": str(row["job_id"]),
                "jobRunId": str(row["job_run_id"]),
                "viaRunId": str(row["via_run_id"]),
                "sourceType": str(row["source_type"]),
                "sourceName": str(row["source_name"]),
                "country": str(row["country"]),
                "adapter": str(row["adapter"]),
                "itemKey": str(row["item_key"]),
                "sourceItemId": str(row["source_item_id"]),
                "title": str(row["title"]),
                "url": str(row["url"]),
                "summary": str(row["summary"]),
                "contentExcerpt": str(row["content_excerpt"]),
                "publishedAt": str(row["published_at"]),
                "fetchedAt": str(row["fetched_at"]),
                "verificationStatus": str(row["verification_status"]),
                "score": int(row["score"] or 0),
                "hotScore": int(row["hot_score"] or 0),
                "sourceCount": int(row["source_count"] or 1),
                "rawExportPath": str(row["raw_export_path"]),
            }
            for row in rows
        ],
    }


def collection_metrics(workspace: Path, *, job_id: str) -> dict[str, Any]:
    db_path = workspace / DB_PATH
    if not db_path.exists():
        return {
            "dbPath": str(db_path),
            "jobId": job_id.strip(),
            "totals": {"items": 0, "sources": 0, "verified": 0, "warnings": 0, "conflicted": 0, "avgScore": 0, "avgHotScore": 0},
            "bySourceType": [],
            "byVerificationStatus": [],
            "timeline": [],
            "topSources": [],
        }

    where_sql = "job_id = ?" if job_id.strip() else "1 = 1"
    params: list[Any] = [job_id.strip()] if job_id.strip() else []
    with connect_db(db_path) as conn:
        counts = conn.execute(
            f"""
            SELECT
              COUNT(*) AS items,
              COUNT(DISTINCT source_name) AS sources,
              SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) AS verified,
              SUM(CASE WHEN verification_status = 'warning' THEN 1 ELSE 0 END) AS warnings,
              SUM(CASE WHEN verification_status = 'conflicted' THEN 1 ELSE 0 END) AS conflicted,
              AVG(CAST(score AS REAL)) AS avg_score,
              AVG(CAST(hot_score AS REAL)) AS avg_hot_score
            FROM collection_items_fact
            WHERE {where_sql}
            """,
            params,
        ).fetchone()
        by_source_rows = conn.execute(
            f"""
            SELECT source_type, COUNT(*) AS item_count, AVG(CAST(score AS REAL)) AS avg_score,
                   AVG(CAST(hot_score AS REAL)) AS avg_hot_score
            FROM collection_items_fact
            WHERE {where_sql}
            GROUP BY source_type
            ORDER BY item_count DESC, source_type ASC
            """,
            params,
        ).fetchall()
        by_verification_rows = conn.execute(
            f"""
            SELECT verification_status, COUNT(*) AS item_count
            FROM collection_items_fact
            WHERE {where_sql}
            GROUP BY verification_status
            ORDER BY item_count DESC, verification_status ASC
            """,
            params,
        ).fetchall()
        timeline_rows = conn.execute(
            f"""
            SELECT substr(COALESCE(NULLIF(published_at, ''), fetched_at), 1, 10) AS bucket_date,
                   COUNT(*) AS item_count
            FROM collection_items_fact
            WHERE {where_sql}
            GROUP BY substr(COALESCE(NULLIF(published_at, ''), fetched_at), 1, 10)
            ORDER BY bucket_date DESC
            LIMIT 30
            """,
            params,
        ).fetchall()
        top_source_rows = conn.execute(
            f"""
            SELECT source_name, COUNT(*) AS item_count
            FROM collection_items_fact
            WHERE {where_sql}
            GROUP BY source_name
            ORDER BY item_count DESC, source_name ASC
            LIMIT 8
            """,
            params,
        ).fetchall()
    return {
        "dbPath": str(db_path),
        "jobId": job_id.strip(),
        "totals": {
            "items": int(counts["items"] or 0),
            "sources": int(counts["sources"] or 0),
            "verified": int(counts["verified"] or 0),
            "warnings": int(counts["warnings"] or 0),
            "conflicted": int(counts["conflicted"] or 0),
            "avgScore": round(float(counts["avg_score"] or 0.0), 2),
            "avgHotScore": round(float(counts["avg_hot_score"] or 0.0), 2),
        },
        "bySourceType": [
            {
                "sourceType": str(row["source_type"]),
                "itemCount": int(row["item_count"] or 0),
                "avgScore": round(float(row["avg_score"] or 0.0), 2),
                "avgHotScore": round(float(row["avg_hot_score"] or 0.0), 2),
            }
            for row in by_source_rows
        ],
        "byVerificationStatus": [
            {
                "verificationStatus": str(row["verification_status"] or "warning"),
                "itemCount": int(row["item_count"] or 0),
            }
            for row in by_verification_rows
        ],
        "timeline": [
            {
                "bucketDate": str(row["bucket_date"] or ""),
                "itemCount": int(row["item_count"] or 0),
            }
            for row in reversed(timeline_rows)
            if str(row["bucket_date"] or "").strip()
        ],
        "topSources": [
            {
                "sourceName": str(row["source_name"] or ""),
                "itemCount": int(row["item_count"] or 0),
            }
            for row in top_source_rows
        ],
    }


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def main() -> int:
    args = parse_args()
    workspace = normalize_workspace(args.workspace)
    if args.command == "ingest-steam-cache":
        return emit(ingest_steam_cache(workspace))
    if args.command == "overview":
        return emit(load_overview(workspace))
    if args.command == "query-reviews":
        return emit(
            query_reviews(
                workspace,
                source=str(args.source or ""),
                game_key=str(args.game_key or ""),
                sentiment=str(args.sentiment or ""),
                language=str(args.language or ""),
                search=str(args.search or ""),
                limit=int(args.limit or 50),
                offset=int(args.offset or 0),
            )
        )
    if args.command == "list-games":
        return emit(list_games(workspace, source=str(args.source or "steam")))
    if args.command == "game-metrics":
        return emit(game_metrics(workspace, source=str(args.source or "steam")))
    if args.command == "sentiment-series":
        return emit(
            sentiment_series(
                workspace,
                source=str(args.source or "steam"),
                game_key=str(args.game_key or ""),
                limit=int(args.limit or 90),
            )
        )
    if args.command == "plan-dynamic-job":
        return emit(
            plan_dynamic_collection_job(
                workspace,
                urls_json=str(args.urls_json or "[]"),
                keywords_json=str(args.keywords_json or "[]"),
                label=str(args.label or ""),
                requested_source_type=str(args.requested_source_type or "auto"),
                max_items=int(args.max_items or 40),
            )
        )
    if args.command == "plan-agent-job":
        return emit(
            plan_agent_collection_job(
                workspace,
                prompt=str(args.prompt or ""),
                label=str(args.label or ""),
                requested_source_type=str(args.requested_source_type or "auto"),
                max_items=int(args.max_items or 40),
            )
        )
    if args.command == "list-jobs":
        return emit(list_collection_jobs(workspace))
    if args.command == "load-job":
        return emit(load_collection_job(workspace, job_id=str(args.job_id or "")))
    if args.command == "build-job-handoff":
        return emit(
            build_collection_job_handoff(
                workspace,
                job_id=str(args.job_id or ""),
                agent_role=str(args.agent_role or "researcher"),
            )
        )
    if args.command == "list-collection-items":
        return emit(
            list_collection_items(
                workspace,
                job_id=str(args.job_id or ""),
                source_type=str(args.source_type or ""),
                verification_status=str(args.verification_status or ""),
                search=str(args.search or ""),
                limit=int(args.limit or 50),
                offset=int(args.offset or 0),
            )
        )
    if args.command == "collection-metrics":
        return emit(collection_metrics(workspace, job_id=str(args.job_id or "")))
    if args.command == "execute-job":
        return emit(
            execute_collection_job(
                workspace,
                job_id=str(args.job_id or ""),
                via_base_url=str(args.via_base_url or ""),
                flow_id=int(args.flow_id or 1),
            )
        )
    if args.command == "record-job-run":
        return emit(
            record_collection_job_run_command(
                workspace,
                job_id=str(args.job_id or ""),
                flow_id=int(args.flow_id or 1),
                result_json=str(args.result_json or "{}"),
            )
        )
    raise RuntimeError(f"unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
