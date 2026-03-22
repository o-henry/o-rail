#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
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


async def run_browser_use(url: str) -> dict[str, Any]:
    if not os.getenv("BROWSER_USE_API_KEY"):
        raise RuntimeError("BROWSER_USE_API_KEY is not configured")
    try:
        from browser_use_sdk import AsyncBrowserUse  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime import guard
        raise RuntimeError(f"failed to import browser_use_sdk: {exc}") from exc

    client = AsyncBrowserUse()
    task = (
        "Open the provided page and extract the most important information. "
        "Return a compact plain-text summary first, then the most relevant content. "
        f"Target URL: {url}"
    )
    result = await client.run(task)
    output = clean_text(getattr(result, "output", "") or getattr(result, "text", ""))
    if not output:
        output = clean_text(result)
    if not output:
        raise RuntimeError("browser_use returned an empty result")
    return {
        "url": url,
        "summary": summarize_text(output),
        "content": truncate(output, 12_000),
        "markdown": output,
        "metadata": {
            "provider": "browser_use",
            "mode": "browser_use_sdk",
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch a URL with Browser Use and emit JSON.")
    parser.add_argument("--url", required=True, help="Source URL")
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    payload = await run_browser_use(str(args.url))
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
