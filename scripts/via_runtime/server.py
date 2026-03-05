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
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import time
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
DEFAULT_PINCHTAB_BASE_URL = "http://127.0.0.1:9867"
PINCHTAB_DEFAULT_MODE = "headless"
PINCHTAB_STARTUP_DELAY_SECONDS = 1.1
PINCHTAB_TARGET_DELAY_SECONDS = 0.55
PINCHTAB_TAB_READ_DELAY_SECONDS = 0.65

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
    "www.clien.net",
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
                            extra={"pinchtab": True, "pinchtab_stealth": pinchtab_stealth},
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
    item = {
        "id": stable_id(normalized_type, source_name, title, url),
        "source_type": normalized_type,
        "source_name": source_name,
        "country": country,
        "adapter": adapter,
        "title": trim_text(title, 220),
        "url": trim_text(url, 500),
        "summary": trim_text(summary, 420),
        "published_at": published_at or now_iso(),
        "fetched_at": now_iso(),
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
            for row in parsed:
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

        matches = re.findall(
            r"<h2[^>]*class=\"h3[^\"]*\"[^>]*>\s*<a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>",
            html_text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        for path, title_html in matches[:MAX_ITEMS_PER_TARGET]:
            name = trim_text(strip_tags(title_html).replace("/", " / "), 160)
            if not name:
                continue
            repo_url = f"https://github.com{path.strip()}"
            items.append(
                make_item(
                    source_type=SOURCE_TYPE_DEV,
                    source_name="GitHub Trending",
                    country="GLOBAL",
                    adapter=adapter,
                    title=name,
                    url=repo_url,
                    summary="GitHub Trending repository",
                    published_at=None,
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
                    extra={"quote_close": close or None},
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
                        source_name="Naver News",
                        country="KR",
                        adapter=adapter,
                        title=title,
                        url=article_url,
                        summary="네이버 뉴스 기사",
                        published_at=None,
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
                            source_name="Naver News",
                            country="KR",
                            adapter=adapter,
                            title=title,
                            url=article_url,
                            summary="네이버 뉴스 기사",
                            published_at=None,
                        )
                    )

            if matched == 0:
                warnings.append(f"{adapter}: no entries parsed for {target_url}")
        except Exception as exc:
            warnings.append(f"{adapter}: {trim_text(exc, 200)}")

    return AdapterResult(adapter=adapter, items=items[:MAX_TOTAL_ITEMS], warnings=warnings)


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


def sns_pinchtab_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "X Explore Technology", "url": "https://x.com/explore/tabs/for_you?f=top"},
        {"country": "GLOBAL", "name": "Threads AI", "url": "https://www.threads.com/search?q=AI"},
        {"country": "JP", "name": "X JP Search", "url": "https://x.com/search?q=%E3%83%86%E3%82%AF&src=typed_query"},
        {"country": "KR", "name": "X KR Search", "url": "https://x.com/search?q=%EA%B8%B0%EC%88%A0&src=typed_query"},
    ]
    return collect_pinchtab_targets(SOURCE_TYPE_SNS, "sns.pinchtab", targets, snippets_per_target=2)


def community_pinchtab_adapter() -> AdapterResult:
    targets = [
        {"country": "US", "name": "Reddit Technology", "url": "https://www.reddit.com/r/technology/"},
        {"country": "JP", "name": "Hatena IT", "url": "https://b.hatena.ne.jp/hotentry/it"},
        {"country": "CN", "name": "V2EX Hot", "url": "https://www.v2ex.com/?tab=hot"},
        {"country": "KR", "name": "DCInside Stock", "url": "https://gall.dcinside.com/mgallery/board/lists/?id=stock"},
        {"country": "KR", "name": "Clien", "url": "https://www.clien.net/service/board/park"},
    ]
    return collect_pinchtab_targets(SOURCE_TYPE_COMMUNITY, "community.pinchtab", targets, snippets_per_target=2)


def dev_pinchtab_adapter() -> AdapterResult:
    targets = [
        {"country": "GLOBAL", "name": "GitHub Trending", "url": "https://github.com/trending"},
        {"country": "GLOBAL", "name": "DEV Community", "url": "https://dev.to/top/week"},
        {"country": "GLOBAL", "name": "Lobsters", "url": "https://lobste.rs"},
        {"country": "GLOBAL", "name": "StackOverflow Blog", "url": "https://stackoverflow.blog/"},
    ]
    return collect_pinchtab_targets(SOURCE_TYPE_DEV, "dev.pinchtab", targets, snippets_per_target=2)


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
        {"country": "KR", "name": "Clien", "url": "https://www.clien.net/service/board/park/rss"},
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
    "source.news": [news_pinchtab_adapter, news_primary_adapter, news_fallback_adapter],
    SOURCE_TYPE_SNS: [sns_pinchtab_adapter, sns_primary_adapter, sns_fallback_adapter],
    SOURCE_TYPE_COMMUNITY: [community_pinchtab_adapter, community_primary_adapter, community_fallback_adapter],
    SOURCE_TYPE_DEV: [dev_pinchtab_adapter, dev_primary_adapter, dev_fallback_adapter],
    SOURCE_TYPE_MARKET: [market_pinchtab_adapter, market_primary_adapter, market_fallback_adapter],
    "source.x": [sns_pinchtab_adapter, sns_primary_adapter, sns_fallback_adapter],
    "source.threads": [sns_pinchtab_adapter, sns_primary_adapter, sns_fallback_adapter],
    "source.reddit": [community_pinchtab_adapter, community_primary_adapter, community_fallback_adapter],
    "source.hn": [dev_pinchtab_adapter, dev_primary_adapter, dev_fallback_adapter],
}


