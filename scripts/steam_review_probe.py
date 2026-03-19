#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import statistics
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_GAMES: list[tuple[int, str]] = [
    (2379780, "Balatro"),
    (413150, "Stardew Valley"),
    (646570, "Slay the Spire"),
    (1794680, "Vampire Survivors"),
    (1942280, "Brotato"),
    (960090, "Bloons TD 6"),
]

POSITIVE_HINTS = (
    "addict",
    "satisf",
    "simple",
    "easy to learn",
    "hard to master",
    "one more run",
    "replay",
    "polish",
    "fun",
    "relax",
    "cozy",
    "strateg",
    "build",
)

NEGATIVE_HINTS = (
    "repet",
    "grind",
    "rng",
    "random",
    "slow",
    "late game",
    "balance",
    "content",
    "price",
    "tutorial",
    "ui",
    "interface",
    "frustrat",
)


@dataclass
class ReviewRow:
    text: str
    voted_up: bool
    weighted_vote_score: float
    votes_up: int
    playtime_hours: float
    language: str
    created_at: int


@dataclass
class GameReport:
    appid: int
    name: str
    total_reviews: int
    total_positive: int
    total_negative: int
    review_score_desc: str
    sampled_reviews: list[ReviewRow]
    fetched_pages: int
    fetched_reviews: int
    positive_quotes: list[str]
    negative_quotes: list[str]
    positive_topics: list[str]
    negative_topics: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch a cautious sample of Steam reviews and save a markdown brief.")
    parser.add_argument("--output", required=True, help="Markdown output path")
    parser.add_argument("--max-pages", type=int, default=3, help="Max review pages to fetch per game")
    parser.add_argument("--page-size", type=int, default=50, help="Reviews per page (keep modest for safer crawling)")
    parser.add_argument("--day-range", type=int, default=365, help="Steam review day_range parameter")
    parser.add_argument("--delay-sec", type=float, default=1.8, help="Base delay between requests")
    parser.add_argument("--max-retries", type=int, default=4, help="Retries per request with exponential backoff")
    parser.add_argument("--cache-dir", default=".rail/cache/steam-review-probe", help="Raw response cache directory")
    return parser.parse_args()


def stable_slug(raw: str) -> str:
    value = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(raw or ""))
    value = "-".join(part for part in value.split("-") if part)
    return value or "item"


def build_request_params(*, cursor: str, day_range: int, page_size: int) -> dict[str, Any]:
    return {
        "json": 1,
        "language": "all",
        "day_range": max(1, day_range),
        "filter": "updated",
        "review_type": "all",
        "purchase_type": "all",
        "num_per_page": max(1, min(100, page_size)),
        "cursor": cursor,
        "filter_offtopic_activity": 0,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def http_json(url: str, params: dict[str, Any], *, max_retries: int, base_delay_sec: float, cache_file: Path | None = None) -> dict[str, Any]:
    full_url = f"{url}?{urlencode(params)}"
    attempts = max(1, max_retries)
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        request = Request(
            full_url,
            headers={
                "User-Agent": "RAIL-Steam-Review-Probe/1.0 (+local research; contact: local-user)",
                "Accept": "application/json,text/plain,*/*",
                "Referer": "https://store.steampowered.com/",
            },
        )
        try:
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
                if cache_file is not None:
                    write_json(
                        cache_file,
                        {
                            "fetchedAt": datetime.now(timezone.utc).isoformat(),
                            "url": full_url,
                            "payload": payload,
                        },
                    )
                return payload
        except HTTPError as error:
            last_error = error
            if error.code in {400, 401, 403, 404}:
                raise
        except URLError as error:
            last_error = error
        except Exception as error:
            last_error = error
        if attempt >= attempts:
            break
        backoff = base_delay_sec * (2 ** (attempt - 1)) + random.uniform(0.4, 1.1)
        time.sleep(backoff)
    if last_error is None:
        raise RuntimeError(f"Steam request failed without error: {full_url}")
    raise last_error


def clean_text(raw: str) -> str:
    text = " ".join(str(raw or "").split())
    return text.strip()


def clip(raw: str, limit: int) -> str:
    text = clean_text(raw)
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3].rstrip()}..."


