#!/usr/bin/env python3
"""Embedded VIA runtime for RAIL.

Local-only HTTP API endpoints:
- GET /health
- GET /api/flows
- GET /api/flows/{flow_id}
- POST /api/flows/{flow_id}/run
- GET /api/runs/{run_id}
- GET /api/runs/{run_id}/artifacts
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib
import ipaddress
import inspect
import json
import os
import re
import secrets
import socket
import sqlite3
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

APP_NAME = "RAIL Embedded VIA"
APP_ENV = "local"
APP_VERSION = "0.2.0"
TIMEZONE = "Asia/Seoul"
USER_AGENT = "RAIL-Embedded-VIA/0.2"
REQUEST_TIMEOUT_SECONDS = 9
MAX_ITEMS_PER_TARGET = 6
MAX_TOTAL_ITEMS = 160
CONTENT_ENRICH_MAX_ITEMS = 28
CONTENT_ENRICH_MIN_SUMMARY_CHARS = 120
CONTENT_TEXT_MAX_CHARS = 4000
CONTENT_ENRICH_MAX_ITEMS_ENV = "RAIL_VIA_CONTENT_ENRICH_MAX_ITEMS"
CONTENT_TEXT_MAX_CHARS_ENV = "RAIL_VIA_CONTENT_TEXT_MAX_CHARS"
PINCHTAB_BASE_URL_ENV = "RAIL_VIA_PINCHTAB_BASE_URL"
PINCHTAB_TOKEN_ENV = "RAIL_VIA_PINCHTAB_TOKEN"
PINCHTAB_ENABLED_ENV = "RAIL_VIA_PINCHTAB_ENABLED"
PINCHTAB_STEALTH_ENV = "RAIL_VIA_PINCHTAB_STEALTH"
PINCHTAB_PROFILE_ID_ENV = "RAIL_VIA_PINCHTAB_PROFILE_ID"
PINCHTAB_BLOCK_ADS_ENV = "RAIL_VIA_PINCHTAB_BLOCK_ADS"
PINCHTAB_BLOCK_IMAGES_ENV = "RAIL_VIA_PINCHTAB_BLOCK_IMAGES"
PINCHTAB_BLOCK_MEDIA_ENV = "RAIL_VIA_PINCHTAB_BLOCK_MEDIA"
PINCHTAB_STARTUP_DELAY_ENV = "RAIL_VIA_PINCHTAB_STARTUP_DELAY_SEC"
PINCHTAB_TARGET_DELAY_ENV = "RAIL_VIA_PINCHTAB_TARGET_DELAY_SEC"
PINCHTAB_TAB_READ_DELAY_ENV = "RAIL_VIA_PINCHTAB_TAB_READ_DELAY_SEC"
SCRAPLING_ENABLED_ENV = "RAIL_VIA_SCRAPLING_ENABLED"
SCRAPLING_STEALTH_ENV = "RAIL_VIA_SCRAPLING_STEALTH"
SCRAPLING_TIMEOUT_ENV = "RAIL_VIA_SCRAPLING_TIMEOUT_SEC"
TRANSLATE_TO_KO_ENV = "RAIL_VIA_TRANSLATE_TO_KO"
CODEX_EXEC_ENABLED_ENV = "RAIL_VIA_CODEX_EXEC_ENABLED"
CODEX_EXEC_BIN_ENV = "RAIL_VIA_CODEX_BIN"
CODEX_EXEC_MODEL_ENV = "RAIL_VIA_CODEX_MODEL"
CODEX_EXEC_TIMEOUT_ENV = "RAIL_VIA_CODEX_TIMEOUT_SEC"
DEFAULT_PINCHTAB_BASE_URL = "http://127.0.0.1:9867"
PINCHTAB_DEFAULT_MODE = "headless"
PINCHTAB_STARTUP_DELAY_SECONDS = 1.1
PINCHTAB_TARGET_DELAY_SECONDS = 0.55
PINCHTAB_TAB_READ_DELAY_SECONDS = 0.65
SCRAPLING_DEFAULT_TIMEOUT_SECONDS = 18

SOURCE_TYPE_SNS = "source.sns"
SOURCE_TYPE_COMMUNITY = "source.community"
SOURCE_TYPE_DEV = "source.dev"
SOURCE_TYPE_MARKET = "source.market"

LEGACY_SOURCE_TYPE_MAP: dict[str, str] = {
    "source.x": SOURCE_TYPE_SNS,
    "source.threads": SOURCE_TYPE_SNS,
    "source.reddit": SOURCE_TYPE_COMMUNITY,
    "source.hn": SOURCE_TYPE_DEV,
}

DEFAULT_FLOW_NODES: list[dict[str, Any]] = [
    {
        "id": "manual_start",
        "type": "trigger.manual",
        "label": "수동 시작",
        "position": {"x": 80, "y": 120},
        "config": {"retry": 0, "fail_policy": "halt"},
    },
    {
        "id": "news_source",
        "type": "source.news",
        "label": "뉴스 수집 (미/일/중/한)",
        "position": {"x": 300, "y": 20},
        "config": {"limit": 48, "retry": 1, "fail_policy": "continue_with_warning"},
    },
    {
        "id": "sns_source",
        "type": SOURCE_TYPE_SNS,
        "label": "SNS 수집 (X+Threads)",
        "position": {"x": 300, "y": 110},
        "config": {"limit": 40, "retry": 1, "fail_policy": "continue_with_warning"},
    },
    {
        "id": "community_source",
        "type": SOURCE_TYPE_COMMUNITY,
        "label": "커뮤니티 수집 (미/일/중/한)",
        "position": {"x": 300, "y": 200},
        "config": {"limit": 40, "retry": 1, "fail_policy": "continue_with_warning"},
    },
    {
        "id": "dev_source",
        "type": SOURCE_TYPE_DEV,
        "label": "개발 커뮤니티 수집",
        "position": {"x": 300, "y": 290},
        "config": {"limit": 40, "retry": 1, "fail_policy": "continue_with_warning"},
    },
    {
        "id": "market_source",
        "type": SOURCE_TYPE_MARKET,
        "label": "주식/시장 수집",
        "position": {"x": 300, "y": 380},
        "config": {"limit": 40, "retry": 1, "fail_policy": "continue_with_warning"},
    },
    {
        "id": "normalize",
        "type": "transform.normalize",
        "label": "정규화",
        "position": {"x": 560, "y": 210},
        "config": {"limit": 140, "retry": 0, "fail_policy": "halt"},
    },
    {
        "id": "verify",
        "type": "transform.verify",
        "label": "검증",
        "position": {"x": 770, "y": 210},
        "config": {"retry": 0, "fail_policy": "continue_with_warning"},
    },
    {
        "id": "rank",
        "type": "transform.rank",
        "label": "우선순위",
        "position": {"x": 980, "y": 210},
        "config": {"limit": 40, "retry": 0, "fail_policy": "halt"},
    },
    {
        "id": "codex",
        "type": "agent.codex",
        "label": "핵심 요약 생성",
        "position": {"x": 1190, "y": 210},
        "config": {"topic": "Global RAG briefing", "retry": 0, "fail_policy": "continue_with_warning"},
    },
    {
        "id": "export",
        "type": "export.rag",
        "label": "문서 내보내기",
        "position": {"x": 1410, "y": 210},
        "config": {"retry": 0, "fail_policy": "halt"},
    },
]

DEFAULT_FLOW_EDGES: list[dict[str, Any]] = [
    {"id": "e-manual-news", "from_node": "manual_start", "to_node": "news_source", "condition": {}},
    {"id": "e-manual-sns", "from_node": "manual_start", "to_node": "sns_source", "condition": {}},
    {"id": "e-manual-community", "from_node": "manual_start", "to_node": "community_source", "condition": {}},
    {"id": "e-manual-dev", "from_node": "manual_start", "to_node": "dev_source", "condition": {}},
    {"id": "e-manual-market", "from_node": "manual_start", "to_node": "market_source", "condition": {}},
    {"id": "e-news-normalize", "from_node": "news_source", "to_node": "normalize", "condition": {}},
    {"id": "e-sns-normalize", "from_node": "sns_source", "to_node": "normalize", "condition": {}},
    {"id": "e-community-normalize", "from_node": "community_source", "to_node": "normalize", "condition": {}},
    {"id": "e-dev-normalize", "from_node": "dev_source", "to_node": "normalize", "condition": {}},
    {"id": "e-market-normalize", "from_node": "market_source", "to_node": "normalize", "condition": {}},
    {"id": "e-normalize-verify", "from_node": "normalize", "to_node": "verify", "condition": {}},
    {"id": "e-verify-rank", "from_node": "verify", "to_node": "rank", "condition": {}},
    {"id": "e-rank-codex", "from_node": "rank", "to_node": "codex", "condition": {}},
    {"id": "e-codex-export", "from_node": "codex", "to_node": "export", "condition": {}},
]

SOURCE_TYPE_WEIGHT: dict[str, int] = {
    "source.news": 72,
    SOURCE_TYPE_SNS: 56,
    SOURCE_TYPE_COMMUNITY: 61,
    SOURCE_TYPE_DEV: 66,
    SOURCE_TYPE_MARKET: 78,
}

SOURCE_TYPE_LABEL: dict[str, str] = {
    "source.news": "뉴스",
    SOURCE_TYPE_SNS: "SNS",
    SOURCE_TYPE_COMMUNITY: "커뮤니티",
    SOURCE_TYPE_DEV: "개발 커뮤니티",
    SOURCE_TYPE_MARKET: "주식/마켓",
}

HOT_TOPIC_KEYWORDS = {
    "breaking",
    "live",
    "hot",
    "trending",
    "trend",
    "top",
    "most read",
    "most viewed",
    "viral",
    "급상승",
    "실시간",
    "인기",
    "핫",
    "속보",
    "랭킹",
    "트렌드",
    "热搜",
    "热门",
    "实时",
    "排行",
    "バズ",
    "人気",
    "速報",
    "トレンド",
    "ランキング",
}

HOT_URL_MARKERS = {
    "ranking",
    "popular",
    "trending",
    "top",
    "hot",
    "mostread",
    "most-viewed",
    "hotentry",
}

TRUSTED_DOMAINS = {
    "news.google.com",
    "news.naver.com",
    "n.news.naver.com",
    "feeds.reuters.com",
    "rss.nytimes.com",
    "www3.nhk.or.jp",
    "www.yonhapnewstv.co.kr",
    "www.reddit.com",
    "www.v2ex.com",
    "b.hatena.ne.jp",
    "gall.dcinside.com",
    "github.com",
    "stackoverflow.blog",
    "dev.to",
    "lobste.rs",
    "stooq.com",
    "finance.yahoo.com",
    "feeds.finance.yahoo.com",
}

CONFLICT_NEGATIVE_KEYWORDS = {"rumor", "fake", "hoax", "오보", "허위", "루머", "정정"}
CONFLICT_POSITIVE_KEYWORDS = {"official", "confirmed", "공식", "확정", "발표"}

LOCALE_BY_COUNTRY: dict[str, dict[str, str]] = {
    "US": {"hl": "en-US", "gl": "US", "ceid": "US:en"},
    "JP": {"hl": "ja", "gl": "JP", "ceid": "JP:ja"},
    "CN": {"hl": "zh-CN", "gl": "CN", "ceid": "CN:zh-Hans"},
    "KR": {"hl": "ko", "gl": "KR", "ceid": "KR:ko"},
}


@dataclass
class RuntimeConfig:
    sqlite_path: Path
    docs_root: Path


@dataclass
class AdapterResult:
    adapter: str
    items: list[dict[str, Any]]
    warnings: list[str]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def utc_now_ms() -> int:
    return int(time.time() * 1000)


def slugify(value: str, fallback: str = "flow") -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return normalized or fallback


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def from_json(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        parsed = json.loads(raw)
    except Exception:
        return fallback
    return parsed


def trim_text(raw: Any, max_len: int = 300) -> str:
    text = str(raw or "").replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def strip_tags(raw: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", raw or "")
    return trim_text(unescape(without_tags), 500)


def parse_datetime_iso(raw: str | None) -> str | None:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None

    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        pass

    normalized = text.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return None


def parse_host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def stable_id(*parts: str) -> str:
    base = "|".join([str(part or "") for part in parts])
    return hashlib.sha1(base.encode("utf-8", errors="ignore")).hexdigest()[:20]


def google_news_search_rss(query: str, country: str) -> str:
    locale = LOCALE_BY_COUNTRY[country]
    qs = urlencode(
        {
            "q": query,
            "hl": locale["hl"],
            "gl": locale["gl"],
            "ceid": locale["ceid"],
        }
    )
    return f"https://news.google.com/rss/search?{qs}"


def env_flag_enabled(env_name: str, default: bool = True) -> bool:
    raw = os.getenv(env_name)
    if raw is None:
        return default
    normalized = str(raw).strip().lower()
    if not normalized:
        return default
    return normalized not in {"0", "false", "f", "no", "n", "off", "disabled"}


def env_text(env_name: str, default: str = "") -> str:
    raw = os.getenv(env_name)
    if raw is None:
        return default
    value = str(raw).strip()
    if not value:
        return default
    return value


def env_float(env_name: str, default: float, *, min_value: float, max_value: float) -> float:
    raw = os.getenv(env_name)
    if raw is None:
        return default
    text = str(raw).strip()
    if not text:
        return default
    try:
        value = float(text)
    except Exception:
        return default
    return max(min_value, min(max_value, value))


def env_int(env_name: str, default: int, *, min_value: int, max_value: int) -> int:
    raw = os.getenv(env_name)
    if raw is None:
        return default
    text = str(raw).strip()
    if not text:
        return default
    try:
        value = int(text)
    except Exception:
        return default
    return max(min_value, min(max_value, value))


TRANSLATION_CACHE: dict[str, str] = {}


def contains_korean(text: str) -> bool:
    return bool(re.search(r"[가-힣]", text or ""))


def _normalize_translation_text(raw: str, *, preserve_newlines: bool) -> str:
    text = str(raw or "")
    if preserve_newlines:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()
    return trim_text(text, 120000)


def _truncate_text(text: str, max_len: int, *, preserve_newlines: bool) -> str:
    if max_len <= 0:
        return text
    if preserve_newlines:
        if len(text) <= max_len:
            return text
        return text[:max_len].rstrip()
    return trim_text(text, max_len)


def translate_to_korean(
    text: str,
    max_len: int = 280,
    *,
    source_max_len: int | None = 1200,
    preserve_newlines: bool = False,
) -> str:
    normalized = _normalize_translation_text(text or "", preserve_newlines=preserve_newlines)
    if source_max_len and source_max_len > 0 and len(normalized) > source_max_len:
        normalized = normalized[:source_max_len].rstrip()
    if not normalized:
        return ""
    if contains_korean(normalized):
        return _truncate_text(normalized, max_len, preserve_newlines=preserve_newlines)
    if not env_flag_enabled(TRANSLATE_TO_KO_ENV, default=True):
        return _truncate_text(normalized, max_len, preserve_newlines=preserve_newlines)

    cached = TRANSLATION_CACHE.get(normalized)
    if cached:
        return _truncate_text(cached, max_len, preserve_newlines=preserve_newlines)

    try:
        qs = urlencode(
            {
                "client": "gtx",
                "sl": "auto",
                "tl": "ko",
                "dt": "t",
                "q": normalized,
            }
        )
        request = Request(
            f"https://translate.googleapis.com/translate_a/single?{qs}",
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/plain, */*",
            },
            method="GET",
        )
        with urlopen(request, timeout=4) as response:
            payload = response.read().decode("utf-8", errors="ignore")
        parsed = json.loads(payload)
        segments = parsed[0] if isinstance(parsed, list) and parsed else []
        translated = ""
        if isinstance(segments, list):
            translated = "".join(
                str(segment[0] or "")
                for segment in segments
                if isinstance(segment, list) and len(segment) > 0
            ).strip()
        if translated:
            TRANSLATION_CACHE[normalized] = translated
            return _truncate_text(translated, max_len, preserve_newlines=preserve_newlines)
    except Exception:
        pass
    return _truncate_text(normalized, max_len, preserve_newlines=preserve_newlines)


def is_local_hostname(hostname: str | None) -> bool:
    host = str(hostname or "").strip().lower()
    if host in {"localhost", "127.0.0.1", "::1"}:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except Exception:
        return False


def resolve_pinchtab_base_url() -> str:
    raw = str(os.getenv(PINCHTAB_BASE_URL_ENV) or DEFAULT_PINCHTAB_BASE_URL).strip()
    if not raw:
        raw = DEFAULT_PINCHTAB_BASE_URL
    if "://" not in raw:
        raw = f"http://{raw}"
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"}:
        raise RuntimeError("pinchtab base url must use http/https")
    if not is_local_hostname(parsed.hostname):
        raise RuntimeError("pinchtab base url must target localhost")
    netloc = parsed.netloc
    if not netloc:
        raise RuntimeError("pinchtab base url missing host")
    return f"{parsed.scheme}://{netloc}"


def pinchtab_headers(include_json: bool = False) -> dict[str, str]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
    }
    token = str(os.getenv(PINCHTAB_TOKEN_ENV) or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if include_json:
        headers["Content-Type"] = "application/json"
    return headers


def http_request_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> tuple[Any, int]:
    final_headers = headers or {"User-Agent": USER_AGENT, "Accept": "application/json,*/*"}
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=body, headers=final_headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            status = int(getattr(response, "status", 200) or 200)
            charset = "utf-8"
            if hasattr(response.headers, "get_content_charset"):
                charset = response.headers.get_content_charset() or "utf-8"
            text = response.read().decode(charset, errors="replace")
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        detail = trim_text(detail, 200)
        raise RuntimeError(f"http {exc.code}: {url}: {detail or 'no detail'}") from exc
    except URLError as exc:
        raise RuntimeError(f"network error: {url}: {exc}") from exc
    except Exception as exc:
        raise RuntimeError(f"request failed: {url}: {exc}") from exc

    stripped = text.strip()
    if not stripped:
        return {}, status
    try:
        return json.loads(stripped), status
    except Exception:
        return {"text": stripped}, status


def pinchtab_request_json(
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> tuple[Any, int]:
    base_url = resolve_pinchtab_base_url()
    normalized_path = path if path.startswith("/") else f"/{path}"
    return http_request_json(
        f"{base_url}{normalized_path}",
        method=method,
        payload=payload,
        headers=pinchtab_headers(include_json=payload is not None or method in {"POST", "PUT", "PATCH"}),
        timeout=timeout,
    )


def pinchtab_extract_id(payload: Any, keys: tuple[str, ...]) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in keys:
        value = trim_text(payload.get(key) or "", 120)
        if value:
            return value
    return ""


def pinchtab_extract_text(payload: Any) -> str:
    if isinstance(payload, str):
        return trim_text(payload, 8000)
    if isinstance(payload, dict):
        for key in ("text", "content", "markdown", "rawText"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return trim_text(value, 8000)
        if isinstance(payload.get("data"), (dict, str)):
            return pinchtab_extract_text(payload.get("data"))
    if isinstance(payload, list):
        chunks = [pinchtab_extract_text(row) for row in payload]
        combined = "\n".join([row for row in chunks if row])
        return trim_text(combined, 8000)
    return ""


def parse_pinchtab_snippets(text: str, limit: int = 4) -> list[str]:
    if not text.strip():
        return []
    chunks: list[str] = []
    seen: set[str] = set()
    for line in re.split(r"[\n\r]+", text):
        normalized = trim_text(line, 220)
        if len(normalized) < 24:
            continue
        lower = normalized.lower()
        if lower in seen:
            continue
        if lower.startswith("http://") or lower.startswith("https://"):
            continue
        seen.add(lower)
        chunks.append(normalized)
        if len(chunks) >= max(1, limit):
            break
    return chunks


def resolve_pinchtab_stealth_mode() -> str:
    raw = env_text(PINCHTAB_STEALTH_ENV, "full").lower()
    aliases = {
        "1": "full",
        "true": "full",
        "yes": "full",
        "on": "full",
        "0": "off",
        "false": "off",
        "no": "off",
        "disabled": "off",
    }
    value = aliases.get(raw, raw)
    if value in {"full", "medium", "light", "off"}:
        return value
    return "full"


def pinchtab_startup_delay_seconds() -> float:
    return env_float(
        PINCHTAB_STARTUP_DELAY_ENV,
        PINCHTAB_STARTUP_DELAY_SECONDS,
        min_value=0.0,
        max_value=6.0,
    )


def pinchtab_target_delay_seconds() -> float:
    return env_float(
        PINCHTAB_TARGET_DELAY_ENV,
        PINCHTAB_TARGET_DELAY_SECONDS,
        min_value=0.0,
        max_value=6.0,
    )


def pinchtab_tab_read_delay_seconds() -> float:
    return env_float(
        PINCHTAB_TAB_READ_DELAY_ENV,
        PINCHTAB_TAB_READ_DELAY_SECONDS,
        min_value=0.0,
        max_value=6.0,
    )


def scrapling_timeout_seconds() -> int:
    return env_int(
        SCRAPLING_TIMEOUT_ENV,
        SCRAPLING_DEFAULT_TIMEOUT_SECONDS,
        min_value=4,
        max_value=45,
    )


def scrapling_stealth_enabled() -> bool:
    return env_flag_enabled(SCRAPLING_STEALTH_ENV, default=True)


def build_pinchtab_launch_payload() -> dict[str, Any]:
    payload: dict[str, Any] = {"mode": PINCHTAB_DEFAULT_MODE}
    stealth = resolve_pinchtab_stealth_mode()
    if stealth != "off":
        payload["stealth"] = stealth
        payload["bridgeStealth"] = stealth

    profile_id = trim_text(env_text(PINCHTAB_PROFILE_ID_ENV, ""), 80)
    if profile_id:
        payload["profileId"] = profile_id

    payload["blockAds"] = env_flag_enabled(PINCHTAB_BLOCK_ADS_ENV, default=True)
    payload["blockImages"] = env_flag_enabled(PINCHTAB_BLOCK_IMAGES_ENV, default=False)
    payload["blockMedia"] = env_flag_enabled(PINCHTAB_BLOCK_MEDIA_ENV, default=False)
    return payload


def pinchtab_start_instance(adapter: str) -> tuple[str, list[str]]:
    warnings: list[str] = []
    launch_payload = build_pinchtab_launch_payload()

    try:
        started_payload, _ = pinchtab_request_json(
            "/instances/start",
            method="POST",
            payload=launch_payload,
            timeout=15,
        )
        instance_id = pinchtab_extract_id(started_payload, ("id", "instanceId", "instance_id"))
        if instance_id:
            return instance_id, warnings
        warnings.append(f"{adapter}: /instances/start response missing instance id")
    except Exception as exc:
        warnings.append(f"{adapter}: /instances/start failed ({trim_text(exc, 180)}), fallback to /instances/launch")

    fallback_payload: dict[str, Any] = {"mode": launch_payload.get("mode", PINCHTAB_DEFAULT_MODE)}
    profile_id = trim_text(launch_payload.get("profileId") or "", 80)
    if profile_id:
        fallback_payload["profileId"] = profile_id

    started_payload, _ = pinchtab_request_json(
        "/instances/launch",
        method="POST",
        payload=fallback_payload,
        timeout=15,
    )
    instance_id = pinchtab_extract_id(started_payload, ("id", "instanceId", "instance_id"))
    if not instance_id:
        warnings.append(f"{adapter}: /instances/launch response missing instance id")
        return "", warnings
    return instance_id, warnings


def collect_pinchtab_targets(
    source_type: str,
    adapter: str,
    targets: list[dict[str, str]],
    *,
    snippets_per_target: int = 2,
) -> AdapterResult:
    if not env_flag_enabled(PINCHTAB_ENABLED_ENV, default=True):
        return AdapterResult(adapter=adapter, items=[], warnings=[])

    warnings: list[str] = []
    items: list[dict[str, Any]] = []
    instance_id = ""
    pinchtab_stealth = resolve_pinchtab_stealth_mode()

    try:
        _, health_status = pinchtab_request_json("/health", timeout=5)
        if health_status < 200 or health_status >= 300:
            return AdapterResult(adapter=adapter, items=[], warnings=[f"{adapter}: pinchtab health status {health_status}"])

        instance_id, launch_warnings = pinchtab_start_instance(adapter)
        warnings.extend(launch_warnings)
        if not instance_id:
            return AdapterResult(adapter=adapter, items=[], warnings=[f"{adapter}: launch response missing instance id"])

        time.sleep(pinchtab_startup_delay_seconds())

        for target in targets:
            if len(items) >= MAX_TOTAL_ITEMS:
                break

            target_url = str(target.get("url") or "").strip()
            source_name = target.get("name") or parse_host(target_url) or "unknown"
            country = target.get("country") or "GLOBAL"
            if not target_url:
                warnings.append(f"{adapter}: missing target url for {source_name}")
                continue

            try:
                open_payload, open_status = pinchtab_request_json(
                    f"/instances/{instance_id}/tabs/open",
                    method="POST",
                    payload={"url": target_url},
                    timeout=18,
                )
                if open_status < 200 or open_status >= 300:
                    warnings.append(f"{adapter}: open tab status {open_status} for {target_url}")
                    continue

                tab_id = pinchtab_extract_id(open_payload, ("tabId", "tab_id", "id"))
                if not tab_id:
                    warnings.append(f"{adapter}: tab id missing for {target_url}")
                    continue

                time.sleep(pinchtab_tab_read_delay_seconds())
                text_payload, text_status = pinchtab_request_json(
                    f"/tabs/{tab_id}/text",
                    method="GET",
                    timeout=18,
                )
                if text_status < 200 or text_status >= 300:
                    warnings.append(f"{adapter}: tab text status {text_status} for {target_url}")
                    continue

                page_text = pinchtab_extract_text(text_payload)
                snippets = parse_pinchtab_snippets(page_text, limit=max(1, snippets_per_target))
                if not snippets and page_text:
                    snippets = [trim_text(page_text, 200)]
                if not snippets:
                    warnings.append(f"{adapter}: empty extracted text for {target_url}")
                    continue

                for snippet in snippets:
                    title = trim_text(snippet, 130)
                    next_rank = len(items) + 1
                    items.append(
                        make_item(
                            source_type=source_type,
                            source_name=source_name,
                            country=country,
                            adapter=adapter,
                            title=title,
                            url=target_url,
                            summary=snippet,
                            published_at=None,
                            extra={
                                "pinchtab": True,
                                "pinchtab_stealth": pinchtab_stealth,
                                "headline": True,
                                "hot_rank": next_rank,
                                "hot_topic_hint": has_hot_topic_keyword(title, snippet, source_name, target_url),
                            },
                        )
                    )
                    if len(items) >= MAX_TOTAL_ITEMS:
                        break
                time.sleep(pinchtab_target_delay_seconds())
            except Exception as exc:
                warnings.append(f"{adapter}: {trim_text(exc, 200)}")
    except Exception as exc:
        warnings.append(f"{adapter}: {trim_text(exc, 200)}")
    finally:
        if instance_id:
            try:
                pinchtab_request_json(
                    f"/instances/{instance_id}/stop",
                    method="POST",
                    payload={},
                    timeout=8,
                )
            except Exception as exc:
                warnings.append(f"{adapter}: failed to stop instance: {trim_text(exc, 180)}")

    return AdapterResult(adapter=adapter, items=items[:MAX_TOTAL_ITEMS], warnings=warnings)


def _extract_scrapling_text(payload: Any) -> str:
    if payload is None:
        return ""
    if isinstance(payload, bytes):
        return trim_text(payload.decode("utf-8", errors="replace"), 9000)
    if isinstance(payload, str):
        return trim_text(payload, 9000)
    if isinstance(payload, dict):
        for key in ("text", "html", "content", "markdown", "raw", "body"):
            value = payload.get(key)
            if isinstance(value, (str, bytes)):
                text = _extract_scrapling_text(value)
                if text:
                    return text
    for attr in ("text", "html", "content", "markdown", "raw", "body"):
        value = getattr(payload, attr, None)
        if isinstance(value, (str, bytes)):
            text = _extract_scrapling_text(value)
            if text:
                return text
    for attr in ("to_text", "get_text"):
        fn = getattr(payload, attr, None)
        if callable(fn):
            try:
                text = _extract_scrapling_text(fn())
                if text:
                    return text
            except Exception:
                continue
    return ""


def _invoke_scrapling_callable(
    fn: Callable[..., Any],
    *,
    url: str,
    timeout_sec: int,
    stealth: bool,
) -> Any:
    kwargs: dict[str, Any] = {}
    try:
        signature = inspect.signature(fn)
        params = signature.parameters
        accepts_var_kw = any(param.kind == inspect.Parameter.VAR_KEYWORD for param in params.values())
    except Exception:
        params = {}
        accepts_var_kw = True

    def supports(name: str) -> bool:
        return accepts_var_kw or name in params

    if supports("timeout"):
        kwargs["timeout"] = timeout_sec
    if supports("timeout_sec"):
        kwargs["timeout_sec"] = timeout_sec
    if supports("request_timeout"):
        kwargs["request_timeout"] = timeout_sec
    if supports("stealth"):
        kwargs["stealth"] = stealth
    if supports("headless"):
        kwargs["headless"] = True

    if "url" in params:
        return fn(url=url, **kwargs)
    return fn(url, **kwargs)


def _scrapling_fetch_text(url: str, *, timeout_sec: int, stealth: bool) -> tuple[str, list[str]]:
    warnings: list[str] = []
    candidates: list[Callable[..., Any]] = []

    module_class_paths = [
        ("scrapling.fetchers", "Fetcher"),
        ("scrapling.fetchers", "PlaywrightFetcher"),
        ("scrapling.fetchers", "StealthFetcher"),
        ("scrapling", "Fetcher"),
    ]
    module_function_paths = [
        ("scrapling", "fetch"),
        ("scrapling", "scrape"),
        ("scrapling", "get"),
        ("scrapling", "request"),
    ]

    for module_name, class_name in module_class_paths:
        try:
            module = importlib.import_module(module_name)
            klass = getattr(module, class_name, None)
            if not callable(klass):
                continue
            instance = klass()
            for method_name in ("get", "fetch", "request", "scrape"):
                method = getattr(instance, method_name, None)
                if callable(method):
                    candidates.append(method)
        except Exception:
            continue

    for module_name, fn_name in module_function_paths:
        try:
            module = importlib.import_module(module_name)
            fn = getattr(module, fn_name, None)
            if callable(fn):
                candidates.append(fn)
        except Exception:
            continue

    if not candidates:
        return "", ["scrapling module/callable not found"]

    for fn in candidates:
        try:
            payload = _invoke_scrapling_callable(
                fn,
                url=url,
                timeout_sec=timeout_sec,
                stealth=stealth,
            )
            text = _extract_scrapling_text(payload)
            if text.strip():
                return text, warnings
        except Exception as exc:
            warnings.append(trim_text(exc, 160))

    return "", warnings[:3]


def collect_scrapling_targets(
    source_type: str,
    adapter: str,
    targets: list[dict[str, str]],
    *,
    snippets_per_target: int = 2,
) -> AdapterResult:
    if not env_flag_enabled(SCRAPLING_ENABLED_ENV, default=True):
        return AdapterResult(adapter=adapter, items=[], warnings=[])

    warnings: list[str] = []
    items: list[dict[str, Any]] = []
    timeout_sec = scrapling_timeout_seconds()
    stealth = scrapling_stealth_enabled()

    for target in targets:
        if len(items) >= MAX_TOTAL_ITEMS:
            break
        target_url = str(target.get("url") or "").strip()
        source_name = target.get("name") or parse_host(target_url) or "unknown"
        country = target.get("country") or "GLOBAL"
        if not target_url:
            warnings.append(f"{adapter}: missing target url for {source_name}")
            continue

        try:
            page_text, fetch_warnings = _scrapling_fetch_text(target_url, timeout_sec=timeout_sec, stealth=stealth)
            warnings.extend([f"{adapter}: {row}" for row in fetch_warnings[:2]])
            if not page_text:
                continue
            normalized_text = strip_tags(page_text) if "<" in page_text[:1200] else trim_text(page_text, 9000)
            snippets = parse_pinchtab_snippets(normalized_text, limit=max(1, snippets_per_target))
            if not snippets and normalized_text:
                snippets = [trim_text(normalized_text, 220)]
            if not snippets:
                continue
            for snippet in snippets:
                title = trim_text(snippet, 130)
                next_rank = len(items) + 1
                items.append(
                    make_item(
                        source_type=source_type,
                        source_name=source_name,
                        country=country,
                        adapter=adapter,
                        title=title,
                        url=target_url,
                        summary=snippet,
                        published_at=None,
                        extra={
                            "scrapling": True,
                            "scrapling_stealth": stealth,
                            "headline": True,
                            "hot_rank": next_rank,
                            "hot_topic_hint": has_hot_topic_keyword(title, snippet, source_name, target_url),
                        },
                    )
                )
                if len(items) >= MAX_TOTAL_ITEMS:
                    break
        except Exception as exc:
            warnings.append(f"{adapter}: {trim_text(exc, 180)}")

    return AdapterResult(adapter=adapter, items=items[:MAX_TOTAL_ITEMS], warnings=warnings)


def http_get_text(url: str, timeout: int = REQUEST_TIMEOUT_SECONDS) -> tuple[str, int, str]:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/rss+xml,application/xml,text/xml,text/html,application/json,*/*",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read()
            status = int(getattr(response, "status", 200) or 200)
            content_type = str(response.headers.get("content-type") or "")
            charset = "utf-8"
            if hasattr(response.headers, "get_content_charset"):
                charset = response.headers.get_content_charset() or "utf-8"
            text = body.decode(charset, errors="replace")
            return text, status, content_type
    except HTTPError as exc:
        raise RuntimeError(f"http {exc.code}: {url}") from exc
    except URLError as exc:
        raise RuntimeError(f"network error: {url}: {exc}") from exc
    except Exception as exc:
        raise RuntimeError(f"request failed: {url}: {exc}") from exc


def parse_rss_items(xml_text: str, limit: int) -> list[dict[str, Any]]:
    xml_text = xml_text.strip()
    if not xml_text:
        return []

    try:
        root = ET.fromstring(xml_text)
    except Exception as exc:
        raise RuntimeError(f"invalid xml/rss payload: {exc}") from exc

    items: list[dict[str, Any]] = []
    channel_items = root.findall(".//item")
    if channel_items:
        for item in channel_items[:limit]:
            title = trim_text(item.findtext("title") or "", 220)
            link = trim_text(item.findtext("link") or "", 500)
            summary = strip_tags(item.findtext("description") or item.findtext("content:encoded") or "")
            published = parse_datetime_iso(item.findtext("pubDate") or item.findtext("dc:date"))
            if title and link:
                items.append(
                    {
                        "title": title,
                        "url": link,
                        "summary": summary,
                        "published_at": published,
                    }
                )
        return items

    atom_entries = root.findall(".//{http://www.w3.org/2005/Atom}entry")
    for entry in atom_entries[:limit]:
        title = trim_text(entry.findtext("{http://www.w3.org/2005/Atom}title") or "", 220)
        link = ""
        for link_node in entry.findall("{http://www.w3.org/2005/Atom}link"):
            href = trim_text(link_node.attrib.get("href") or "", 500)
            if href:
                link = href
                break
        summary = strip_tags(
            entry.findtext("{http://www.w3.org/2005/Atom}summary")
            or entry.findtext("{http://www.w3.org/2005/Atom}content")
            or ""
        )
        published = parse_datetime_iso(
            entry.findtext("{http://www.w3.org/2005/Atom}updated")
            or entry.findtext("{http://www.w3.org/2005/Atom}published")
        )
        if title and link:
            items.append(
                {
                    "title": title,
                    "url": link,
                    "summary": summary,
                    "published_at": published,
                }
            )
    return items


def html_to_text_excerpt(html_text: str, max_len: int | None = None) -> tuple[str, int]:
    limit = max_len if max_len is not None else content_text_max_chars()
    payload = html_text or ""
    article_match = re.search(r"<article[^>]*>(.*?)</article>", payload, flags=re.IGNORECASE | re.DOTALL)
    if article_match:
        payload = article_match.group(1)

    payload = re.sub(r"<!--.*?-->", " ", payload, flags=re.DOTALL)
    payload = re.sub(r"<(script|style|noscript|svg|iframe)[^>]*>.*?</\\1>", " ", payload, flags=re.IGNORECASE | re.DOTALL)
    text = strip_tags(payload)
    if not text:
        return "", 0
    full_len = len(text)
    return trim_text(text, limit), full_len


def should_enrich_item(row: dict[str, Any]) -> bool:
    url = str(row.get("url") or "").strip()
    if not url:
        return False
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    if row.get("fallback"):
        return False
    if str(row.get("source_type") or "") == SOURCE_TYPE_MARKET and row.get("quote_close"):
        return False
    return True


def content_text_max_chars() -> int:
    return env_int(CONTENT_TEXT_MAX_CHARS_ENV, CONTENT_TEXT_MAX_CHARS, min_value=500, max_value=20000)


def content_enrich_max_items(total_items: int) -> int:
    if total_items <= 0:
        return 0
    configured = env_int(CONTENT_ENRICH_MAX_ITEMS_ENV, CONTENT_ENRICH_MAX_ITEMS, min_value=1, max_value=total_items)
    return min(configured, total_items)


def select_content_enrich_urls(items: list[dict[str, Any]], max_items: int) -> set[str]:
    ordered: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    grouped: dict[str, list[str]] = {}

    for row in items:
        if not should_enrich_item(row):
            continue
        url = str(row.get("url") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        source_type = str(row.get("source_type") or "unknown")
        ordered.append((source_type, url))
        grouped.setdefault(source_type, []).append(url)

    if not ordered or max_items <= 0:
        return set()

    source_order = ["source.news", SOURCE_TYPE_SNS, SOURCE_TYPE_COMMUNITY, SOURCE_TYPE_DEV, SOURCE_TYPE_MARKET]
    for source_type, _ in ordered:
        if source_type not in source_order:
            source_order.append(source_type)

    present_sources = [source for source in source_order if grouped.get(source)]
    if not present_sources:
        return set()

    quota = max(1, max_items // len(present_sources))
    selected: list[str] = []
    selected_set: set[str] = set()

    for source in present_sources:
        for url in grouped.get(source, [])[:quota]:
            if len(selected) >= max_items:
                break
            if url in selected_set:
                continue
            selected.append(url)
            selected_set.add(url)
        if len(selected) >= max_items:
            break

    if len(selected) < max_items:
        for _, url in ordered:
            if len(selected) >= max_items:
                break
            if url in selected_set:
                continue
            selected.append(url)
            selected_set.add(url)

    return selected_set


def enrich_items_with_page_content(
    items: list[dict[str, Any]],
    max_items: int = CONTENT_ENRICH_MAX_ITEMS,
) -> tuple[list[dict[str, Any]], list[str], dict[str, int]]:
    enriched_items: list[dict[str, Any]] = []
    warnings: list[str] = []
    attempted = 0
    enriched = 0
    seen_urls: set[str] = set()
    selected_urls = select_content_enrich_urls(items, max_items=max_items)

    for row in items:
        next_row = dict(row)
        url = str(next_row.get("url") or "").strip()
        if not should_enrich_item(next_row):
            enriched_items.append(next_row)
            continue
        if url not in selected_urls:
            enriched_items.append(next_row)
            continue
        if url in seen_urls:
            enriched_items.append(next_row)
            continue
        if attempted >= max_items:
            enriched_items.append(next_row)
            continue

        seen_urls.add(url)
        attempted += 1
        try:
            text, status, content_type = http_get_text(url)
            if status < 200 or status >= 300:
                warnings.append(f"content.enrich: status {status} for {url}")
                enriched_items.append(next_row)
                continue

            content_type_lower = content_type.lower()
            extracted = ""
            content_length = 0
            if "html" in content_type_lower:
                extracted, content_length = html_to_text_excerpt(text)
            elif any(token in content_type_lower for token in ("xml", "rss", "atom", "text/plain")):
                extracted = trim_text(strip_tags(text), content_text_max_chars())
                content_length = len(strip_tags(text))
            elif "json" in content_type_lower:
                extracted = trim_text(text, content_text_max_chars())
                content_length = len(text)

            if extracted:
                next_row["content_excerpt"] = extracted
                next_row["content_length"] = content_length
                next_row["content_fetched_at"] = now_iso()
                next_row["content_mode"] = "html_extract" if "html" in content_type_lower else "text_extract"
                if len(trim_text(next_row.get("summary") or "", 420)) < CONTENT_ENRICH_MIN_SUMMARY_CHARS:
                    next_row["summary"] = trim_text(extracted, 420)
                enriched += 1
        except Exception as exc:
            warnings.append(f"content.enrich: {trim_text(exc, 180)}")

        enriched_items.append(next_row)

    stats = {"attempted": attempted, "enriched": enriched}
    return enriched_items, warnings, stats


def build_crawl_depth_stats(items: list[dict[str, Any]]) -> dict[str, int]:
    with_content = 0
    total_content_chars = 0
    for row in items:
        length = int(row.get("content_length") or 0)
        if length > 0:
            with_content += 1
            total_content_chars += length
    return {
        "items_total": len(items),
        "items_with_content": with_content,
        "total_content_chars": total_content_chars,
    }


def make_item(
    source_type: str,
    source_name: str,
    country: str,
    adapter: str,
    title: str,
    url: str,
    summary: str,
    published_at: str | None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_type = LEGACY_SOURCE_TYPE_MAP.get(source_type, source_type)
    title_text = trim_text(title, 220)
    url_text = trim_text(url, 500)
    summary_text = trim_text(summary, 420)
    item = {
        "id": stable_id(normalized_type, source_name, title, url),
        "source_type": normalized_type,
        "source_name": source_name,
        "country": country,
        "adapter": adapter,
        "title": title_text,
        "url": url_text,
        "summary": summary_text,
        "published_at": published_at or now_iso(),
        "fetched_at": now_iso(),
        "hot_topic_hint": has_hot_topic_keyword(title_text, summary_text, source_name, url_text),
    }
    if extra:
        item.update(extra)
    return item


def collect_rss_targets(
    source_type: str,
    adapter: str,
    targets: list[dict[str, str]],
    limit_per_target: int = MAX_ITEMS_PER_TARGET,
) -> AdapterResult:
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    for target in targets:
        if len(items) >= MAX_TOTAL_ITEMS:
            break
        url = target["url"]
        source_name = target.get("name") or parse_host(url) or "unknown"
        country = target.get("country") or "GLOBAL"
        try:
            text, status, _ = http_get_text(url)
            if status < 200 or status >= 300:
                warnings.append(f"{adapter}: non-success status {status} for {url}")
                continue
            parsed = parse_rss_items(text, limit_per_target)
            if not parsed:
                warnings.append(f"{adapter}: empty feed for {url}")
                continue
            for index, row in enumerate(parsed, start=1):
                items.append(
                    make_item(
                        source_type=source_type,
                        source_name=source_name,
                        country=country,
                        adapter=adapter,
                        title=row.get("title") or "",
                        url=row.get("url") or "",
                        summary=row.get("summary") or "",
                        published_at=row.get("published_at"),
                        extra={
                            "headline": True,
                            "hot_rank": index,
                        },
                    )
                )
        except Exception as exc:
            warnings.append(f"{adapter}: {trim_text(exc, 200)}")

    return AdapterResult(adapter=adapter, items=items[:MAX_TOTAL_ITEMS], warnings=warnings)


def collect_dcinside_lists(adapter: str) -> AdapterResult:
    url = "https://gall.dcinside.com/mgallery/board/lists/?id=stock"
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    try:
        html_text, status, _ = http_get_text(url)
        if status < 200 or status >= 300:
            return AdapterResult(adapter=adapter, items=[], warnings=[f"{adapter}: status {status} for dcinside"])

        matches = re.findall(r'<a[^>]+href="(/mgallery/board/view/[^\"]+)"[^>]*>(.*?)</a>', html_text, flags=re.IGNORECASE | re.DOTALL)
        seen: set[str] = set()
        for path, title_html in matches:
            if len(items) >= MAX_ITEMS_PER_TARGET:
                break
            title = trim_text(strip_tags(title_html), 200)
            if not title:
                continue
            article_url = f"https://gall.dcinside.com{path}"
            if article_url in seen:
                continue
            seen.add(article_url)
            items.append(
                make_item(
                    source_type=SOURCE_TYPE_COMMUNITY,
                    source_name="DCInside",
                    country="KR",
                    adapter=adapter,
                    title=title,
                    url=article_url,
                    summary="DCInside 갤러리 게시글",
                    published_at=None,
                    extra={
                        "headline": True,
                        "hot_rank": len(items) + 1,
                    },
                )
            )

        if not items:
            warnings.append(f"{adapter}: no dcinside entries parsed")
    except Exception as exc:
        warnings.append(f"{adapter}: {trim_text(exc, 200)}")

    return AdapterResult(adapter=adapter, items=items, warnings=warnings)


def collect_github_trending(adapter: str) -> AdapterResult:
    url = "https://github.com/trending"
    items: list[dict[str, Any]] = []
    warnings: list[str] = []

    try:
        html_text, status, _ = http_get_text(url)
        if status < 200 or status >= 300:
            return AdapterResult(adapter=adapter, items=[], warnings=[f"{adapter}: status {status} for github trending"])

        article_blocks = re.findall(r"<article[^>]*>(.*?)</article>", html_text, flags=re.IGNORECASE | re.DOTALL)
        for block in article_blocks:
            if len(items) >= MAX_ITEMS_PER_TARGET:
                break
            link_match = re.search(
                r"<h2[^>]*>\s*<a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>",
                block,
                flags=re.IGNORECASE | re.DOTALL,
            )
            if not link_match:
                continue
            path, title_html = link_match.groups()
            name = trim_text(strip_tags(title_html).replace("/", " / "), 160)
            if not name:
                continue
            repo_url = f"https://github.com{path.strip()}"
            stars_today_match = re.search(r"([0-9][0-9,]*)\s+stars?\s+today", block, flags=re.IGNORECASE)
            stars_today = trim_text(stars_today_match.group(1) if stars_today_match else "", 30)
            summary = "GitHub Trending repository"
            if stars_today:
                summary = f"GitHub Trending repository · today stars {stars_today}"
            items.append(
                make_item(
                    source_type=SOURCE_TYPE_DEV,
                    source_name="GitHub Trending",
                    country="GLOBAL",
                    adapter=adapter,
                    title=name,
                    url=repo_url,
                    summary=summary,
                    published_at=None,
                    extra={
                        "headline": True,
                        "hot_rank": len(items) + 1,
                        "stars_today": stars_today or None,
                    },
                )
            )

        if not items:
            warnings.append(f"{adapter}: no repositories parsed")
    except Exception as exc:
        warnings.append(f"{adapter}: {trim_text(exc, 200)}")

    return AdapterResult(adapter=adapter, items=items, warnings=warnings)


def collect_market_indices(adapter: str) -> AdapterResult:
    index_targets = [
        {"symbol": "%5Espx", "name": "S&P 500", "country": "US"},
        {"symbol": "%5Enkx", "name": "Nikkei 225", "country": "JP"},
        {"symbol": "000001.ss", "name": "SSE Composite", "country": "CN"},
        {"symbol": "%5Eks11", "name": "KOSPI", "country": "KR"},
    ]

    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    for target in index_targets:
        url = f"https://stooq.com/q/l/?s={target['symbol']}&i=d"
        try:
            text, status, _ = http_get_text(url)
            if status < 200 or status >= 300:
                warnings.append(f"{adapter}: stooq status {status} for {target['name']}")
                continue
            rows = list(csv.DictReader(text.splitlines()))
            if not rows:
                warnings.append(f"{adapter}: stooq empty rows for {target['name']}")
                continue
            row = rows[0]
            close = trim_text(row.get("Close") or row.get("CLOSE") or "")
            high = trim_text(row.get("High") or row.get("HIGH") or "")
            low = trim_text(row.get("Low") or row.get("LOW") or "")
            date = trim_text(row.get("Date") or "")
            summary = f"Close={close or 'N/A'}, High={high or 'N/A'}, Low={low or 'N/A'}"
            items.append(
                make_item(
                    source_type=SOURCE_TYPE_MARKET,
                    source_name=target["name"],
                    country=target["country"],
                    adapter=adapter,
                    title=f"{target['name']} ({date or 'latest'})",
                    url=url,
                    summary=summary,
                    published_at=None,
                    extra={
                        "quote_close": close or None,
                        "headline": True,
                        "hot_rank": len(items) + 1,
                    },
                )
            )
        except Exception as exc:
            warnings.append(f"{adapter}: {trim_text(exc, 200)}")

    return AdapterResult(adapter=adapter, items=items, warnings=warnings)


def normalize_naver_news_url(raw_url: str) -> str:
    url = trim_text(raw_url or "", 600)
    if not url:
        return ""
    if url.startswith("//"):
        url = f"https:{url}"
    elif url.startswith("/"):
        url = f"https://news.naver.com{url}"

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host not in {"news.naver.com", "n.news.naver.com", "m.news.naver.com"}:
        return ""

    normalized = url.split("#", 1)[0]
    article_markers = ("/article/", "/mnews/article/", "main/read.naver")
    if not any(marker in normalized for marker in article_markers):
        return ""
    return trim_text(normalized, 600)


def collect_naver_korea_news(adapter: str) -> AdapterResult:
    targets = [
        "https://news.naver.com/main/ranking/popularDay.naver",
        "https://news.naver.com/main/list.naver?mode=LSD&mid=sec&sid1=101",
        "https://news.naver.com/main/list.naver?mode=LSD&mid=sec&sid1=105",
    ]

    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_urls: set[str] = set()

    for target_url in targets:
        if len(items) >= MAX_TOTAL_ITEMS:
            break
        is_ranking_target = "ranking" in target_url.lower() or "popular" in target_url.lower()
        source_name = "Naver News Popular" if is_ranking_target else "Naver News"
        default_summary = "네이버 많이 본 뉴스 헤드라인" if is_ranking_target else "네이버 뉴스 헤드라인"
        try:
            html_text, status, _ = http_get_text(target_url)
            if status < 200 or status >= 300:
                warnings.append(f"{adapter}: status {status} for {target_url}")
                continue

            matched = 0
            attr_matches = re.findall(
                r'<a[^>]+href="([^"]+)"[^>]*title="([^"]{6,220})"[^>]*>',
                html_text,
                flags=re.IGNORECASE | re.DOTALL,
            )
            for raw_url, raw_title in attr_matches:
                article_url = normalize_naver_news_url(raw_url)
                if not article_url or article_url in seen_urls:
                    continue
                title = trim_text(strip_tags(raw_title), 220)
                if len(title) < 8:
                    continue
                seen_urls.add(article_url)
                matched += 1
                items.append(
                    make_item(
                        source_type="source.news",
                        source_name=source_name,
                        country="KR",
                        adapter=adapter,
                        title=title,
                        url=article_url,
                        summary=default_summary,
                        published_at=None,
                        extra={
                            "headline": True,
                            "hot_rank": matched,
                        },
                    )
                )
                if matched >= MAX_ITEMS_PER_TARGET:
                    break

            if matched < MAX_ITEMS_PER_TARGET:
                body_matches = re.findall(
                    r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
                    html_text,
                    flags=re.IGNORECASE | re.DOTALL,
                )
                for raw_url, title_html in body_matches:
                    if matched >= MAX_ITEMS_PER_TARGET:
                        break
                    article_url = normalize_naver_news_url(raw_url)
                    if not article_url or article_url in seen_urls:
                        continue
                    title = trim_text(strip_tags(title_html), 220)
                    if len(title) < 8:
                        continue
                    seen_urls.add(article_url)
                    matched += 1
                    items.append(
                        make_item(
                            source_type="source.news",
                            source_name=source_name,
                            country="KR",
                            adapter=adapter,
                            title=title,
                            url=article_url,
                            summary=default_summary,
                            published_at=None,
                            extra={
                                "headline": True,
                                "hot_rank": matched,
                            },
                        )
                    )

            if matched == 0:
                warnings.append(f"{adapter}: no entries parsed for {target_url}")
        except Exception as exc:
            warnings.append(f"{adapter}: {trim_text(exc, 200)}")

    return AdapterResult(adapter=adapter, items=items[:MAX_TOTAL_ITEMS], warnings=warnings)


def news_scrapling_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Google News US", "url": google_news_search_rss("technology OR market", "US")},
        {"country": "JP", "name": "Google News JP", "url": google_news_search_rss("テクノロジー OR 株式", "JP")},
        {"country": "CN", "name": "Google News CN", "url": google_news_search_rss("科技 OR 市场", "CN")},
        {"country": "KR", "name": "Google News KR", "url": google_news_search_rss("기술 OR 주식", "KR")},
        {"country": "KR", "name": "Naver News Ranking", "url": "https://news.naver.com/main/ranking/popularDay.naver"},
        {"country": "US", "name": "Reuters", "url": "https://www.reuters.com/world/"},
    ]
    return collect_scrapling_targets("source.news", "news.scrapling", targets, snippets_per_target=2)


def news_pinchtab_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Google News US", "url": google_news_search_rss("technology OR market", "US")},
        {"country": "JP", "name": "Google News JP", "url": google_news_search_rss("テクノロジー OR 株式", "JP")},
        {"country": "CN", "name": "Google News CN", "url": google_news_search_rss("科技 OR 市场", "CN")},
        {"country": "KR", "name": "Google News KR", "url": google_news_search_rss("기술 OR 주식", "KR")},
        {"country": "KR", "name": "Naver News Ranking", "url": "https://news.naver.com/main/ranking/popularDay.naver"},
        {"country": "US", "name": "Reuters", "url": "https://www.reuters.com/world/"},
    ]
    return collect_pinchtab_targets("source.news", "news.pinchtab", targets, snippets_per_target=2)


def sns_scrapling_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "X Explore Technology", "url": "https://x.com/explore/tabs/for_you?f=top"},
        {"country": "GLOBAL", "name": "Threads AI", "url": "https://www.threads.com/search?q=AI"},
        {"country": "JP", "name": "X JP Search", "url": "https://x.com/search?q=%E3%83%86%E3%82%AF&src=typed_query"},
        {"country": "KR", "name": "X KR Search", "url": "https://x.com/search?q=%EA%B8%B0%EC%88%A0&src=typed_query"},
    ]
    return collect_scrapling_targets(SOURCE_TYPE_SNS, "sns.scrapling", targets, snippets_per_target=2)


def sns_pinchtab_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "X Explore Technology", "url": "https://x.com/explore/tabs/for_you?f=top"},
        {"country": "GLOBAL", "name": "Threads AI", "url": "https://www.threads.com/search?q=AI"},
        {"country": "JP", "name": "X JP Search", "url": "https://x.com/search?q=%E3%83%86%E3%82%AF&src=typed_query"},
        {"country": "KR", "name": "X KR Search", "url": "https://x.com/search?q=%EA%B8%B0%EC%88%A0&src=typed_query"},
    ]
    return collect_pinchtab_targets(SOURCE_TYPE_SNS, "sns.pinchtab", targets, snippets_per_target=2)


def community_scrapling_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Reddit Technology", "url": "https://www.reddit.com/r/technology/"},
        {"country": "JP", "name": "Hatena IT", "url": "https://b.hatena.ne.jp/hotentry/it"},
        {"country": "CN", "name": "V2EX Hot", "url": "https://www.v2ex.com/?tab=hot"},
        {"country": "KR", "name": "DCInside Stock", "url": "https://gall.dcinside.com/mgallery/board/lists/?id=stock"},
    ]
    return collect_scrapling_targets(SOURCE_TYPE_COMMUNITY, "community.scrapling", targets, snippets_per_target=2)


def community_pinchtab_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Reddit Technology", "url": "https://www.reddit.com/r/technology/"},
        {"country": "JP", "name": "Hatena IT", "url": "https://b.hatena.ne.jp/hotentry/it"},
        {"country": "CN", "name": "V2EX Hot", "url": "https://www.v2ex.com/?tab=hot"},
        {"country": "KR", "name": "DCInside Stock", "url": "https://gall.dcinside.com/mgallery/board/lists/?id=stock"},
    ]
    return collect_pinchtab_targets(SOURCE_TYPE_COMMUNITY, "community.pinchtab", targets, snippets_per_target=2)


def dev_scrapling_adapter() -> AdapterResult:
    targets = [
        {"country": "GLOBAL", "name": "GitHub Trending", "url": "https://github.com/trending"},
        {"country": "GLOBAL", "name": "DEV Community", "url": "https://dev.to/top/week"},
        {"country": "GLOBAL", "name": "Lobsters", "url": "https://lobste.rs"},
        {"country": "GLOBAL", "name": "StackOverflow Blog", "url": "https://stackoverflow.blog/"},
    ]
    return collect_scrapling_targets(SOURCE_TYPE_DEV, "dev.scrapling", targets, snippets_per_target=2)


def dev_pinchtab_adapter() -> AdapterResult:
    targets = [
        {"country": "GLOBAL", "name": "GitHub Trending", "url": "https://github.com/trending"},
        {"country": "GLOBAL", "name": "DEV Community", "url": "https://dev.to/top/week"},
        {"country": "GLOBAL", "name": "Lobsters", "url": "https://lobste.rs"},
        {"country": "GLOBAL", "name": "StackOverflow Blog", "url": "https://stackoverflow.blog/"},
    ]
    return collect_pinchtab_targets(SOURCE_TYPE_DEV, "dev.pinchtab", targets, snippets_per_target=2)


def market_scrapling_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Yahoo Finance S&P 500", "url": "https://finance.yahoo.com/quote/%5EGSPC/"},
        {"country": "JP", "name": "Yahoo Finance Nikkei", "url": "https://finance.yahoo.com/quote/%5EN225/"},
        {"country": "CN", "name": "Yahoo Finance SSE", "url": "https://finance.yahoo.com/quote/000001.SS/"},
        {"country": "KR", "name": "Yahoo Finance KOSPI", "url": "https://finance.yahoo.com/quote/%5EKS11/"},
        {"country": "US", "name": "MarketWatch Markets", "url": "https://www.marketwatch.com/markets"},
    ]
    return collect_scrapling_targets(SOURCE_TYPE_MARKET, "market.scrapling", targets, snippets_per_target=2)


def market_pinchtab_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Yahoo Finance S&P 500", "url": "https://finance.yahoo.com/quote/%5EGSPC/"},
        {"country": "JP", "name": "Yahoo Finance Nikkei", "url": "https://finance.yahoo.com/quote/%5EN225/"},
        {"country": "CN", "name": "Yahoo Finance SSE", "url": "https://finance.yahoo.com/quote/000001.SS/"},
        {"country": "KR", "name": "Yahoo Finance KOSPI", "url": "https://finance.yahoo.com/quote/%5EKS11/"},
        {"country": "US", "name": "MarketWatch Markets", "url": "https://www.marketwatch.com/markets"},
    ]
    return collect_pinchtab_targets(SOURCE_TYPE_MARKET, "market.pinchtab", targets, snippets_per_target=2)


def news_primary_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Reuters World", "url": "https://feeds.reuters.com/reuters/worldNews"},
        {"country": "JP", "name": "NHK", "url": "https://www3.nhk.or.jp/rss/news/cat0.xml"},
        {"country": "CN", "name": "Google News CN", "url": google_news_search_rss("科技 OR 经济", "CN")},
        {"country": "KR", "name": "Google News KR", "url": google_news_search_rss("기술 OR 주식", "KR")},
        {"country": "US", "name": "Google News US", "url": google_news_search_rss("technology OR market", "US")},
        {"country": "JP", "name": "Google News JP", "url": google_news_search_rss("テクノロジー OR 株式", "JP")},
    ]
    rss = collect_rss_targets("source.news", "news.rss.primary", targets)
    naver = collect_naver_korea_news("news.html.naver")
    return AdapterResult(
        adapter="news.primary",
        items=(rss.items + naver.items)[:MAX_TOTAL_ITEMS],
        warnings=rss.warnings + naver.warnings,
    )


def news_fallback_adapter() -> AdapterResult:
    targets: list[dict[str, str]] = []
    for country, query in {
        "US": "startup OR AI OR software",
        "JP": "スタートアップ OR AI OR ソフトウェア",
        "CN": "AI OR 软件 OR 市场",
        "KR": "스타트업 OR AI OR 소프트웨어",
    }.items():
        targets.append(
            {
                "country": country,
                "name": f"Google News Search {country}",
                "url": google_news_search_rss(query, country),
            }
        )
    return collect_rss_targets("source.news", "news.rss.fallback", targets)


def sns_primary_adapter() -> AdapterResult:
    targets: list[dict[str, str]] = []
    for country, query in {
        "US": "site:x.com OR site:threads.net AI OR startup",
        "JP": "site:x.com OR site:threads.net テック OR AI",
        "CN": "site:x.com OR site:threads.net 科技 OR AI",
        "KR": "site:x.com OR site:threads.net 기술 OR AI",
    }.items():
        targets.append(
            {
                "country": country,
                "name": f"SNS Search {country}",
                "url": google_news_search_rss(query, country),
            }
        )
    return collect_rss_targets(SOURCE_TYPE_SNS, "sns.search.google_news", targets)


def sns_fallback_adapter() -> AdapterResult:
    targets = [
        {
            "country": "GLOBAL",
            "name": "Nitter AI",
            "url": "https://nitter.net/search/rss?f=tweets&q=AI%20lang%3Aen",
        },
        {
            "country": "GLOBAL",
            "name": "Nitter market",
            "url": "https://nitter.net/search/rss?f=tweets&q=stock%20market%20lang%3Aen",
        },
    ]
    return collect_rss_targets(SOURCE_TYPE_SNS, "sns.search.nitter", targets)


def community_primary_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Reddit technology", "url": "https://www.reddit.com/r/technology/.rss"},
        {"country": "US", "name": "Reddit worldnews", "url": "https://www.reddit.com/r/worldnews/.rss"},
        {"country": "JP", "name": "Hatena IT", "url": "https://b.hatena.ne.jp/hotentry/it.rss"},
        {"country": "CN", "name": "V2EX", "url": "https://www.v2ex.com/index.xml"},
    ]
    return collect_rss_targets(SOURCE_TYPE_COMMUNITY, "community.rss.primary", targets)


def community_fallback_adapter() -> AdapterResult:
    return collect_dcinside_lists("community.html.dcinside")


def dev_primary_adapter() -> AdapterResult:
    targets = [
        {"country": "GLOBAL", "name": "StackOverflow Blog", "url": "https://stackoverflow.blog/feed/"},
        {"country": "GLOBAL", "name": "DEV", "url": "https://dev.to/feed"},
        {"country": "GLOBAL", "name": "Lobsters", "url": "https://lobste.rs/rss"},
        {"country": "US", "name": "Reddit programming", "url": "https://www.reddit.com/r/programming/.rss"},
    ]
    return collect_rss_targets(SOURCE_TYPE_DEV, "dev.rss.primary", targets)


def dev_fallback_adapter() -> AdapterResult:
    return collect_github_trending("dev.html.github_trending")


def market_primary_adapter() -> AdapterResult:
    quotes = collect_market_indices("market.index.stooq")
    news = collect_rss_targets(
        SOURCE_TYPE_MARKET,
        "market.rss.yahoo",
        [
            {"country": "US", "name": "Yahoo S&P500", "url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US"},
            {"country": "JP", "name": "Yahoo Nikkei", "url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EN225&region=JP&lang=ja-JP"},
            {"country": "CN", "name": "Yahoo SSE", "url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=000001.SS&region=CN&lang=zh-CN"},
            {"country": "KR", "name": "Yahoo KOSPI", "url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EKS11&region=KR&lang=ko-KR"},
        ],
    )
    return AdapterResult(
        adapter="market.primary",
        items=(quotes.items + news.items)[:MAX_TOTAL_ITEMS],
        warnings=quotes.warnings + news.warnings,
    )


def market_fallback_adapter() -> AdapterResult:
    targets: list[dict[str, str]] = []
    for country, query in {
        "US": "stock market OR earnings",
        "JP": "株式市場 OR 決算",
        "CN": "股市 OR 财报",
        "KR": "주식시장 OR 실적",
    }.items():
        targets.append(
            {
                "country": country,
                "name": f"Market Search {country}",
                "url": google_news_search_rss(query, country),
            }
        )
    return collect_rss_targets(SOURCE_TYPE_MARKET, "market.rss.fallback", targets)


SOURCE_ADAPTER_CHAIN: dict[str, list[Callable[[], AdapterResult]]] = {
    "source.news": [news_scrapling_adapter, news_pinchtab_adapter, news_primary_adapter, news_fallback_adapter],
    SOURCE_TYPE_SNS: [sns_scrapling_adapter, sns_pinchtab_adapter, sns_primary_adapter, sns_fallback_adapter],
    SOURCE_TYPE_COMMUNITY: [community_scrapling_adapter, community_pinchtab_adapter, community_primary_adapter, community_fallback_adapter],
    SOURCE_TYPE_DEV: [dev_scrapling_adapter, dev_pinchtab_adapter, dev_primary_adapter, dev_fallback_adapter],
    SOURCE_TYPE_MARKET: [market_scrapling_adapter, market_pinchtab_adapter, market_primary_adapter, market_fallback_adapter],
    "source.x": [sns_scrapling_adapter, sns_pinchtab_adapter, sns_primary_adapter, sns_fallback_adapter],
    "source.threads": [sns_scrapling_adapter, sns_pinchtab_adapter, sns_primary_adapter, sns_fallback_adapter],
    "source.reddit": [community_scrapling_adapter, community_pinchtab_adapter, community_primary_adapter, community_fallback_adapter],
    "source.hn": [dev_scrapling_adapter, dev_pinchtab_adapter, dev_primary_adapter, dev_fallback_adapter],
}


def _parse_option_list(raw: Any, max_items: int = 20) -> list[str]:
    values: list[str] = []
    if isinstance(raw, list):
        values = [trim_text(row or "", 180) for row in raw]
    elif isinstance(raw, str):
        values = [trim_text(row, 180) for row in re.split(r"[\n,]+", raw)]
    else:
        values = []
    deduped: list[str] = []
    seen: set[str] = set()
    for row in values:
        normalized = row.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(normalized)
        if len(deduped) >= max_items:
            break
    return deduped


def _normalize_dynamic_source_options(raw: dict[str, Any] | None) -> dict[str, Any]:
    payload = raw if isinstance(raw, dict) else {}
    keywords = _parse_option_list(payload.get("keywords"), max_items=12)
    countries_raw = _parse_option_list(payload.get("countries"), max_items=8)
    countries = [row.upper() for row in countries_raw if row.upper() in LOCALE_BY_COUNTRY]
    sites_raw = _parse_option_list(payload.get("sites"), max_items=24)
    urls: list[str] = []
    domains: list[str] = []
    for row in sites_raw:
        candidate = row.strip()
        if not candidate:
            continue
        if candidate.startswith("http://") or candidate.startswith("https://"):
            urls.append(candidate)
            continue
        normalized_domain = candidate.lower().replace("https://", "").replace("http://", "").strip("/")
        if normalized_domain:
            domains.append(normalized_domain)

    max_items = 0
    max_items_raw = payload.get("max_items")
    try:
        max_items = int(max_items_raw) if max_items_raw is not None else 0
    except Exception:
        max_items = 0
    max_items = max(0, min(120, max_items))

    targets_raw = payload.get("targets")
    targets: list[dict[str, Any]] = []
    if isinstance(targets_raw, list):
        for index, row in enumerate(targets_raw[:24]):
            if not isinstance(row, dict):
                continue
            url = str(row.get("url") or "").strip()
            if not url.startswith("http://") and not url.startswith("https://"):
                continue
            targets.append(
                {
                    "url": url,
                    "host": str(row.get("host") or parse_host(url) or "").strip().lower(),
                    "collector_strategy": str(row.get("collectorStrategy") or row.get("collector_strategy") or "").strip().lower(),
                    "interaction_mode": str(row.get("interactionMode") or row.get("interaction_mode") or "passive").strip().lower(),
                    "requires_browser": bool(row.get("requiresBrowser") or row.get("requires_browser")),
                    "interaction_steps": row.get("interactionSteps") if isinstance(row.get("interactionSteps"), list) else [],
                    "position": index,
                }
            )

    allowed_domains_raw = _parse_option_list(payload.get("allowed_domains"), max_items=24)
    allowed_domains = [row.lower().strip().strip("/") for row in allowed_domains_raw if row.strip()]
    strict_domain_isolation = bool(payload.get("strict_domain_isolation"))
    planner = payload.get("planner") if isinstance(payload.get("planner"), dict) else {}
    preferred_execution_order = [
        str(value or "").strip().lower()
        for value in _parse_option_list(payload.get("preferred_execution_order"), max_items=4)
        if str(value or "").strip().lower() in {"rss", "scrapling", "pinchtab", "urls"}
    ]
    if not preferred_execution_order:
        preferred_execution_order = ["rss", "scrapling", "pinchtab", "urls"]

    return {
        "keywords": keywords,
        "countries": countries,
        "urls": urls,
        "domains": domains,
        "allowed_domains": allowed_domains,
        "strict_domain_isolation": strict_domain_isolation,
        "planner": planner,
        "preferred_execution_order": preferred_execution_order,
        "max_items": max_items,
        "targets": targets,
    }


def _default_query_for_source(source_type: str) -> str:
    if source_type == "source.news":
        return "technology OR startup OR market"
    if source_type in {SOURCE_TYPE_SNS, "source.x", "source.threads"}:
        return "AI OR game dev OR startup"
    if source_type in {SOURCE_TYPE_COMMUNITY, "source.reddit"}:
        return "game dev OR indie OR steam"
    if source_type in {SOURCE_TYPE_DEV, "source.hn"}:
        return "unity OR gamedev OR programming"
    if source_type == SOURCE_TYPE_MARKET:
        return "stock market OR earnings OR tech market"
    return "technology OR trend"


def _build_dynamic_google_news_targets(source_type: str, options: dict[str, Any]) -> list[dict[str, str]]:
    countries = list(options.get("countries") or [])
    if not countries:
        countries = ["US", "JP", "CN", "KR"]
    keywords = list(options.get("keywords") or [])
    domains = list(options.get("domains") or [])
    base_query = " OR ".join(keywords[:6]) if keywords else _default_query_for_source(source_type)
    if domains:
        site_clause = " OR ".join([f"site:{domain}" for domain in domains[:8]])
        query = f"({base_query}) AND ({site_clause})"
    else:
        query = base_query
    targets: list[dict[str, str]] = []
    for country in countries:
        targets.append(
            {
                "country": country,
                "name": f"Custom {SOURCE_TYPE_LABEL.get(source_type, source_type)} {country}",
                "url": google_news_search_rss(query, country),
            }
        )
    return targets


def _is_disallowed_dynamic_host(hostname: str | None) -> bool:
    host = str(hostname or "").strip().lower().rstrip(".")
    if not host:
        return True
    if host in {"localhost", "0.0.0.0", "::1"} or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast)
    except Exception:
        pass
    try:
        for _, _, _, _, sockaddr in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(str(sockaddr[0]))
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return True
    except Exception:
        return False
    return False


def _filter_safe_dynamic_targets(targets: list[dict[str, Any]], adapter: str) -> tuple[list[dict[str, Any]], list[str]]:
    safe: list[dict[str, Any]] = []
    warnings: list[str] = []
    for row in targets:
        url = str(row.get("url") or "").strip()
        host = str(row.get("host") or parse_host(url) or "").strip().lower()
        if _is_disallowed_dynamic_host(host):
            warnings.append(f"{adapter}: blocked unsafe target host {host or url}")
            continue
        safe.append(row)
    return safe, warnings


def _host_matches_allowed_domains(host: str, allowed_domains: list[str]) -> bool:
    normalized_host = str(host or "").strip().lower()
    if not normalized_host:
        return False
    for domain in allowed_domains:
        normalized_domain = str(domain or "").strip().lower()
        if not normalized_domain:
            continue
        if normalized_host == normalized_domain or normalized_host.endswith(f".{normalized_domain}"):
            return True
    return False


def _filter_items_by_allowed_domains(
    items: list[dict[str, Any]],
    allowed_domains: list[str],
    adapter: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    if not allowed_domains:
        return items, []
    filtered: list[dict[str, Any]] = []
    warnings: list[str] = []
    for row in items:
        host = parse_host(str(row.get("url") or "")) or str(row.get("source_name") or "")
        if _host_matches_allowed_domains(host, allowed_domains):
            filtered.append(row)
            continue
        warnings.append(f"{adapter}: dropped out-of-scope item from {host or 'unknown host'}")
    return filtered, warnings


def _extract_custom_snippets_from_html(html_text: str, limit: int = 3) -> list[str]:
    if not html_text.strip():
        return []
    payload = re.sub(r"<(script|style|noscript|svg|iframe)[^>]*>.*?</\\1>", " ", html_text, flags=re.IGNORECASE | re.DOTALL)
    payload = re.sub(r"<[^>]+>", " ", payload)
    payload = unescape(payload)
    payload = re.sub(r"\s+", " ", payload).strip()
    snippets = parse_pinchtab_snippets(payload, limit=max(1, limit))
    if snippets:
        return snippets
    fallback = trim_text(payload, 220)
    return [fallback] if fallback else []


def collect_custom_url_targets(
    source_type: str,
    adapter: str,
    targets: list[dict[str, str]],
    *,
    snippets_per_target: int = 2,
) -> AdapterResult:
    warnings: list[str] = []
    items: list[dict[str, Any]] = []
    for target in targets:
        if len(items) >= MAX_TOTAL_ITEMS:
            break
        target_url = str(target.get("url") or "").strip()
        if not target_url:
            continue
        country = str(target.get("country") or "GLOBAL")
        source_name = str(target.get("name") or parse_host(target_url) or "custom")
        try:
            text, status, content_type = http_get_text(target_url, timeout=REQUEST_TIMEOUT_SECONDS)
            if status < 200 or status >= 300:
                warnings.append(f"{adapter}: status {status} for {target_url}")
                continue
            if ("xml" in content_type.lower() or "<rss" in text.lower() or "<feed" in text.lower()) and len(text) < 2_000_000:
                parsed = parse_rss_items(text, limit=max(1, snippets_per_target))
                for index, row in enumerate(parsed, start=1):
                    items.append(
                        make_item(
                            source_type=source_type,
                            source_name=source_name,
                            country=country,
                            adapter=adapter,
                            title=row.get("title") or f"custom-{index}",
                            url=row.get("url") or target_url,
                            summary=row.get("summary") or row.get("title") or "",
                            published_at=row.get("published_at"),
                            extra={"headline": True, "hot_rank": len(items) + 1},
                        )
                    )
                    if len(items) >= MAX_TOTAL_ITEMS:
                        break
                continue
            snippets = _extract_custom_snippets_from_html(text, limit=max(1, snippets_per_target))
            if not snippets:
                warnings.append(f"{adapter}: empty content for {target_url}")
                continue
            for snippet in snippets:
                items.append(
                    make_item(
                        source_type=source_type,
                        source_name=source_name,
                        country=country,
                        adapter=adapter,
                        title=trim_text(snippet, 130),
                        url=target_url,
                        summary=snippet,
                        published_at=None,
                        extra={"headline": True, "hot_rank": len(items) + 1},
                    )
                )
                if len(items) >= MAX_TOTAL_ITEMS:
                    break
        except Exception as exc:
            warnings.append(f"{adapter}: {trim_text(exc, 200)}")
    return AdapterResult(adapter=adapter, items=items[:MAX_TOTAL_ITEMS], warnings=warnings)


def execute_dynamic_source_query(source_type: str, source_options: dict[str, Any]) -> AdapterResult | None:
    options = _normalize_dynamic_source_options(source_options)
    urls = list(options.get("urls") or [])
    keywords = list(options.get("keywords") or [])
    domains = list(options.get("domains") or [])
    allowed_domains = [str(value or "").strip().lower() for value in list(options.get("allowed_domains") or domains or []) if str(value or "").strip()]
    strict_domain_isolation = bool(options.get("strict_domain_isolation")) and bool(allowed_domains)
    preferred_execution_order = [str(value or "").strip().lower() for value in list(options.get("preferred_execution_order") or []) if str(value or "").strip()]
    countries = list(options.get("countries") or [])
    targets = list(options.get("targets") or [])
    is_dynamic_requested = bool(urls or keywords or domains or countries or targets)
    if not is_dynamic_requested:
        return None

    warnings: list[str] = []
    items: list[dict[str, Any]] = []
    if targets:
        normalized_targets = [
            {
                "country": "GLOBAL",
                "name": str(row.get("host") or parse_host(str(row.get("url") or "")) or "custom-url"),
                "url": str(row.get("url") or ""),
                "collector_strategy": str(row.get("collector_strategy") or ""),
            }
            for row in targets
        ]
        safe_targets, safety_warnings = _filter_safe_dynamic_targets(normalized_targets, f"{source_type}.dynamic")
        warnings.extend(safety_warnings)
        rss_targets = [row for row in safe_targets if str(row.get("collector_strategy") or "") == "rss"]
        scrapling_targets = [row for row in safe_targets if str(row.get("collector_strategy") or "") == "scrapling"]
        pinchtab_targets = [row for row in safe_targets if str(row.get("collector_strategy") or "") == "pinchtab"]
        fallback_targets = [
            row for row in safe_targets if str(row.get("collector_strategy") or "") not in {"rss", "scrapling", "pinchtab"}
        ]

        target_groups: dict[str, list[dict[str, Any]]] = {
            "rss": rss_targets,
            "scrapling": scrapling_targets,
            "pinchtab": pinchtab_targets,
            "urls": fallback_targets,
        }
        for strategy in preferred_execution_order:
            strategy_targets = target_groups.get(strategy) or []
            if not strategy_targets:
                continue
            if strategy == "rss":
                strategy_result = collect_custom_url_targets(source_type, f"{source_type}.dynamic.rss", strategy_targets, snippets_per_target=3)
            elif strategy == "scrapling":
                strategy_result = collect_scrapling_targets(
                    source_type,
                    f"{source_type}.dynamic.scrapling",
                    strategy_targets,
                    snippets_per_target=3,
                )
            elif strategy == "pinchtab":
                strategy_result = collect_pinchtab_targets(
                    source_type,
                    f"{source_type}.dynamic.pinchtab",
                    strategy_targets,
                    snippets_per_target=3,
                )
            else:
                strategy_result = collect_custom_url_targets(
                    source_type,
                    f"{source_type}.dynamic.urls",
                    strategy_targets,
                    snippets_per_target=3,
                )
            items.extend(strategy_result.items)
            warnings.extend(strategy_result.warnings)
        if strict_domain_isolation:
            items, domain_warnings = _filter_items_by_allowed_domains(items, allowed_domains, f"{source_type}.dynamic.scope")
            warnings.extend(domain_warnings)
        if items:
            return AdapterResult(adapter=f"{source_type}.dynamic", items=items[:MAX_TOTAL_ITEMS], warnings=warnings)
    elif urls:
        custom_url_targets = [
            {
                "country": "GLOBAL",
                "name": parse_host(url) or "custom-url",
                "url": url,
            }
            for url in urls
        ]
        safe_targets, safety_warnings = _filter_safe_dynamic_targets(custom_url_targets, f"{source_type}.dynamic.urls")
        warnings.extend(safety_warnings)
        custom_result = collect_custom_url_targets(source_type, f"{source_type}.dynamic.urls", safe_targets, snippets_per_target=3)
        items.extend(custom_result.items)
        warnings.extend(custom_result.warnings)
        if strict_domain_isolation:
            items, domain_warnings = _filter_items_by_allowed_domains(items, allowed_domains, f"{source_type}.dynamic.scope")
            warnings.extend(domain_warnings)
        if items:
            return AdapterResult(adapter=f"{source_type}.dynamic", items=items[:MAX_TOTAL_ITEMS], warnings=warnings)

    rss_targets = _build_dynamic_google_news_targets(source_type, options)
    if rss_targets:
        dynamic_rss_result = collect_rss_targets(source_type, f"{source_type}.dynamic.search", rss_targets)
        items.extend(dynamic_rss_result.items)
        warnings.extend(dynamic_rss_result.warnings)
    if strict_domain_isolation:
        items, domain_warnings = _filter_items_by_allowed_domains(items, allowed_domains, f"{source_type}.dynamic.scope")
        warnings.extend(domain_warnings)

    if items:
        return AdapterResult(adapter=f"{source_type}.dynamic", items=items[:MAX_TOTAL_ITEMS], warnings=warnings)
    return AdapterResult(adapter=f"{source_type}.dynamic", items=[], warnings=warnings)


def _is_parallel_crawler_adapter(adapter: Callable[[], AdapterResult]) -> bool:
    name = str(getattr(adapter, "__name__", "") or "").strip().lower()
    return name.endswith("_scrapling_adapter") or name.endswith("_pinchtab_adapter")


def _dedupe_adapter_items(items: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in items:
        key = stable_id(
            str(row.get("url") or ""),
            str(row.get("title") or ""),
            str(row.get("source_name") or row.get("source") or ""),
            str(row.get("country") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
        if len(deduped) >= limit:
            break
    return deduped


def _run_parallel_crawler_adapters(
    source_type: str,
    adapters: list[Callable[[], AdapterResult]],
    *,
    limit: int,
) -> AdapterResult:
    if not adapters:
        return AdapterResult(adapter=f"{source_type}.parallel", items=[], warnings=[])

    warnings: list[str] = []
    items: list[dict[str, Any]] = []
    adapter_names: list[str] = []

    with ThreadPoolExecutor(max_workers=max(1, min(4, len(adapters)))) as executor:
        future_by_adapter = {
            executor.submit(adapter): adapter
            for adapter in adapters
        }
        for future in as_completed(future_by_adapter):
            adapter_fn = future_by_adapter[future]
            fn_name = str(getattr(adapter_fn, "__name__", "") or "adapter")
            try:
                result = future.result()
            except Exception as exc:
                warnings.append(f"{fn_name}: {trim_text(exc, 180)}")
                continue
            warnings.extend(result.warnings)
            items.extend(result.items)
            normalized_adapter_name = str(result.adapter or "").strip()
            if normalized_adapter_name:
                adapter_names.append(normalized_adapter_name)

    deduped_items = _dedupe_adapter_items(items, limit=limit)
    if adapter_names:
        merged_adapter_label = f"{source_type}.parallel[{'+'.join(sorted(set(adapter_names)))}]"
    else:
        merged_adapter_label = f"{source_type}.parallel"
    return AdapterResult(adapter=merged_adapter_label, items=deduped_items, warnings=warnings)


def execute_source_node(source_type: str, source_options: dict[str, Any] | None = None) -> AdapterResult:
    chain = SOURCE_ADAPTER_CHAIN.get(source_type) or []
    options = _normalize_dynamic_source_options(source_options)
    max_items = int(options.get("max_items") or 0)
    if max_items <= 0:
        max_items = MAX_TOTAL_ITEMS

    dynamic_result = execute_dynamic_source_query(source_type, options)
    if dynamic_result is not None:
        return AdapterResult(
            adapter=dynamic_result.adapter,
            items=dynamic_result.items[:max_items],
            warnings=dynamic_result.warnings,
        )

    warnings: list[str] = []

    parallel_adapters = [adapter for adapter in chain if _is_parallel_crawler_adapter(adapter)]
    sequential_adapters = [adapter for adapter in chain if not _is_parallel_crawler_adapter(adapter)]

    if parallel_adapters:
        parallel_result = _run_parallel_crawler_adapters(
            source_type,
            parallel_adapters,
            limit=max_items,
        )
        warnings.extend(parallel_result.warnings)
        if parallel_result.items:
            return AdapterResult(
                adapter=parallel_result.adapter,
                items=parallel_result.items[:max_items],
                warnings=warnings,
            )

    for adapter in sequential_adapters:
        result = adapter()
        warnings.extend(result.warnings)
        if result.items:
            return AdapterResult(adapter=result.adapter, items=result.items[:max_items], warnings=warnings)

    normalized = LEGACY_SOURCE_TYPE_MAP.get(source_type, source_type)
    warnings.append(f"{normalized}: all adapters returned empty")
    return AdapterResult(adapter="empty", items=[], warnings=warnings)


def is_fallback_item(row: dict[str, Any]) -> bool:
    if bool(row.get("fallback")):
        return True
    adapter = str(row.get("adapter") or "").strip().lower()
    if adapter in {"fallback", "empty"}:
        return True
    url = str(row.get("url") or "").strip().lower()
    if "fallback.local/empty" in url:
        return True
    title = str(row.get("title") or "").strip()
    if title.endswith("수집 결과 없음"):
        return True
    return False


def display_source_type(source_type: str) -> str:
    normalized = LEGACY_SOURCE_TYPE_MAP.get(source_type, source_type)
    return SOURCE_TYPE_LABEL.get(normalized, normalized or "기타")


def parse_numeric_signal(value: Any) -> int:
    text = trim_text(value or "", 60)
    if not text:
        return 0
    normalized = re.sub(r"[^0-9]", "", text)
    if not normalized:
        return 0
    try:
        return int(normalized)
    except Exception:
        return 0


def has_hot_topic_keyword(*parts: Any) -> bool:
    merged = " ".join(trim_text(part or "", 400).lower() for part in parts if trim_text(part or "", 400))
    if not merged:
        return False
    return any(keyword in merged for keyword in HOT_TOPIC_KEYWORDS)


def hot_topic_signal_score(row: dict[str, Any]) -> int:
    score = 0
    hot_rank = parse_numeric_signal(row.get("hot_rank") or row.get("rank"))
    if hot_rank > 0:
        score += max(0, 30 - min(hot_rank, 30))

    if has_hot_topic_keyword(row.get("title"), row.get("summary"), row.get("source_name")):
        score += 8

    url = str(row.get("url") or "").strip().lower()
    if any(marker in url for marker in HOT_URL_MARKERS):
        score += 6

    score += min(22, parse_numeric_signal(row.get("engagement")) // 20)
    score += min(18, parse_numeric_signal(row.get("upvotes")) // 20)
    score += min(12, parse_numeric_signal(row.get("comments")) // 10)
    score += min(20, parse_numeric_signal(row.get("view_count")) // 500)
    score += min(14, parse_numeric_signal(row.get("stars_today")) // 10)
    score += min(10, parse_numeric_signal(row.get("like_count")) // 20)
    score += min(10, parse_numeric_signal(row.get("repost_count")) // 10)
    return score


def normalize_items(raw_items: list[dict[str, Any]], limit: int = MAX_TOTAL_ITEMS) -> list[dict[str, Any]]:
    effective_items = [row for row in raw_items if isinstance(row, dict) and not is_fallback_item(row)]
    source = effective_items if effective_items else raw_items
    dedup: dict[str, dict[str, Any]] = {}
    for row in source:
        title = trim_text(row.get("title") or "", 220)
        url = trim_text(row.get("url") or "", 500)
        if not title and not url:
            continue
        key = stable_id(url or "", title.lower())
        if key not in dedup:
            merged = dict(row)
            merged["normalized_key"] = key
            merged["source_count"] = 1
            dedup[key] = merged
            continue

        existing = dedup[key]
        existing["source_count"] = int(existing.get("source_count") or 1) + 1
        if len(trim_text(row.get("summary") or "", 420)) > len(trim_text(existing.get("summary") or "", 420)):
            existing["summary"] = trim_text(row.get("summary") or "", 420)
        if parse_numeric_signal(existing.get("hot_rank")) == 0:
            existing["hot_rank"] = row.get("hot_rank")
        else:
            incoming_rank = parse_numeric_signal(row.get("hot_rank"))
            current_rank = parse_numeric_signal(existing.get("hot_rank"))
            if incoming_rank > 0 and (current_rank == 0 or incoming_rank < current_rank):
                existing["hot_rank"] = incoming_rank
        existing["hot_topic_hint"] = bool(existing.get("hot_topic_hint") or row.get("hot_topic_hint"))
        for signal in ("engagement", "upvotes", "comments", "view_count", "stars_today", "like_count", "repost_count"):
            incoming = parse_numeric_signal(row.get(signal))
            current = parse_numeric_signal(existing.get(signal))
            if incoming > current:
                existing[signal] = row.get(signal)

    return list(dedup.values())[:limit]


def verify_item_status(item: dict[str, Any]) -> str:
    title = trim_text(item.get("title") or "", 220).lower()
    domain = parse_host(str(item.get("url") or ""))
    has_negative = any(keyword in title for keyword in CONFLICT_NEGATIVE_KEYWORDS)
    has_positive = any(keyword in title for keyword in CONFLICT_POSITIVE_KEYWORDS)
    if has_negative and has_positive:
        return "conflicted"
    if domain in TRUSTED_DOMAINS:
        return "verified"
    return "warning"


def verify_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    verified: list[dict[str, Any]] = []
    for row in items:
        next_row = dict(row)
        next_row["verification_status"] = verify_item_status(next_row)
        verified.append(next_row)
    return verified


def rank_items(items: list[dict[str, Any]], top_k: int = 40) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)

    for row in items:
        source_type = str(row.get("source_type") or "source.news")
        base = SOURCE_TYPE_WEIGHT.get(source_type, 52)
        published_raw = parse_datetime_iso(str(row.get("published_at") or ""))
        freshness = 6
        if published_raw:
            try:
                delta = now - datetime.fromisoformat(published_raw.replace("Z", "+00:00"))
                hours = max(0.0, delta.total_seconds() / 3600.0)
                freshness = max(0, int(26 - min(hours, 26)))
            except Exception:
                freshness = 6

        verification = str(row.get("verification_status") or "warning")
        verification_bonus = 15 if verification == "verified" else 0
        if verification == "conflicted":
            verification_bonus = -10

        source_count = int(row.get("source_count") or 1)
        popularity = hot_topic_signal_score(row)
        score = base + freshness + verification_bonus + min(source_count, 5) + popularity

        next_row = dict(row)
        next_row["score"] = int(score)
        next_row["hot_score"] = int(popularity)
        ranked.append(next_row)

    ranked.sort(key=lambda item: (int(item.get("score") or 0), str(item.get("published_at") or "")), reverse=True)

    selected = ranked[:top_k]
    selected_ids = {str(row.get("id") or "") for row in selected}
    selected_types = {str(row.get("source_type") or "") for row in selected}
    required_ids: set[str] = set()
    required_source_types = ["source.news", SOURCE_TYPE_SNS, SOURCE_TYPE_COMMUNITY, SOURCE_TYPE_DEV, SOURCE_TYPE_MARKET]
    for source_type in required_source_types:
        if source_type in selected_types:
            continue
        candidate = next((row for row in ranked if str(row.get("source_type") or "") == source_type), None)
        if candidate is None:
            continue
        candidate_id = str(candidate.get("id") or "")
        if candidate_id in selected_ids:
            selected_types.add(source_type)
            continue
        selected.append(candidate)
        required_ids.add(candidate_id)
        selected_ids = {str(row.get("id") or "") for row in selected}
        selected_types = {str(row.get("source_type") or "") for row in selected}

    selected.sort(
        key=lambda item: (
            1 if str(item.get("id") or "") in required_ids else 0,
            int(item.get("score") or 0),
            str(item.get("published_at") or ""),
        ),
        reverse=True,
    )
    return selected[:top_k]


def summarize_ranked_items(items: list[dict[str, Any]], max_lines: int = 8) -> list[str]:
    lines: list[str] = []
    for row in items:
        if is_fallback_item(row):
            continue
        country = str(row.get("country") or "GLOBAL")
        source = str(row.get("source_name") or display_source_type(str(row.get("source_type") or "")) or "source")
        status = str(row.get("verification_status") or "warning")
        hot_score = int(row.get("hot_score") or hot_topic_signal_score(row))
        title = translate_to_korean(str(row.get("title_ko") or row.get("title") or ""), 180)
        excerpt = trim_text(row.get("content_excerpt") or row.get("summary") or "", 140)
        excerpt = translate_to_korean(str(row.get("content_excerpt_ko") or row.get("summary_ko") or excerpt), 160)
        hot_tag = "핫토픽" if hot_score >= 10 or bool(row.get("hot_topic_hint")) else "일반"
        if excerpt:
            lines.append(f"[{country}] ({status}/{hot_tag}) {source}: {title} - {excerpt}")
        else:
            lines.append(f"[{country}] ({status}/{hot_tag}) {source}: {title}")
        if len(lines) >= max_lines:
            break
    return lines


def localize_ranked_items_for_ko(items: list[dict[str, Any]], max_items: int = 24) -> list[dict[str, Any]]:
    localized: list[dict[str, Any]] = []
    for index, row in enumerate(items):
        next_row = dict(row)
        if index < max_items:
            title = trim_text(next_row.get("title") or "", 220)
            if title:
                next_row["title_ko"] = translate_to_korean(title, 220)
            summary = trim_text(next_row.get("summary") or "", 380)
            if summary:
                next_row["summary_ko"] = translate_to_korean(summary, 380)
            excerpt = trim_text(next_row.get("content_excerpt") or "", 380)
            if excerpt:
                next_row["content_excerpt_ko"] = translate_to_korean(excerpt, 380)
        localized.append(next_row)
    return localized


def build_codex_cli_prompt(
    items: list[dict[str, Any]],
    topic: str,
    max_items: int = 18,
) -> str:
    lines: list[str] = []
    lines.append("당신은 한국어 리서치 브리핑 작성자다.")
    lines.append("입력 데이터만 사용하고, 추측/환각 없이 요약한다.")
    lines.append("출력은 반드시 JSON 하나만 반환한다. 마크다운/코드블록 금지.")
    lines.append(
        'JSON 스키마: {"headline":"string","highlights":["string"],"detail_markdown":"string","key_points":[{"title":"string","summary":"string","source":"string","url":"string"}]}'
    )
    lines.append("조건:")
    lines.append("- 모든 문장은 한국어.")
    lines.append("- highlights는 5~8개.")
    lines.append("- detail_markdown은 리서치 리포트 스타일로, 사람이 바로 읽을 수 있는 완결된 문서여야 한다.")
    lines.append("- detail_markdown에는 반드시 '## 핵심 결론', '## 토픽별 상세 분석', '## 리스크와 불확실성', '## 지금 바로 볼 체크리스트' 섹션 포함.")
    lines.append("- detail_markdown 각 섹션은 데이터 기반 근거를 포함하고, URL 근거를 항목 단위로 명시한다.")
    lines.append("- 단순 나열/로그 형식 금지. 맥락-원인-영향-시사점 순서로 서술한다.")
    lines.append("- key_points는 최대 8개.")
    if topic:
        lines.append(f"- 요청 주제: {topic}")
    lines.append("")
    lines.append("수집 데이터:")
    for index, row in enumerate(items[:max_items], start=1):
        country = trim_text(row.get("country") or "GLOBAL", 20)
        source = trim_text(row.get("source_name") or display_source_type(str(row.get("source_type") or "")), 80)
        title = trim_text(row.get("title_ko") or row.get("title") or "", 220)
        hot_rank = parse_numeric_signal(row.get("hot_rank"))
        hot_score = int(row.get("hot_score") or hot_topic_signal_score(row))
        summary = trim_text(
            row.get("content_excerpt_ko")
            or row.get("summary_ko")
            or row.get("content_excerpt")
            or row.get("summary")
            or "",
            400,
        )
        url = trim_text(row.get("url") or "", 500)
        lines.append(f"{index}. [{country}] {source}")
        lines.append(f"   title: {title}")
        if hot_rank > 0:
            lines.append(f"   hot_rank: {hot_rank}")
        lines.append(f"   hot_score: {hot_score}")
        if summary:
            lines.append(f"   summary: {summary}")
        if url:
            lines.append(f"   url: {url}")
    return "\n".join(lines).strip()


def parse_json_object_block(raw_text: str) -> dict[str, Any] | None:
    text = str(raw_text or "").strip()
    if not text:
        return None
    candidates: list[str] = [text]
    fenced = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        candidates.append(fenced.group(1).strip())
    braces = re.search(r"(\{.*\})", text, flags=re.DOTALL)
    if braces:
        candidates.append(braces.group(1).strip())

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def parse_bullet_lines(raw_text: str, max_lines: int = 8) -> list[str]:
    lines: list[str] = []
    for row in str(raw_text or "").splitlines():
        normalized = row.strip()
        if not normalized:
            continue
        normalized = re.sub(r"^[-*]\s*", "", normalized).strip()
        if not normalized:
            continue
        lines.append(translate_to_korean(normalized, 220))
        if len(lines) >= max_lines:
            break
    return lines


def parse_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except Exception:
        return None
    return number if number >= 0 else None


def normalize_usage_candidate(raw: Any) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}
    prompt_tokens = parse_int(raw.get("input_tokens"))
    if prompt_tokens is None:
        prompt_tokens = parse_int(raw.get("prompt_tokens"))
    completion_tokens = parse_int(raw.get("output_tokens"))
    if completion_tokens is None:
        completion_tokens = parse_int(raw.get("completion_tokens"))
    total_tokens = parse_int(raw.get("total_tokens"))
    reasoning_tokens = parse_int(raw.get("reasoning_tokens"))
    cached_input_tokens = parse_int(raw.get("cached_input_tokens"))
    if cached_input_tokens is None:
        cached_input_tokens = parse_int(raw.get("cached_tokens"))

    if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
        total_tokens = prompt_tokens + completion_tokens

    usage: dict[str, int] = {}
    if prompt_tokens is not None:
        usage["prompt_tokens"] = prompt_tokens
    if completion_tokens is not None:
        usage["completion_tokens"] = completion_tokens
    if total_tokens is not None:
        usage["total_tokens"] = total_tokens
    if reasoning_tokens is not None:
        usage["reasoning_tokens"] = reasoning_tokens
    if cached_input_tokens is not None:
        usage["cached_input_tokens"] = cached_input_tokens
    return usage


def merge_usage_dict(base: dict[str, int], candidate: dict[str, int]) -> dict[str, int]:
    if not candidate:
        return base
    if not base:
        return dict(candidate)
    base_total = int(base.get("total_tokens") or -1)
    candidate_total = int(candidate.get("total_tokens") or -1)
    if candidate_total > base_total:
        merged = dict(base)
        merged.update(candidate)
        return merged
    merged = dict(base)
    for key, value in candidate.items():
        if key not in merged:
            merged[key] = value
    return merged


def extract_usage_from_value(value: Any) -> dict[str, int]:
    usage = normalize_usage_candidate(value)
    if usage:
        return usage
    if isinstance(value, dict):
        merged: dict[str, int] = {}
        nested_usage = normalize_usage_candidate(value.get("usage"))
        if nested_usage:
            merged = merge_usage_dict(merged, nested_usage)
        for nested in value.values():
            merged = merge_usage_dict(merged, extract_usage_from_value(nested))
        return merged
    if isinstance(value, list):
        merged: dict[str, int] = {}
        for nested in value:
            merged = merge_usage_dict(merged, extract_usage_from_value(nested))
        return merged
    return {}


def parse_codex_usage_from_jsonl(stdout_text: str) -> dict[str, int]:
    usage: dict[str, int] = {}
    for row in str(stdout_text or "").splitlines():
        line = row.strip()
        if not line.startswith("{"):
            continue
        try:
            payload = json.loads(line)
        except Exception:
            continue
        usage = merge_usage_dict(usage, extract_usage_from_value(payload))
    return usage


def format_codex_usage_line(usage: dict[str, int]) -> str:
    if not usage:
        return "usage=unavailable"
    parts: list[str] = []
    prompt_tokens = parse_int(usage.get("prompt_tokens"))
    completion_tokens = parse_int(usage.get("completion_tokens"))
    total_tokens = parse_int(usage.get("total_tokens"))
    if prompt_tokens is not None:
        parts.append(f"in={prompt_tokens}")
    if completion_tokens is not None:
        parts.append(f"out={completion_tokens}")
    if total_tokens is not None:
        parts.append(f"total={total_tokens}")
    reasoning_tokens = parse_int(usage.get("reasoning_tokens"))
    if reasoning_tokens is not None:
        parts.append(f"reasoning={reasoning_tokens}")
    cached_input_tokens = parse_int(usage.get("cached_input_tokens"))
    if cached_input_tokens is not None:
        parts.append(f"cached_in={cached_input_tokens}")
    return "usage=" + (", ".join(parts) if parts else "unavailable")


def run_codex_cli_briefing(
    items: list[dict[str, Any]],
    topic: str,
    run_root: Path,
) -> tuple[str, list[str], list[str], dict[str, int]]:
    if not env_flag_enabled(CODEX_EXEC_ENABLED_ENV, default=True):
        return "", [], ["codex.cli: disabled by env"], {}
    if not items:
        return "", [], ["codex.cli: no ranked items"], {}

    codex_bin = env_text(CODEX_EXEC_BIN_ENV, "codex")
    model = env_text(CODEX_EXEC_MODEL_ENV, "")
    timeout_sec = env_float(CODEX_EXEC_TIMEOUT_ENV, 90.0, min_value=20.0, max_value=300.0)
    prompt = build_codex_cli_prompt(items, topic)

    output_file = run_root / "codex_last_message.txt"
    args = [
        codex_bin,
        "exec",
        "--skip-git-repo-check",
        "--full-auto",
        "--sandbox",
        "workspace-write",
        "--json",
        "--output-last-message",
        str(output_file),
        "-",
    ]
    if model:
        args.extend(["-m", model])

    try:
        completed = subprocess.run(
            args,
            input=prompt,
            text=True,
            capture_output=True,
            cwd=str(run_root),
            timeout=timeout_sec,
            check=False,
        )
    except FileNotFoundError:
        return "", [], [f"codex.cli: binary not found ({codex_bin})"], {}
    except Exception as exc:
        return "", [], [f"codex.cli: spawn failed ({trim_text(exc, 200)})"], {}

    stderr = trim_text(completed.stderr or "", 320)
    usage = parse_codex_usage_from_jsonl(completed.stdout or "")
    if completed.returncode != 0:
        warning = f"codex.cli: exit={completed.returncode}"
        if stderr:
            warning = f"{warning}, {stderr}"
        return "", [], [warning], usage

    raw_output = ""
    if output_file.is_file():
        try:
            raw_output = output_file.read_text(encoding="utf-8").strip()
        except Exception:
            raw_output = ""
    if not raw_output:
        raw_output = trim_text(completed.stdout or "", 24000)
    if not raw_output:
        return "", [], ["codex.cli: empty response"], usage

    parsed = parse_json_object_block(raw_output)
    if parsed:
        headline = translate_to_korean(str(parsed.get("headline") or ""), 200)
        highlights_raw = parsed.get("highlights")
        highlights = (
            [translate_to_korean(str(row or ""), 220) for row in highlights_raw if str(row or "").strip()]
            if isinstance(highlights_raw, list)
            else []
        )
        detail_markdown = translate_to_korean(
            str(parsed.get("detail_markdown") or ""),
            0,
            source_max_len=None,
            preserve_newlines=True,
        )
        key_points = parsed.get("key_points")
        detail_lines: list[str] = []
        if detail_markdown:
            detail_lines.append(detail_markdown)
        if isinstance(key_points, list) and key_points:
            if detail_lines:
                detail_lines.append("")
            detail_lines.append("## 근거 포인트")
            for row in key_points[:8]:
                if not isinstance(row, dict):
                    continue
                title = translate_to_korean(str(row.get("title") or ""), 180)
                summary = translate_to_korean(str(row.get("summary") or ""), 220)
                source = translate_to_korean(str(row.get("source") or ""), 80)
                url = trim_text(row.get("url") or "", 500)
                if title:
                    detail_lines.append(f"- {title}")
                if summary:
                    detail_lines.append(f"  - 요약: {summary}")
                if source:
                    detail_lines.append(f"  - 출처: {source}")
                if url:
                    detail_lines.append(f"  - URL: {url}")
        briefing = "\n".join(detail_lines).strip()
        final_highlights = highlights[:8]
        if headline:
            final_highlights = [headline, *final_highlights][:8]
        return briefing, final_highlights, [], usage

    fallback_highlights = parse_bullet_lines(raw_output, max_lines=8)
    briefing = translate_to_korean(
        raw_output,
        0,
        source_max_len=None,
        preserve_newlines=True,
    )
    return briefing, fallback_highlights, ["codex.cli: non-json response parsed as text"], usage


def build_source_coverage(items: list[dict[str, Any]]) -> dict[str, Any]:
    by_source: dict[str, int] = {}
    by_country: dict[str, int] = {}
    by_status: dict[str, int] = {"verified": 0, "warning": 0, "conflicted": 0}
    for row in items:
        source_type = str(row.get("source_type") or "unknown")
        by_source[source_type] = by_source.get(source_type, 0) + 1

        country = str(row.get("country") or "GLOBAL")
        by_country[country] = by_country.get(country, 0) + 1

        status = str(row.get("verification_status") or "warning")
        by_status[status] = by_status.get(status, 0) + 1

    return {
        "by_source": by_source,
        "by_country": by_country,
        "by_status": by_status,
    }


def build_readable_briefing_fallback(
    top_items: list[dict[str, Any]],
    highlights: list[str],
    max_topics: int = 8,
) -> str:
    effective = [row for row in top_items if not is_fallback_item(row)]
    if not effective:
        return "신뢰 가능한 수집 데이터가 부족해 상세 브리핑을 생성하지 못했습니다."

    lines: list[str] = []
    lines.append("## 핵심 결론")
    if highlights:
        for line in highlights[:6]:
            lines.append(f"- {line}")
    else:
        for row in effective[:6]:
            title = translate_to_korean(str(row.get("title_ko") or row.get("title") or ""), 180)
            source = translate_to_korean(str(row.get("source_name") or display_source_type(str(row.get("source_type") or ""))), 80)
            lines.append(f"- {title} ({source})")

    lines.append("\n## 토픽별 상세 분석")
    for index, row in enumerate(effective[:max_topics], start=1):
        country = str(row.get("country") or "GLOBAL")
        source = translate_to_korean(str(row.get("source_name") or display_source_type(str(row.get("source_type") or ""))), 80)
        title = translate_to_korean(str(row.get("title_ko") or row.get("title") or ""), 180)
        excerpt = translate_to_korean(
            str(
                row.get("content_excerpt_ko")
                or row.get("summary_ko")
                or row.get("content_excerpt")
                or row.get("summary")
                or ""
            ),
            320,
        )
        status = str(row.get("verification_status") or "warning")
        hot_score = int(row.get("hot_score") or hot_topic_signal_score(row))
        lines.append(f"### {index}. {title}")
        lines.append(f"- 출처: [{country}] {source}")
        lines.append(f"- 신뢰: {status} · 인기지수: {hot_score}")
        if excerpt:
            lines.append(f"- 핵심 내용: {excerpt}")
        url = trim_text(row.get("url") or "", 500)
        if url:
            lines.append(f"- 근거 URL: {url}")

    risk_rows = [row for row in effective if str(row.get("verification_status") or "") in {"warning", "conflicted"}]
    lines.append("\n## 리스크와 불확실성")
    if risk_rows:
        for row in risk_rows[:6]:
            title = translate_to_korean(str(row.get("title_ko") or row.get("title") or ""), 180)
            status = str(row.get("verification_status") or "warning")
            lines.append(f"- {title} ({status})")
    else:
        lines.append("- 상위 항목 기준으로 출처 충돌/신뢰 경고가 두드러지지 않았습니다.")

    lines.append("\n## 지금 바로 볼 체크리스트")
    for row in effective[:6]:
        title = translate_to_korean(str(row.get("title_ko") or row.get("title") or ""), 180)
        url = trim_text(row.get("url") or "", 500)
        if url:
            lines.append(f"- [ ] {title} · {url}")
        else:
            lines.append(f"- [ ] {title}")

    return "\n".join(lines).strip()


def build_markdown(
    flow: dict[str, Any],
    run_id: str,
    started_at: str,
    finished_at: str,
    trigger: str,
    coverage: dict[str, Any],
    crawl_depth: dict[str, int],
    highlights: list[str],
    top_items: list[dict[str, Any]],
    warnings: list[str],
    codex_briefing: str = "",
    codex_usage: dict[str, int] | None = None,
) -> str:
    effective_top_items = [row for row in top_items if not is_fallback_item(row)]
    source_buckets: dict[str, list[dict[str, Any]]] = {}
    for row in effective_top_items:
        source_type = str(row.get("source_type") or "unknown")
        source_buckets.setdefault(source_type, []).append(row)

    lines: list[str] = []
    lines.append(f"# {flow.get('name', 'RAIL VIA Flow')}\n")
    lines.append("## 문서 개요")
    lines.append(f"- 실행 ID: `{run_id}`")
    lines.append(f"- 트리거: `{trigger}`")
    lines.append(f"- 실행 시간: {started_at} ~ {finished_at}")
    lines.append(f"- 분석 대상: {len(effective_top_items)}건")
    lines.append(f"- 경고: {len(warnings)}건")
    usage_line = format_codex_usage_line(codex_usage or {})
    lines.append(f"- Codex 토큰: {usage_line}")
    lines.append("")

    lines.append("## 한눈에 보기")
    if highlights:
        for line in highlights[:8]:
            lines.append(f"- {line}")
    elif effective_top_items:
        for row in effective_top_items[:8]:
            title = trim_text(row.get("title_ko") or row.get("title") or "", 180)
            excerpt = trim_text(row.get("content_excerpt_ko") or row.get("summary_ko") or row.get("content_excerpt") or row.get("summary") or "", 180)
            if excerpt:
                lines.append(f"- {title}: {excerpt}")
            else:
                lines.append(f"- {title}")
    else:
        lines.append("- 신뢰 가능한 수집 결과가 없어 핵심 요약을 생성하지 못했습니다.")

    lines.append("")
    if codex_briefing:
        lines.append("## 본문 분석")
        lines.append(codex_briefing.strip())
    else:
        lines.append(build_readable_briefing_fallback(effective_top_items, highlights))

    lines.append("\n## 채널별 핫토픽")
    source_order = ["source.news", SOURCE_TYPE_SNS, SOURCE_TYPE_COMMUNITY, SOURCE_TYPE_DEV, SOURCE_TYPE_MARKET]
    for source_type in source_order:
        rows = source_buckets.get(source_type) or []
        if not rows:
            continue
        lines.append(f"### {display_source_type(source_type)}")
        hot_sorted = sorted(
            rows,
            key=lambda row: (
                int(row.get("hot_score") or 0),
                int(row.get("score") or 0),
                str(row.get("published_at") or ""),
            ),
            reverse=True,
        )
        for row in hot_sorted[:4]:
            country = str(row.get("country") or "GLOBAL")
            title = trim_text(row.get("title_ko") or row.get("title") or "", 180)
            status = str(row.get("verification_status") or "warning")
            hot_score = int(row.get("hot_score") or hot_topic_signal_score(row))
            excerpt = trim_text(row.get("content_excerpt_ko") or row.get("summary_ko") or row.get("content_excerpt") or row.get("summary") or "", 220)
            lines.append(f"- [{country}] {title} ({status}, 인기지수 {hot_score})")
            if excerpt:
                lines.append(f"  - 요약: {excerpt}")
            close = trim_text(row.get("quote_close") or "", 80)
            if close:
                lines.append(f"  - 가격: {close}")
            url = trim_text(row.get("url") or "", 500)
            if url:
                lines.append(f"  - 근거: {url}")

    lines.append("\n## 참고 출처")
    if effective_top_items:
        for index, row in enumerate(effective_top_items[:30], start=1):
            country = str(row.get("country") or "GLOBAL")
            source = str(row.get("source_name") or display_source_type(str(row.get("source_type") or "")) or "source")
            title = trim_text(row.get("title_ko") or row.get("title") or "", 180)
            url = trim_text(row.get("url") or "", 500)
            if url:
                lines.append(f"{index}. [{country}] {source} · {title} · {url}")
            else:
                lines.append(f"{index}. [{country}] {source} · {title}")
    else:
        lines.append("- 표시 가능한 출처가 없습니다.")

    lines.append("\n## 실행 메타")
    lines.append(f"- run_id: {run_id}")
    lines.append(f"- trigger: {trigger}")
    lines.append(f"- started_at: {started_at}")
    lines.append(f"- finished_at: {finished_at}")

    lines.append("## Source Coverage")
    lines.append("### By Source Type")
    by_source = coverage.get("by_source") or {}
    for source_type, count in sorted(by_source.items()):
        lines.append(f"- {source_type}: {count}")

    lines.append("\n### By Country")
    by_country = coverage.get("by_country") or {}
    for country, count in sorted(by_country.items()):
        lines.append(f"- {country}: {count}")

    lines.append("\n### Verification Status")
    by_status = coverage.get("by_status") or {}
    for status, count in sorted(by_status.items()):
        lines.append(f"- {status}: {count}")

    lines.append("\n### Crawl Depth")
    lines.append(f"- items_total: {int(crawl_depth.get('items_total') or 0)}")
    lines.append(f"- items_with_content: {int(crawl_depth.get('items_with_content') or 0)}")
    lines.append(f"- total_content_chars: {int(crawl_depth.get('total_content_chars') or 0)}")

    if warnings:
        lines.append("\n## Warnings")
        for warning in warnings[:40]:
            lines.append(f"- {warning}")

    return "\n".join(lines).strip() + "\n"


class ViaStore:
    def __init__(self, db_path: Path, docs_root: Path) -> None:
        self.db_path = db_path
        self.docs_root = docs_root
        ensure_parent(db_path)
        docs_root.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._seed_or_upgrade_default_flow()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS flows (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    is_enabled INTEGER NOT NULL DEFAULT 1,
                    schedule TEXT,
                    version INTEGER NOT NULL DEFAULT 1,
                    nodes_json TEXT NOT NULL DEFAULT '[]',
                    edges_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    flow_id INTEGER NOT NULL,
                    trigger TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    detail_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    format TEXT NOT NULL,
                    path TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                """
            )
            conn.commit()

    def _flow_needs_upgrade(self, nodes: list[dict[str, Any]]) -> bool:
        node_types = {str(row.get("type") or "") for row in nodes if isinstance(row, dict)}
        required = {
            "source.news",
            SOURCE_TYPE_SNS,
            SOURCE_TYPE_COMMUNITY,
            SOURCE_TYPE_DEV,
            SOURCE_TYPE_MARKET,
            "transform.normalize",
            "transform.verify",
            "transform.rank",
            "agent.codex",
            "export.rag",
        }
        return not required.issubset(node_types)

    def _seed_or_upgrade_default_flow(self) -> None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, name, version, nodes_json
                FROM flows
                WHERE name = ?
                ORDER BY id ASC
                LIMIT 1
                """,
                ("RAIL Embedded VIA Flow",),
            ).fetchone()

            created_at = now_iso()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO flows
                      (name, description, is_enabled, schedule, version, nodes_json, edges_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "RAIL Embedded VIA Flow",
                        "Built-in standalone VIA flow for global news/sns/community/dev/market ingestion.",
                        1,
                        None,
                        2,
                        to_json(DEFAULT_FLOW_NODES),
                        to_json(DEFAULT_FLOW_EDGES),
                        created_at,
                        created_at,
                    ),
                )
                conn.commit()
                return

            version = int(row["version"] or 1)
            nodes = from_json(row["nodes_json"], [])
            if not isinstance(nodes, list):
                nodes = []
            if version >= 2 and not self._flow_needs_upgrade(nodes):
                return

            conn.execute(
                """
                UPDATE flows
                SET version = ?,
                    nodes_json = ?,
                    edges_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (2, to_json(DEFAULT_FLOW_NODES), to_json(DEFAULT_FLOW_EDGES), now_iso(), int(row["id"])),
            )
            conn.commit()

    def list_flows(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, description, is_enabled, schedule, version, nodes_json, edges_json FROM flows ORDER BY id ASC"
            ).fetchall()

        out: list[dict[str, Any]] = []
        for row in rows:
            nodes = from_json(row["nodes_json"], [])
            edges = from_json(row["edges_json"], [])
            out.append(
                {
                    "id": int(row["id"]),
                    "name": str(row["name"]),
                    "description": str(row["description"] or ""),
                    "is_enabled": bool(row["is_enabled"]),
                    "schedule": row["schedule"],
                    "version": int(row["version"]),
                    "node_count": len(nodes) if isinstance(nodes, list) else 0,
                    "edge_count": len(edges) if isinstance(edges, list) else 0,
                }
            )
        return out

    def get_flow(self, flow_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, name, description, is_enabled, schedule, version, nodes_json, edges_json
                FROM flows
                WHERE id = ?
                """,
                (flow_id,),
            ).fetchone()

        if not row:
            return None

        nodes = from_json(row["nodes_json"], [])
        edges = from_json(row["edges_json"], [])
        return {
            "id": int(row["id"]),
            "name": str(row["name"]),
            "description": str(row["description"] or ""),
            "is_enabled": bool(row["is_enabled"]),
            "schedule": row["schedule"],
            "version": int(row["version"]),
            "nodes": nodes if isinstance(nodes, list) else [],
            "edges": edges if isinstance(edges, list) else [],
        }

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT run_id, flow_id, trigger, status, started_at, finished_at, detail_json
                FROM runs
                WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()

        if not row:
            return None

        detail = from_json(row["detail_json"], {})
        steps = detail.get("steps") if isinstance(detail, dict) else []
        if not isinstance(steps, list):
            steps = []

        return {
            "run_id": str(row["run_id"]),
            "flow_id": int(row["flow_id"]),
            "trigger": str(row["trigger"]),
            "status": str(row["status"]),
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "steps": steps,
            "warnings": detail.get("warnings") if isinstance(detail, dict) else [],
            "detail": detail,
        }

    def list_artifacts(self, run_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT node_id, format, path, sha256, metadata_json, created_at
                FROM artifacts
                WHERE run_id = ?
                ORDER BY id ASC
                """,
                (run_id,),
            ).fetchall()

        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    "node_id": str(row["node_id"]),
                    "format": str(row["format"]),
                    "path": str(row["path"]),
                    "sha256": str(row["sha256"]),
                    "metadata": from_json(row["metadata_json"], {}),
                    "created_at": str(row["created_at"]),
                }
            )
        return out

    def _resolve_flow_nodes(self, flow: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
        warnings: list[str] = []
        raw_nodes = flow.get("nodes")
        if not isinstance(raw_nodes, list):
            warnings.append("flow nodes missing; fallback to default flow graph")
            return [dict(row) for row in DEFAULT_FLOW_NODES], warnings

        node_types = {str(row.get("type") or "") for row in raw_nodes if isinstance(row, dict)}
        has_source = any(node_type.startswith("source.") for node_type in node_types)
        has_export = "export.rag" in node_types
        if not has_source or not has_export:
            warnings.append("flow graph missing source/export nodes; fallback to default flow graph")
            return [dict(row) for row in DEFAULT_FLOW_NODES], warnings

        return [dict(row) for row in raw_nodes if isinstance(row, dict)], warnings

    def _append_step(
        self,
        steps: list[dict[str, Any]],
        node_id: str,
        status: str,
        started_at: str,
        started_ms: int,
        input_summary: str,
        output_summary: str,
        error: str | None,
    ) -> None:
        steps.append(
            {
                "node_id": node_id,
                "status": status,
                "attempt": 1,
                "duration_ms": max(1, utc_now_ms() - started_ms),
                "input_summary": input_summary,
                "output_summary": output_summary,
                "error": error,
                "started_at": started_at,
                "finished_at": now_iso(),
            }
        )

    def _export_artifacts(
        self,
        flow: dict[str, Any],
        run_id: str,
        trigger: str,
        started_at: str,
        finished_at: str,
        all_items: list[dict[str, Any]],
        ranked_items: list[dict[str, Any]],
        highlights: list[str],
        coverage: dict[str, Any],
        crawl_depth: dict[str, int],
        warnings: list[str],
        codex_briefing: str = "",
        codex_usage: dict[str, int] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        flow_slug = slugify(str(flow.get("name") or f"flow-{flow.get('id', 'x')}"))
        run_root = self.docs_root / "rag" / flow_slug / run_id
        run_root.mkdir(parents=True, exist_ok=True)

        markdown = build_markdown(
            flow=flow,
            run_id=run_id,
            started_at=started_at,
            finished_at=finished_at,
            trigger=trigger,
            coverage=coverage,
            crawl_depth=crawl_depth,
            highlights=highlights,
            top_items=ranked_items,
            warnings=warnings,
            codex_briefing=codex_briefing,
            codex_usage=codex_usage or {},
        )

        payload = {
            "flow_id": flow.get("id"),
            "flow_name": flow.get("name"),
            "run_id": run_id,
            "trigger": trigger,
            "generated_at": finished_at,
            "coverage": coverage,
            "crawl_depth": crawl_depth,
            "highlights": highlights,
            "codex_briefing": codex_briefing,
            "codex_usage": codex_usage or {},
            "items": ranked_items,
            "items_all_count": len(all_items),
            "items_all": all_items,
            "warnings": warnings,
        }

        md_path = run_root / "export.md"
        json_path = run_root / "export.json"
        md_path.write_text(markdown, encoding="utf-8")
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        artifacts = [
            {
                "node_id": "export.rag",
                "format": "md",
                "path": str(md_path),
                "sha256": hashlib.sha256(md_path.read_bytes()).hexdigest(),
                "metadata": {},
                "created_at": finished_at,
            },
            {
                "node_id": "export.rag",
                "format": "json",
                "path": str(json_path),
                "sha256": hashlib.sha256(json_path.read_bytes()).hexdigest(),
                "metadata": {},
                "created_at": finished_at,
            },
        ]
        return artifacts, payload

    def run_flow(
        self,
        flow_id: int,
        trigger: str,
        source_type: str | None = None,
        source_options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        flow = self.get_flow(flow_id)
        if flow is None:
            raise ValueError("flow_not_found")

        run_id = secrets.token_hex(12)
        started_at = now_iso()
        warnings: list[str] = []
        steps: list[dict[str, Any]] = []

        flow_nodes, resolve_warnings = self._resolve_flow_nodes(flow)
        warnings.extend(resolve_warnings)
        source_type_filter = str(source_type or "").strip().lower()
        if source_type_filter and not source_type_filter.startswith("source."):
            source_type_filter = ""

        raw_items: list[dict[str, Any]] = []
        normalized_items: list[dict[str, Any]] = []
        verified_items: list[dict[str, Any]] = []
        ranked_items: list[dict[str, Any]] = []
        highlights: list[str] = []
        codex_briefing = ""
        codex_usage: dict[str, int] = {}
        artifacts: list[dict[str, Any]] = []
        crawl_depth_stats: dict[str, int] = {"items_total": 0, "items_with_content": 0, "total_content_chars": 0}
        payload: dict[str, Any] = {}

        for node in flow_nodes:
            node_id = str(node.get("id") or "node")
            node_type = str(node.get("type") or "")
            step_started_at = now_iso()
            step_started_ms = utc_now_ms()

            try:
                if node_type == "trigger.manual":
                    self._append_step(
                        steps=steps,
                        node_id=node_id,
                        status="done",
                        started_at=step_started_at,
                        started_ms=step_started_ms,
                        input_summary="none",
                        output_summary=f"trigger={trigger}",
                        error=None,
                    )
                    continue

                if node_type.startswith("source."):
                    if source_type_filter and node_type.lower() != source_type_filter:
                        self._append_step(
                            steps=steps,
                            node_id=node_id,
                            status="skipped",
                            started_at=step_started_at,
                            started_ms=step_started_ms,
                            input_summary="run_context",
                            output_summary=f"filtered by source_type={source_type_filter}",
                            error=None,
                        )
                        continue
                    source_result = execute_source_node(node_type, source_options or {})
                    raw_items.extend(source_result.items)
                    warnings.extend(source_result.warnings)
                    self._append_step(
                        steps=steps,
                        node_id=node_id,
                        status="done",
                        started_at=step_started_at,
                        started_ms=step_started_ms,
                        input_summary="run_context",
                        output_summary=f"{len(source_result.items)} items via {source_result.adapter}",
                        error=None,
                    )
                    continue

                if node_type == "transform.normalize":
                    normalized_items = normalize_items(raw_items)
                    normalized_items, enrich_warnings, enrich_stats = enrich_items_with_page_content(
                        normalized_items,
                        max_items=content_enrich_max_items(len(normalized_items)),
                    )
                    warnings.extend(enrich_warnings)
                    crawl_depth_stats = build_crawl_depth_stats(normalized_items)
                    self._append_step(
                        steps=steps,
                        node_id=node_id,
                        status="done",
                        started_at=step_started_at,
                        started_ms=step_started_ms,
                        input_summary=f"raw={len(raw_items)}",
                        output_summary=(
                            f"normalized={len(normalized_items)}, "
                            f"content_enriched={int(enrich_stats.get('enriched') or 0)}/"
                            f"{int(enrich_stats.get('attempted') or 0)}"
                        ),
                        error=None,
                    )
                    continue

                if node_type == "transform.verify":
                    source_items = normalized_items if normalized_items else raw_items
                    verified_items = verify_items(source_items)
                    self._append_step(
                        steps=steps,
                        node_id=node_id,
                        status="done",
                        started_at=step_started_at,
                        started_ms=step_started_ms,
                        input_summary=f"items={len(source_items)}",
                        output_summary=f"verified={len(verified_items)}",
                        error=None,
                    )
                    continue

                if node_type == "transform.rank":
                    source_items = verified_items if verified_items else normalize_items(raw_items)
                    ranked_items = rank_items(source_items)
                    self._append_step(
                        steps=steps,
                        node_id=node_id,
                        status="done",
                        started_at=step_started_at,
                        started_ms=step_started_ms,
                        input_summary=f"verified={len(source_items)}",
                        output_summary=f"ranked={len(ranked_items)}",
                        error=None,
                    )
                    continue

                if node_type == "agent.codex":
                    source_items = ranked_items if ranked_items else rank_items(verify_items(normalize_items(raw_items)))
                    source_items = localize_ranked_items_for_ko(source_items)
                    ranked_items = source_items
                    topic = trim_text((node.get("config") or {}).get("topic") or "", 120) if isinstance(node.get("config"), dict) else ""
                    run_root = self.docs_root / "rag" / slugify(str(flow.get("name") or f"flow-{flow.get('id', 'x')}")) / run_id
                    run_root.mkdir(parents=True, exist_ok=True)
                    codex_briefing, codex_highlights, codex_warnings, codex_usage = run_codex_cli_briefing(
                        source_items,
                        topic,
                        run_root,
                    )
                    warnings.extend(codex_warnings)
                    highlights = codex_highlights or summarize_ranked_items(source_items)
                    self._append_step(
                        steps=steps,
                        node_id=node_id,
                        status="done",
                        started_at=step_started_at,
                        started_ms=step_started_ms,
                        input_summary=f"ranked={len(source_items)}",
                        output_summary=(
                            f"highlights={len(highlights)}, "
                            f"briefing={'yes' if codex_briefing else 'no'}, "
                            f"{format_codex_usage_line(codex_usage)}"
                        ),
                        error=None,
                    )
                    continue

                if node_type == "export.rag":
                    verified_source = verified_items if verified_items else verify_items(normalize_items(raw_items))
                    ranked_source = ranked_items if ranked_items else rank_items(verified_source)
                    ranked_source = localize_ranked_items_for_ko(ranked_source)
                    coverage = build_source_coverage(verified_source)
                    crawl_depth = build_crawl_depth_stats(verified_source)
                    finished_at = now_iso()
                    artifacts, payload = self._export_artifacts(
                        flow=flow,
                        run_id=run_id,
                        trigger=trigger,
                        started_at=started_at,
                        finished_at=finished_at,
                        all_items=verified_source,
                        ranked_items=ranked_source,
                        highlights=highlights or summarize_ranked_items(ranked_source),
                        coverage=coverage,
                        crawl_depth=crawl_depth,
                        warnings=warnings,
                        codex_briefing=codex_briefing,
                        codex_usage=codex_usage,
                    )
                    crawl_depth_stats = crawl_depth
                    self._append_step(
                        steps=steps,
                        node_id=node_id,
                        status="done",
                        started_at=step_started_at,
                        started_ms=step_started_ms,
                        input_summary=f"ranked={len(ranked_source)}",
                        output_summary=f"artifacts={len(artifacts)}",
                        error=None,
                    )
                    continue

                warnings.append(f"unsupported node type skipped: {node_type}")
                self._append_step(
                    steps=steps,
                    node_id=node_id,
                    status="warning",
                    started_at=step_started_at,
                    started_ms=step_started_ms,
                    input_summary="unknown",
                    output_summary="skipped",
                    error=f"unsupported node type: {node_type}",
                )
            except Exception as exc:
                warnings.append(f"{node_type}: {trim_text(exc, 220)}")
                self._append_step(
                    steps=steps,
                    node_id=node_id,
                    status="warning",
                    started_at=step_started_at,
                    started_ms=step_started_ms,
                    input_summary="runtime",
                    output_summary="error",
                    error=trim_text(exc, 220),
                )

        if not artifacts:
            verified_source = verified_items if verified_items else verify_items(normalize_items(raw_items))
            ranked_source = ranked_items if ranked_items else rank_items(verified_source)
            ranked_source = localize_ranked_items_for_ko(ranked_source)
            coverage = build_source_coverage(verified_source)
            crawl_depth = build_crawl_depth_stats(verified_source)
            finished_at = now_iso()
            artifacts, payload = self._export_artifacts(
                flow=flow,
                run_id=run_id,
                trigger=trigger,
                started_at=started_at,
                finished_at=finished_at,
                all_items=verified_source,
                ranked_items=ranked_source,
                highlights=highlights or summarize_ranked_items(ranked_source),
                coverage=coverage,
                crawl_depth=crawl_depth,
                warnings=warnings,
                codex_briefing=codex_briefing,
                codex_usage=codex_usage,
            )
            crawl_depth_stats = crawl_depth
            self._append_step(
                steps=steps,
                node_id="export.rag",
                status="done",
                started_at=finished_at,
                started_ms=utc_now_ms(),
                input_summary=f"ranked={len(ranked_source)}",
                output_summary=f"artifacts={len(artifacts)} (implicit)",
                error=None,
            )

        finished_at = now_iso()
        deduped_warnings = [warning for warning in dict.fromkeys(trim_text(row, 240) for row in warnings) if warning]
        detail = {
            "run_id": run_id,
            "flow_id": flow_id,
            "trigger": trigger,
            "source_type_filter": source_type_filter or None,
            "source_options": source_options or {},
            "status": "done",
            "started_at": started_at,
            "finished_at": finished_at,
            "steps": steps,
            "warnings": deduped_warnings,
            "payload": payload,
            "crawl_depth": crawl_depth_stats,
            "codex_briefing": codex_briefing,
            "codex_usage": codex_usage,
        }

        with self._connect() as conn:
            created_at = now_iso()
            conn.execute(
                """
                INSERT INTO runs
                  (run_id, flow_id, trigger, status, started_at, finished_at, detail_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    flow_id,
                    trigger,
                    "done",
                    started_at,
                    finished_at,
                    to_json(detail),
                    created_at,
                    created_at,
                ),
            )
            for row in artifacts:
                conn.execute(
                    """
                    INSERT INTO artifacts
                      (run_id, node_id, format, path, sha256, metadata_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        row["node_id"],
                        row["format"],
                        row["path"],
                        row["sha256"],
                        to_json(row["metadata"]),
                        row["created_at"],
                    ),
                )
            conn.commit()

        return {
            "run_id": run_id,
            "flow_id": flow_id,
            "status": "done",
            "warnings": deduped_warnings,
            "detail": detail,
            "artifacts": artifacts,
        }


@dataclass
class AppContext:
    store: ViaStore


class Handler(BaseHTTPRequestHandler):
    context: AppContext

    def _json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("content-length") or "0")
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(
                200,
                {
                    "status": "ok",
                    "app": APP_NAME,
                    "env": APP_ENV,
                    "demo_mode": False,
                    "timezone": TIMEZONE,
                    "version": APP_VERSION,
                },
            )
            return

        if self.path == "/api/flows":
            self._json(200, {"flows": self.context.store.list_flows()})
            return

        if self.path.startswith("/api/flows/"):
            parts = self.path.split("/")
            if len(parts) == 4:
                flow_id_raw = parts[3]
                if flow_id_raw.isdigit():
                    flow = self.context.store.get_flow(int(flow_id_raw))
                    if flow is None:
                        self._json(404, {"detail": "flow_not_found"})
                    else:
                        self._json(200, flow)
                    return

        if self.path.startswith("/api/runs/"):
            parts = self.path.split("/")
            if len(parts) == 4:
                run = self.context.store.get_run(parts[3])
                if run is None:
                    self._json(404, {"detail": "run_not_found"})
                else:
                    self._json(200, run)
                return
            if len(parts) == 5 and parts[4] == "artifacts":
                run_id = parts[3]
                artifacts = self.context.store.list_artifacts(run_id)
                if not artifacts and self.context.store.get_run(run_id) is None:
                    self._json(404, {"detail": "run_not_found"})
                    return
                self._json(200, {"run_id": run_id, "artifacts": artifacts})
                return

        self._json(404, {"detail": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/api/flows/") and self.path.endswith("/run"):
            parts = self.path.split("/")
            if len(parts) == 5 and parts[4] == "run" and parts[3].isdigit():
                flow_id = int(parts[3])
                payload = self._read_json_body()
                trigger = str(payload.get("trigger") or "manual")[:20]
                source_type_raw = str(payload.get("source_type") or "").strip().lower()
                source_type = source_type_raw if source_type_raw.startswith("source.") else None
                source_options_raw = payload.get("source_options")
                source_options = source_options_raw if isinstance(source_options_raw, dict) else None
                try:
                    result = self.context.store.run_flow(
                        flow_id=flow_id,
                        trigger=trigger,
                        source_type=source_type,
                        source_options=source_options,
                    )
                except ValueError as exc:
                    detail = str(exc)
                    if detail == "flow_not_found":
                        self._json(404, {"detail": detail})
                        return
                    self._json(400, {"detail": detail})
                    return
                self._json(200, result)
                return

        self._json(404, {"detail": "not_found"})

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return


def resolve_config() -> RuntimeConfig:
    sqlite_path = Path(os.getenv("RAIL_VIA_SQLITE_PATH", ".rail/via/app.db")).expanduser().resolve()
    docs_root = Path(os.getenv("RAIL_VIA_DOCS_ROOT", ".rail/via-docs")).expanduser().resolve()
    return RuntimeConfig(sqlite_path=sqlite_path, docs_root=docs_root)


def validate_local_bind(host: str) -> None:
    parsed = urlparse(f"http://{host}")
    if parsed.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError("host must be localhost or 127.0.0.1")


def main() -> int:
    parser = argparse.ArgumentParser(description="RAIL embedded VIA runtime")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    validate_local_bind(args.host)
    if args.port <= 0 or args.port > 65535:
        raise ValueError("port must be between 1 and 65535")

    config = resolve_config()
    context = AppContext(store=ViaStore(db_path=config.sqlite_path, docs_root=config.docs_root))

    Handler.context = context
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
