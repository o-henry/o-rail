#!/usr/bin/env python3
"""RAIL Scrapling bridge server.

Local-only HTTP bridge used by dashboard crawler.
Endpoints:
  - GET  /health
  - POST /fetch  { "url": "...", "timeoutMs": 15000, "maxChars": 12000 }
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from dataclasses import dataclass
from html import unescape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib.parse import urlparse


MAX_ERROR_CHARS = 320
DEFAULT_TIMEOUT_MS = 15_000
DEFAULT_MAX_CHARS = 12_000


def scrapling_available() -> bool:
    try:
        from scrapling.fetchers import Fetcher  # type: ignore # noqa: F401
        return True
    except Exception:
        return False


def sanitize_public_error(value: Any, fallback: str = "요청 처리 실패") -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    if not text:
        return fallback
    text = re.sub(r"\s+", " ", text)
    return text[:MAX_ERROR_CHARS]


def strip_tags(raw: str) -> str:
    no_script = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", raw)
    no_style = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", no_script)
    no_tags = re.sub(r"(?is)<[^>]+>", " ", no_style)
    plain = unescape(no_tags)
    return re.sub(r"\s+", " ", plain).strip()


def truncate_chars(raw: str, max_chars: int) -> str:
    if len(raw) <= max_chars:
        return raw
    return raw[:max_chars]


def summarize_text(raw: str, max_chars: int = 1200) -> str:
    text = strip_tags(raw)
    return truncate_chars(text, max_chars)


def extract_scrapling_text(url: str, timeout_ms: int, max_chars: int) -> Dict[str, Any]:
    try:
        from scrapling.fetchers import Fetcher  # type: ignore
    except Exception:
        return {
            "ok": False,
            "errorCode": "SCRAPLING_NOT_INSTALLED",
            "error": "scrapling 패키지가 설치되어 있지 않습니다.",
        }

    try:
        fetcher = Fetcher()
        response = fetcher.get(url, timeout=max(1, int(timeout_ms / 1000)))
    except Exception as error:
        return {
            "ok": False,
            "errorCode": "SCRAPLING_FETCH_FAILED",
            "error": sanitize_public_error(error),
        }

    status = getattr(response, "status", None) or getattr(response, "status_code", None) or 200
    status = int(status) if isinstance(status, (int, str)) and str(status).isdigit() else 200
    headers = getattr(response, "headers", None)
    content_type = "text/plain"
    if isinstance(headers, dict):
        content_type = str(headers.get("content-type") or headers.get("Content-Type") or content_type)

    raw_text = ""
    for key in ("get_all_text", "text", "raw_text", "markdown", "html"):
        value = getattr(response, key, None)
        if callable(value):
            try:
                value = value()
            except Exception:
                value = ""
        if isinstance(value, str) and value.strip():
            raw_text = value
            break

    if not raw_text:
        return {
            "ok": False,
            "errorCode": "SCRAPLING_EMPTY",
            "httpStatus": status,
            "error": "scrapling 응답에서 텍스트를 추출하지 못했습니다.",
        }

    content = truncate_chars(strip_tags(raw_text), max(500, max_chars))
    summary = truncate_chars(content, 1200)
    title = ""
    for key in ("title",):
        value = getattr(response, key, None)
        if isinstance(value, str) and value.strip():
            title = truncate_chars(value.strip(), 240)
            break
    if not title:
        title = truncate_chars(url, 240)

    return {
        "ok": True,
        "url": url,
        "httpStatus": status,
        "contentType": content_type,
        "fetchedAt": int(time.time() * 1000),
        "format": "scrapling",
        "title": title,
        "summary": summary,
        "content": content,
        "bytes": len(content.encode("utf-8")),
    }


@dataclass
class BridgeConfig:
    token: str


class Handler(BaseHTTPRequestHandler):
    config: BridgeConfig

    def _read_json_body(self) -> Dict[str, Any]:
        try:
            length = int(self.headers.get("content-length") or "0")
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        if isinstance(value, dict):
            return value
        return {}

    def _json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _is_authorized(self) -> bool:
        token = self.config.token.strip()
        if not token:
            return True
        auth = self.headers.get("authorization", "")
        expected = f"Bearer {token}"
        return auth == expected

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._json(404, {"ok": False, "errorCode": "NOT_FOUND", "error": "not found"})
            return
        if not self._is_authorized():
            self._json(401, {"ok": False, "errorCode": "UNAUTHORIZED", "error": "unauthorized"})
            return
        ready = scrapling_available()
        self._json(
            200,
            {
                "ok": True,
                "service": "scrapling-bridge",
                "scraplingReady": ready,
                "ts": int(time.time() * 1000),
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/fetch":
            self._json(404, {"ok": False, "errorCode": "NOT_FOUND", "error": "not found"})
            return
        if not self._is_authorized():
            self._json(401, {"ok": False, "errorCode": "UNAUTHORIZED", "error": "unauthorized"})
            return
        payload = self._read_json_body()
        url = str(payload.get("url") or "").strip()
        if not url:
            self._json(400, {"ok": False, "errorCode": "INVALID_URL", "error": "url is required"})
            return
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            self._json(400, {"ok": False, "errorCode": "INVALID_URL", "error": "only http/https is supported"})
            return
        timeout_ms = int(payload.get("timeoutMs") or DEFAULT_TIMEOUT_MS)
        max_chars = int(payload.get("maxChars") or DEFAULT_MAX_CHARS)
        result = extract_scrapling_text(url, timeout_ms, max_chars)
        if not result.get("ok"):
            code = str(result.get("errorCode") or "SCRAPLING_FAILED")
            status = 502 if code not in ("INVALID_URL", "UNAUTHORIZED") else 400
            if code == "SCRAPLING_NOT_INSTALLED":
                status = 503
            self._json(
                status,
                {
                    "ok": False,
                    "errorCode": code,
                    "error": sanitize_public_error(result.get("error"), "scrapling fetch failed"),
                    "httpStatus": result.get("httpStatus"),
                },
            )
            return
        self._json(200, result)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return


def main() -> int:
    parser = argparse.ArgumentParser(description="RAIL scrapling bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default="9871", type=int)
    args = parser.parse_args()
    token = os.getenv("RAIL_SCRAPLING_BRIDGE_TOKEN", "")
    Handler.config = BridgeConfig(token=token)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