def score_value(raw: Any) -> float:
    try:
        return float(raw)
    except Exception:
        return 0.0


def summarize_topics(reviews: list[ReviewRow], voted_up: bool, hints: tuple[str, ...]) -> list[str]:
    counts: dict[str, int] = {hint: 0 for hint in hints}
    for row in reviews:
        if row.voted_up != voted_up:
            continue
        lowered = row.text.lower()
        for hint in hints:
            if hint in lowered:
                counts[hint] += 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [name for name, count in ranked if count > 0][:6]


def pick_quotes(reviews: list[ReviewRow], voted_up: bool, limit: int) -> list[str]:
    filtered = [row for row in reviews if row.voted_up == voted_up and len(row.text) >= 40]
    ranked = sorted(
        filtered,
        key=lambda row: (
            -(row.weighted_vote_score or 0.0),
            -(row.votes_up or 0),
            -(row.playtime_hours or 0.0),
            -row.created_at,
        ),
    )
    unique: list[str] = []
    seen: set[str] = set()
    for row in ranked:
        quote = clip(row.text, 220)
        if not quote:
            continue
        key = quote.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(quote)
        if len(unique) >= limit:
            break
    return unique


def fetch_game_reviews(
    appid: int,
    name: str,
    *,
    max_pages: int,
    page_size: int,
    day_range: int,
    delay_sec: float,
    max_retries: int,
    cache_dir: Path,
) -> GameReport:
    cursor = "*"
    sampled_reviews: list[ReviewRow] = []
    summary: dict[str, Any] = {}
    fetched_pages = 0

    for page_index in range(max(1, max_pages)):
        params = build_request_params(cursor=cursor, day_range=day_range, page_size=page_size)
        cache_file = cache_dir / stable_slug(name) / f"page-{page_index + 1}.json"
        payload = http_json(
            f"https://store.steampowered.com/appreviews/{appid}",
            params,
            max_retries=max_retries,
            base_delay_sec=delay_sec,
            cache_file=cache_file,
        )
        if int(payload.get("success") or 0) != 1:
            raise RuntimeError(f"Steam returned success={payload.get('success')} for {appid}")

        if not summary:
            summary = payload.get("query_summary") or {}

        reviews = payload.get("reviews") or []
        if not isinstance(reviews, list) or not reviews:
            break

        for review in reviews:
            body = clean_text(review.get("review") or "")
            if not body:
                continue
            author = review.get("author") or {}
            sampled_reviews.append(
                ReviewRow(
                    text=body,
                    voted_up=bool(review.get("voted_up")),
                    weighted_vote_score=score_value(review.get("weighted_vote_score")),
                    votes_up=int(review.get("votes_up") or 0),
                    playtime_hours=round(float(author.get("playtime_forever") or 0) / 60.0, 1),
                    language=str(review.get("language") or ""),
                    created_at=int(review.get("timestamp_created") or 0),
                )
            )

        fetched_pages += 1
        next_cursor = str(payload.get("cursor") or "").strip()
        if not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor
        time.sleep(delay_sec + random.uniform(0.25, 0.85))

    sampled_reviews = sampled_reviews[: max_pages * page_size]
    return GameReport(
        appid=appid,
        name=name,
        total_reviews=int(summary.get("total_reviews") or 0),
        total_positive=int(summary.get("total_positive") or 0),
        total_negative=int(summary.get("total_negative") or 0),
        review_score_desc=str(summary.get("review_score_desc") or ""),
        fetched_pages=fetched_pages,
        fetched_reviews=len(sampled_reviews),
        sampled_reviews=sampled_reviews,
        positive_quotes=pick_quotes(sampled_reviews, True, limit=4),
        negative_quotes=pick_quotes(sampled_reviews, False, limit=4),
        positive_topics=summarize_topics(sampled_reviews, True, POSITIVE_HINTS),
        negative_topics=summarize_topics(sampled_reviews, False, NEGATIVE_HINTS),
    )


