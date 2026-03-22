#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def truncate(value: Any, limit: int) -> str:
    text = clean_text(value)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def build_snippets(text: str, limit: int = 3) -> list[str]:
    normalized = clean_text(text)
    if not normalized:
        return []
    parts = re.split(r"(?<=[.!?])\s+|\s{2,}", normalized)
    snippets: list[str] = []
    seen: set[str] = set()
    for part in parts:
        candidate = truncate(part, 240)
        if len(candidate) < 36:
            continue
        lowered = candidate.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        snippets.append(candidate)
        if len(snippets) >= max(1, limit):
            break
    if snippets:
        return snippets
    fallback = truncate(normalized, 240)
    return [fallback] if fallback else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch multiple URLs with scrapy-playwright and emit JSON.")
    parser.add_argument("--targets-json", required=True, help="JSON array of {url,name,country}")
    return parser.parse_args()


def load_targets(raw: str) -> list[dict[str, str]]:
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise RuntimeError("targets-json must be an array")
    targets: list[dict[str, str]] = []
    for row in parsed[:24]:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if not url.startswith("http://") and not url.startswith("https://"):
            continue
        targets.append(
            {
                "url": url,
                "name": clean_text(row.get("name") or ""),
                "country": clean_text(row.get("country") or "") or "GLOBAL",
            }
        )
    return targets


def run_batch(targets: list[dict[str, str]]) -> dict[str, Any]:
    try:
        import scrapy  # type: ignore
        from scrapy.crawler import CrawlerProcess  # type: ignore
        from scrapy_playwright.page import PageMethod  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime import guard
        raise RuntimeError(f"failed to import scrapy-playwright runtime: {exc}") from exc

    results: list[dict[str, Any]] = []
    warnings: list[str] = []

    class RailScrapyPlaywrightSpider(scrapy.Spider):  # type: ignore[misc]
        name = "rail_scrapy_playwright_batch"
        custom_settings = {
            "LOG_ENABLED": False,
            "ROBOTSTXT_OBEY": False,
            "COOKIES_ENABLED": True,
            "TELNETCONSOLE_ENABLED": False,
            "DOWNLOAD_HANDLERS": {
                "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
                "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
            },
            "TWISTED_REACTOR": "twisted.internet.asyncioreactor.AsyncioSelectorReactor",
            "PLAYWRIGHT_BROWSER_TYPE": "chromium",
            "PLAYWRIGHT_LAUNCH_OPTIONS": {"headless": True},
            "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": 25_000,
        }

        def start_requests(self):  # type: ignore[override]
            for target in targets:
                yield scrapy.Request(
                    url=target["url"],
                    callback=self.parse_page,
                    errback=self.handle_error,
                    dont_filter=True,
                    cb_kwargs={"target": target},
                    meta={
                        "playwright": True,
                        "playwright_include_page": False,
                        "playwright_page_methods": [
                            PageMethod("wait_for_load_state", "domcontentloaded"),
                            PageMethod("wait_for_timeout", 700),
                        ],
                    },
                )

        def parse_page(self, response, target: dict[str, str]):  # type: ignore[override]
            title = clean_text(response.css("title::text").get() or "")
            text_nodes = [clean_text(row) for row in response.css("body ::text").getall()]
            text_nodes = [row for row in text_nodes if row]
            content = truncate(" ".join(text_nodes), 12000)
            snippets = build_snippets(content, limit=3)
            results.append(
                {
                    "url": target["url"],
                    "sourceName": target["name"] or clean_text(response.url.split("/")[2]),
                    "country": target["country"] or "GLOBAL",
                    "title": truncate(title or (snippets[0] if snippets else target["url"]), 160),
                    "summary": snippets[0] if snippets else truncate(content, 240),
                    "content": content,
                    "snippets": snippets,
                }
            )

        def handle_error(self, failure):  # type: ignore[override]
            request = getattr(failure, "request", None)
            target_url = clean_text(getattr(request, "url", "")) or "unknown-url"
            warnings.append(f"{target_url}: {truncate(failure.getErrorMessage(), 180)}")

    process = CrawlerProcess(settings=RailScrapyPlaywrightSpider.custom_settings)
    process.crawl(RailScrapyPlaywrightSpider)
    process.start(stop_after_crawl=True)
    return {"items": results, "warnings": warnings[:24]}


def main() -> int:
    args = parse_args()
    targets = load_targets(args.targets_json)
    payload = run_batch(targets)
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
