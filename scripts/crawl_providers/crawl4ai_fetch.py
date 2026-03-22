#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
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


def summarize_text(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    return truncate(text, 480)


def extract_markdown(result: Any) -> str:
    markdown_v2 = getattr(result, "markdown_v2", None)
    if markdown_v2 is not None:
        for attr in ("raw_markdown", "markdown", "fit_markdown"):
            candidate = clean_text(getattr(markdown_v2, attr, ""))
            if candidate:
                return candidate
    markdown = getattr(result, "markdown", None)
    if isinstance(markdown, str):
        return markdown.strip()
    if markdown is not None:
        for attr in ("raw_markdown", "markdown", "fit_markdown"):
            candidate = clean_text(getattr(markdown, attr, ""))
            if candidate:
                return candidate
    return ""


def extract_content(result: Any, markdown: str) -> str:
    if markdown:
        return markdown
    for attr in ("cleaned_html", "html", "text", "fit_markdown"):
        candidate = clean_text(getattr(result, attr, ""))
        if candidate:
            return candidate
    return ""


def extract_metadata(result: Any) -> dict[str, Any]:
    raw = getattr(result, "metadata", None)
    if isinstance(raw, dict):
        return raw
    return {}


async def run_crawler(url: str) -> dict[str, Any]:
    try:
        from crawl4ai import AsyncWebCrawler  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime import guard
        raise RuntimeError(f"failed to import crawl4ai: {exc}") from exc

    browser_config = None
    crawler_run_config = None
    try:
        from crawl4ai import BrowserConfig, CacheMode, CrawlerRunConfig  # type: ignore

        browser_config = BrowserConfig(headless=True, verbose=False)
        crawler_run_config = CrawlerRunConfig(cache_mode=getattr(CacheMode, "BYPASS", None))
    except Exception:
        browser_config = None
        crawler_run_config = None

    if browser_config is not None:
        try:
            crawler = AsyncWebCrawler(config=browser_config)
        except TypeError:
            crawler = AsyncWebCrawler(browser_config=browser_config)
    else:
        crawler = AsyncWebCrawler()

    async with crawler:
        if crawler_run_config is not None:
            try:
                result = await crawler.arun(url=url, config=crawler_run_config)
            except TypeError:
                result = await crawler.arun(url=url)
        else:
            result = await crawler.arun(url=url)

    if not bool(getattr(result, "success", True)):
        error_message = clean_text(getattr(result, "error_message", "")) or "crawl4ai reported unsuccessful fetch"
        raise RuntimeError(error_message)

    markdown = extract_markdown(result)
    content = extract_content(result, markdown)
    metadata = extract_metadata(result)
    title = clean_text(metadata.get("title")) or clean_text(getattr(result, "title", ""))
    summary_seed = markdown or content or title
    return {
        "url": url,
        "summary": summarize_text(summary_seed),
        "content": truncate(content or markdown or title, 12000),
        "markdown": markdown,
        "metadata": {
            "title": title,
            "provider": "crawl4ai",
            **metadata,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch a URL with Crawl4AI and emit JSON.")
    parser.add_argument("--url", required=True, help="Source URL")
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    payload = await run_crawler(str(args.url))
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