def render_markdown(reports: list[GameReport], args: argparse.Namespace) -> str:
    lines: list[str] = []
    lines.append("# Steam Review Research")
    lines.append("")
    lines.append(f"- Generated at: {time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    lines.append("- Method: Steam store `appreviews` endpoint with low-rate cursor pagination")
    lines.append(f"- Request pacing: base delay {args.delay_sec:.1f}s + jitter per page")
    lines.append(f"- Per-game cap: {args.max_pages} pages x {args.page_size} reviews")
    lines.append(f"- Day range: {args.day_range} days")
    lines.append("- Goal: idea validation for solo/indie-friendly genres using real player review language")
    lines.append("")

    all_reviews = [row for report in reports for row in report.sampled_reviews]
    total_sampled = sum(report.fetched_reviews for report in reports)
    total_reviews = sum(report.total_reviews for report in reports)
    lines.append("## Portfolio Snapshot")
    lines.append("")
    lines.append(f"- Games covered: {len(reports)}")
    lines.append(f"- Sampled reviews fetched: {total_sampled}")
    lines.append(f"- Reported total reviews across covered games: {total_reviews}")
    if all_reviews:
        playtimes = [row.playtime_hours for row in all_reviews if row.playtime_hours > 0]
        if playtimes:
            lines.append(f"- Median sampled playtime: {statistics.median(playtimes):.1f}h")
    lines.append("")

    for report in reports:
        lines.append(f"## {report.name} (`appid={report.appid}`)")
        lines.append("")
        lines.append(f"- Steam summary: {report.review_score_desc or 'n/a'}")
        lines.append(f"- Total reviews: {report.total_reviews}")
        lines.append(f"- Positive / Negative: {report.total_positive} / {report.total_negative}")
        lines.append(f"- Sampled this run: {report.fetched_reviews} reviews across {report.fetched_pages} pages")
        if report.positive_topics:
            lines.append(f"- Positive topic hints: {', '.join(report.positive_topics)}")
        if report.negative_topics:
            lines.append(f"- Negative topic hints: {', '.join(report.negative_topics)}")
        lines.append("")

        if report.positive_quotes:
            lines.append("### Positive Signals")
            lines.append("")
            for quote in report.positive_quotes:
                lines.append(f"- {quote}")
            lines.append("")

        if report.negative_quotes:
            lines.append("### Negative Signals")
            lines.append("")
            for quote in report.negative_quotes:
                lines.append(f"- {quote}")
            lines.append("")

    lines.append("## Solo Dev Idea Reading Notes")
    lines.append("")
    lines.append("- Players repeatedly reward fast-to-understand core loops, strong replay hooks, and satisfying escalation.")
    lines.append("- Common complaints cluster around repetition, weak onboarding, poor balance, and late-game drag.")
    lines.append("- For solo-friendly concept selection, compact systemic genres still look attractive: deckbuilder, auto-battler/survivor-like, management-lite, cozy progression loops, and strategy games with short runs.")
    lines.append("")
    return "\n".join(lines).strip() + "\n"


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    cache_dir = Path(args.cache_dir).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    reports: list[GameReport] = []
    for appid, name in DEFAULT_GAMES:
        reports.append(
            fetch_game_reviews(
                appid=appid,
                name=name,
                max_pages=args.max_pages,
                page_size=args.page_size,
                day_range=args.day_range,
                delay_sec=args.delay_sec,
                max_retries=args.max_retries,
                cache_dir=cache_dir,
            )
        )
        time.sleep(args.delay_sec + random.uniform(0.35, 0.9))

    output_path.write_text(render_markdown(reports, args), encoding="utf-8")
    print(str(output_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