def execute_source_node(source_type: str) -> AdapterResult:
    chain = SOURCE_ADAPTER_CHAIN.get(source_type) or []
    warnings: list[str] = []
    for adapter in chain:
        result = adapter()
        warnings.extend(result.warnings)
        if result.items:
            return AdapterResult(adapter=result.adapter, items=result.items, warnings=warnings)

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
        score = base + freshness + verification_bonus + min(source_count, 5)

        next_row = dict(row)
        next_row["score"] = int(score)
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
        title = trim_text(row.get("title") or "", 180)
        excerpt = trim_text(row.get("content_excerpt") or row.get("summary") or "", 140)
        if excerpt:
            lines.append(f"[{country}] ({status}) {source}: {title} - {excerpt}")
        else:
            lines.append(f"[{country}] ({status}) {source}: {title}")
        if len(lines) >= max_lines:
            break
    return lines


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
) -> str:
    effective_top_items = [row for row in top_items if not is_fallback_item(row)]
    source_buckets: dict[str, list[dict[str, Any]]] = {}
    for row in effective_top_items:
        source_type = str(row.get("source_type") or "unknown")
        source_buckets.setdefault(source_type, []).append(row)

    lines: list[str] = []
    lines.append(f"# {flow.get('name', 'RAIL VIA Flow')}\n")
    lines.append("## 실행 요약")
    lines.append(f"- 실행 ID: `{run_id}`")
    lines.append(f"- 트리거: `{trigger}`")
    lines.append(f"- 실행 시간: {started_at} ~ {finished_at}")
    lines.append(f"- 상위 분석 대상: {len(effective_top_items)}건")
    lines.append(f"- 경고: {len(warnings)}건")
    lines.append("")

    lines.append("## 핵심 브리핑")
    if highlights:
        for line in highlights[:10]:
            lines.append(f"- {line}")
    elif effective_top_items:
        for row in effective_top_items[:10]:
            title = trim_text(row.get("title") or "", 180)
            excerpt = trim_text(row.get("content_excerpt") or row.get("summary") or "", 180)
            if excerpt:
                lines.append(f"- {title}: {excerpt}")
            else:
                lines.append(f"- {title}")
    else:
        lines.append("- 신뢰 가능한 수집 결과가 없어 브리핑을 생성하지 못했습니다.")

    lines.append("\n## 소스별 인사이트")
    source_order = ["source.news", SOURCE_TYPE_SNS, SOURCE_TYPE_COMMUNITY, SOURCE_TYPE_DEV, SOURCE_TYPE_MARKET]
    for source_type in source_order:
        rows = source_buckets.get(source_type) or []
        if not rows:
            continue
        lines.append(f"### {display_source_type(source_type)}")
        for row in rows[:4]:
            country = str(row.get("country") or "GLOBAL")
            title = trim_text(row.get("title") or "", 180)
            status = str(row.get("verification_status") or "warning")
            excerpt = trim_text(row.get("content_excerpt") or row.get("summary") or "", 220)
            lines.append(f"- [{country}] {title} ({status})")
            if excerpt:
                lines.append(f"  - 요약: {excerpt}")
            close = trim_text(row.get("quote_close") or "", 80)
            if close:
                lines.append(f"  - 가격: {close}")
            url = trim_text(row.get("url") or "", 500)
            if url:
                lines.append(f"  - 출처: {url}")

    lines.append("\n## 원문 근거 발췌")
    if effective_top_items:
        for index, row in enumerate(effective_top_items[:20], start=1):
            country = str(row.get("country") or "GLOBAL")
            source = str(row.get("source_name") or display_source_type(str(row.get("source_type") or "")) or "source")
            status = str(row.get("verification_status") or "warning")
            title = trim_text(row.get("title") or "", 180)
            excerpt = trim_text(row.get("content_excerpt") or row.get("summary") or "", 320)
            lines.append(f"{index}. [{country}] {source} · {title} ({status})")
            if excerpt:
                lines.append(f"   - 발췌: {excerpt}")
            url = trim_text(row.get("url") or "", 500)
            if url:
                lines.append(f"   - URL: {url}")
    else:
        lines.append("- 표시 가능한 수집 데이터가 없습니다.")

    lines.append("\n## 실행 메타")
    lines.append(f"- run_id: {run_id}")
    lines.append(f"- trigger: {trigger}")
    lines.append(f"- started_at: {started_at}")
    lines.append(f"- finished_at: {finished_at}\n")

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

    def run_flow(self, flow_id: int, trigger: str, source_type: str | None = None) -> dict[str, Any]:
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
                    source_result = execute_source_node(node_type)
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
                    highlights = summarize_ranked_items(source_items)
                    self._append_step(
                        steps=steps,
                        node_id=node_id,
                        status="done",
                        started_at=step_started_at,
                        started_ms=step_started_ms,
                        input_summary=f"ranked={len(source_items)}",
                        output_summary=f"highlights={len(highlights)}",
                        error=None,
                    )
                    continue

                if node_type == "export.rag":
                    verified_source = verified_items if verified_items else verify_items(normalize_items(raw_items))
                    ranked_source = ranked_items if ranked_items else rank_items(verified_source)
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
            "status": "done",
            "started_at": started_at,
            "finished_at": finished_at,
            "steps": steps,
            "warnings": deduped_warnings,
            "payload": payload,
            "crawl_depth": crawl_depth_stats,
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
                try:
                    result = self.context.store.run_flow(flow_id=flow_id, trigger=trigger, source_type=source_type)
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
