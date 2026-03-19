from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.research_storage import (
    build_collection_job_handoff,
    collection_metrics,
    collection_genre_rankings,
    game_metrics,
    ingest_steam_cache,
    list_collection_items,
    list_collection_jobs,
    list_games,
    load_collection_job,
    load_overview,
    plan_agent_collection_job,
    plan_dynamic_collection_job,
    query_reviews,
    record_collection_job_run,
    sentiment_series,
)


def make_cache_page(
    workspace: Path,
    *,
    slug: str,
    appid: int,
    page_index: int,
    recommendation_id: str,
    review: str,
    voted_up: bool,
) -> None:
    target = workspace / ".rail" / "cache" / "steam-review-probe" / slug / f"page-{page_index}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "fetchedAt": "2026-03-19T00:00:00+00:00",
        "url": f"https://store.steampowered.com/appreviews/{appid}?json=1",
        "payload": {
            "success": 1,
            "query_summary": {
                "review_score_desc": "Very Positive",
                "total_positive": 10,
                "total_negative": 2,
                "total_reviews": 12,
            },
            "reviews": [
                {
                    "recommendationid": recommendation_id,
                    "author": {
                        "steamid": "12345",
                        "playtime_forever": 180,
                    },
                    "language": "english",
                    "review": review,
                    "timestamp_created": 1700000000 + page_index,
                    "timestamp_updated": 1700000100 + page_index,
                    "voted_up": voted_up,
                    "votes_up": 5,
                    "votes_funny": 1,
                    "comment_count": 0,
                    "steam_purchase": True,
                    "received_for_free": False,
                    "refunded": False,
                    "written_during_early_access": False,
                    "primarily_steam_deck": False,
                    "reactions": [],
                }
            ],
            "cursor": "*",
        },
    }
    target.write_text(json.dumps(payload), encoding="utf-8")


class ResearchStorageTests(unittest.TestCase):
    def test_ingest_promotes_cache_into_raw_run_and_db(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            make_cache_page(
                workspace,
                slug="balatro",
                appid=2379780,
                page_index=1,
                recommendation_id="rec-1",
                review="one more run, still incredible",
                voted_up=True,
            )
            make_cache_page(
                workspace,
                slug="balatro",
                appid=2379780,
                page_index=2,
                recommendation_id="rec-2",
                review="great loop but a little repetitive",
                voted_up=False,
            )

            result = ingest_steam_cache(workspace)

            self.assertEqual(result["games"], 1)
            self.assertEqual(result["rawDocuments"], 2)
            self.assertEqual(result["reviews"], 2)
            self.assertTrue(Path(result["dbPath"]).is_file())
            self.assertTrue(Path(result["manifestPath"]).is_file())
            self.assertTrue((workspace / ".rail" / "research" / "raw" / "steam" / result["runId"]).is_dir())

            overview = load_overview(workspace)
            self.assertEqual(overview["totals"]["runs"], 1)
            self.assertEqual(overview["totals"]["reviews"], 2)

    def test_query_reviews_filters_by_sentiment_and_search(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            make_cache_page(
                workspace,
                slug="balatro",
                appid=2379780,
                page_index=1,
                recommendation_id="rec-1",
                review="one more run, still incredible",
                voted_up=True,
            )
            make_cache_page(
                workspace,
                slug="balatro",
                appid=2379780,
                page_index=2,
                recommendation_id="rec-2",
                review="tutorial is weak and the balance feels rough",
                voted_up=False,
            )
            ingest_steam_cache(workspace)

            positives = query_reviews(
                workspace,
                source="steam",
                game_key="steam:2379780",
                sentiment="positive",
                language="",
                search="one more",
                limit=20,
                offset=0,
            )
            negatives = query_reviews(
                workspace,
                source="steam",
                game_key="steam:2379780",
                sentiment="negative",
                language="",
                search="balance",
                limit=20,
                offset=0,
            )

            self.assertEqual(positives["total"], 1)
            self.assertEqual(negatives["total"], 1)
            self.assertEqual(positives["items"][0]["ratingDirection"], "positive")
            self.assertEqual(negatives["items"][0]["ratingDirection"], "negative")

    def test_game_metrics_and_series_are_chart_ready(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            make_cache_page(
                workspace,
                slug="balatro",
                appid=2379780,
                page_index=1,
                recommendation_id="rec-1",
                review="one more run, still incredible",
                voted_up=True,
            )
            make_cache_page(
                workspace,
                slug="balatro",
                appid=2379780,
                page_index=2,
                recommendation_id="rec-2",
                review="tutorial is weak and the balance feels rough",
                voted_up=False,
            )
            ingest_steam_cache(workspace)

            games = list_games(workspace, source="steam")
            metrics = game_metrics(workspace, source="steam")
            series = sentiment_series(workspace, source="steam", game_key="steam:2379780", limit=30)

            self.assertEqual(len(games["items"]), 1)
            self.assertEqual(games["items"][0]["gameKey"], "steam:2379780")
            self.assertEqual(metrics["items"][0]["totalReviews"], 2)
            self.assertEqual(metrics["items"][0]["positiveReviews"], 1)
            self.assertEqual(metrics["items"][0]["negativeReviews"], 1)
            self.assertEqual(len(series["items"]), 1)
            self.assertEqual(sum(item["totalReviews"] for item in series["items"]), 2)

    def test_plan_dynamic_collection_job_persists_strategy_and_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)

            planned = plan_dynamic_collection_job(
                workspace,
                urls_json=json.dumps(
                    [
                        "https://reddit.com/r/gamedev",
                        "https://opencritic.com/game/123/example-game",
                        "https://example.com/feed.xml",
                    ]
                ),
                keywords_json=json.dumps(["indie game", "steam reviews"]),
                label="Idea sweep",
                requested_source_type="auto",
                max_items=30,
            )

            job = planned["job"]
            self.assertEqual(job["specVersion"], 1)
            self.assertEqual(job["label"], "Idea sweep")
            self.assertEqual(job["resolvedSourceType"], "community")
            self.assertEqual(len(job["targets"]), 3)
            self.assertIn(job["collectorStrategy"], {"mixed", "mixed_browser", "mixed_feed"})

            listed = list_collection_jobs(workspace)
            self.assertEqual(len(listed["items"]), 1)
            loaded = load_collection_job(workspace, job_id=job["jobId"])
            self.assertEqual(loaded["job"]["jobId"], job["jobId"])

            handoff = build_collection_job_handoff(workspace, job_id=job["jobId"], agent_role="researcher")
            self.assertEqual(handoff["handoff"]["jobId"], job["jobId"])
            self.assertIn("Targets:", handoff["handoff"]["prompt"])

    def test_plan_dynamic_collection_job_blocks_localhost_targets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            with self.assertRaises(RuntimeError):
                plan_dynamic_collection_job(
                    workspace,
                    urls_json=json.dumps(["http://127.0.0.1:8000/private"]),
                    keywords_json="[]",
                    label="Unsafe",
                    requested_source_type="auto",
                    max_items=20,
                )

    def test_record_collection_job_run_normalizes_source_agnostic_items(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            planned = plan_dynamic_collection_job(
                workspace,
                urls_json=json.dumps(["https://opencritic.com/game/123/example-game"]),
                keywords_json=json.dumps(["roguelike"]),
                label="Critic sweep",
                requested_source_type="critic",
                max_items=20,
            )
            job_id = planned["job"]["jobId"]
            result = {
                "status": "done",
                "run_id": "via-123",
                "artifacts": [
                    {
                        "format": "json",
                        "path": str(workspace / "tmp" / "export.json"),
                    }
                ],
                "detail": {
                    "payload": {
                        "items_all": [
                            {
                                "id": "critic-1",
                                "source_type": "source.news",
                                "source_name": "OpenCritic",
                                "country": "GLOBAL",
                                "adapter": "source.news.dynamic.search",
                                "title": "Example Game Review Roundup",
                                "url": "https://opencritic.com/game/123/example-game/reviews",
                                "summary": "Critics praise the run variety and punchy combat.",
                                "content_excerpt": "Strong pacing, excellent runs, weak onboarding.",
                                "published_at": "2026-03-19T00:00:00+00:00",
                                "fetched_at": "2026-03-19T01:00:00+00:00",
                                "normalized_key": "roundup-1",
                                "verification_status": "verified",
                                "score": 88,
                                "hot_score": 14,
                                "source_count": 2,
                                "comments": 12,
                            },
                            {
                                "id": "critic-2",
                                "source_type": "source.news",
                                "source_name": "Eurogamer",
                                "country": "UK",
                                "adapter": "source.news.dynamic.search",
                                "title": "Example Game review",
                                "url": "https://www.eurogamer.net/example-game-review",
                                "summary": "Excellent systems, rough UI.",
                                "content_excerpt": "Build depth shines once the first two hours are over.",
                                "published_at": "2026-03-18T12:00:00+00:00",
                                "fetched_at": "2026-03-19T01:00:00+00:00",
                                "verification_status": "warning",
                                "score": 71,
                                "hot_score": 9,
                                "source_count": 1,
                            },
                        ]
                    }
                },
            }

            execution = record_collection_job_run(workspace, job_id=job_id, flow_id=1, result=result)
            items = list_collection_items(
                workspace,
                job_id=job_id,
                source_type="",
                verification_status="",
                search="",
                limit=20,
                offset=0,
            )
            metrics = collection_metrics(workspace, job_id=job_id)
            overview = load_overview(workspace)

            self.assertEqual(execution["itemCount"], 2)
            self.assertEqual(items["total"], 2)
            self.assertEqual(items["items"][0]["sourceName"], "OpenCritic")
            self.assertEqual(metrics["totals"]["items"], 2)
            self.assertEqual(metrics["totals"]["verified"], 1)
            self.assertEqual(metrics["totals"]["warnings"], 1)
            self.assertEqual(metrics["bySourceType"][0]["sourceType"], "source.news")
            self.assertEqual(overview["totals"]["collectionItems"], 2)

    def test_plan_agent_collection_job_derives_keywords_and_domains_from_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            planned = plan_agent_collection_job(
                workspace,
                prompt="@researcher 스팀 게임 최근 리뷰와 장르별 평가를 조사해줘",
                label="",
                requested_source_type="auto",
                max_items=40,
            )

            job = planned["job"]
            self.assertEqual(job["collectorStrategy"], "dynamic_search")
            self.assertEqual(job["targets"], [])
            self.assertIn("steamcommunity.com", job["domains"])
            self.assertTrue(any("스팀" in keyword or "steam" in keyword.lower() for keyword in job["keywords"]))
            self.assertIn("planner", job)

    def test_plan_agent_collection_job_marks_steam_genre_ranking_requests(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            planned = plan_agent_collection_job(
                workspace,
                prompt="스팀 평가 기준으로 2026년 3월 19일 기준 가장 인기있는 장르와 평이 제일 좋은 장르 그리고 대표게임 리스트를 조사해줘",
                label="",
                requested_source_type="auto",
                max_items=40,
            )

            job = planned["job"]
            planner = job["planner"]
            self.assertEqual(planner["analysisMode"], "genre_ranking")
            self.assertEqual(planner["aggregationUnit"], "genre")
            self.assertEqual(planner["dataScope"], "steam_market")
            self.assertIn("popularity", planner["metricFocus"])
            self.assertIn("quality", planner["metricFocus"])
            self.assertIn("representatives", planner["metricFocus"])
            self.assertEqual(job["requestedSourceType"], "community")
            self.assertEqual(job["resolvedSourceType"], "community")
            self.assertEqual(job["viaSourceType"], "source.community")
            self.assertIn("steamdb.info", job["domains"])
            self.assertTrue(any("steam genre" in keyword.lower() for keyword in job["keywords"]))
            self.assertTrue(any("genre level" in instruction.lower() for instruction in planner["instructions"]))

    def test_plan_agent_collection_job_extracts_task_request_from_role_formatted_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            planned = plan_agent_collection_job(
                workspace,
                prompt=(
                    "Formatting re-enabled\n\n"
                    "<role_profile>\nrole_name: 리서처\n</role_profile>\n\n"
                    "<task_request>\n"
                    "스팀 평가 기준으로 가장 인기있는 장르와 대표 게임 리스트를 조사해줘\n"
                    "</task_request>\n\n"
                    "[ROLE_KB_INJECT]\nnoise\n[/ROLE_KB_INJECT]"
                ),
                label="",
                requested_source_type="auto",
                max_items=40,
            )

            job = planned["job"]
            planner = job["planner"]
            self.assertEqual(planner["prompt"], "스팀 평가 기준으로 가장 인기있는 장르와 대표 게임 리스트를 조사해줘")
            self.assertTrue(all("Formatting re-enabled" not in keyword for keyword in job["keywords"]))

    def test_record_collection_job_run_persists_genre_rankings_for_genre_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            planned = plan_agent_collection_job(
                workspace,
                prompt="스팀에서 가장 인기있는 장르와 평이 좋은 장르, 대표 게임 리스트를 조사해줘",
                label="",
                requested_source_type="auto",
                max_items=40,
            )
            job_id = planned["job"]["jobId"]
            result = {
                "status": "done",
                "run_id": "via-genre-1",
                "payload": {
                    "items_all": [
                        {
                            "id": "row-1",
                            "source_type": "source.community",
                            "source_name": "steamcommunity.com",
                            "title": "Deckbuilder players still love run variety in Slay the Spire",
                            "summary": "The deckbuilder roguelite formula keeps replayability high.",
                            "content_excerpt": "Players call deckbuilder runs endlessly replayable.",
                            "url": "https://steamcommunity.com/app/646570/reviews",
                            "published_at": "2026-03-19T02:00:00Z",
                            "fetched_at": "2026-03-19T02:05:00Z",
                            "verification_status": "verified",
                            "score": 86,
                            "hot_score": 24,
                        },
                        {
                            "id": "row-2",
                            "source_type": "source.news",
                            "source_name": "opencritic.com",
                            "title": "Critics say roguelite deckbuilder pacing is still excellent",
                            "summary": "Deckbuilder and roguelite hybrids continue to review well.",
                            "content_excerpt": "High critic enthusiasm for deckbuilder progression.",
                            "url": "https://opencritic.com/game/646570/slay-the-spire",
                            "published_at": "2026-03-19T02:10:00Z",
                            "fetched_at": "2026-03-19T02:12:00Z",
                            "verification_status": "verified",
                            "score": 91,
                            "hot_score": 18,
                        },
                        {
                            "id": "row-3",
                            "source_type": "source.community",
                            "source_name": "reddit.com",
                            "title": "Factory sim fans keep recommending automation games like Factorio",
                            "summary": "Automation and factory sim loops remain sticky.",
                            "content_excerpt": "Factory sim players praise optimization depth.",
                            "url": "https://reddit.com/r/factorio/comments/example",
                            "published_at": "2026-03-19T03:00:00Z",
                            "fetched_at": "2026-03-19T03:02:00Z",
                            "verification_status": "warning",
                            "score": 72,
                            "hot_score": 12,
                        },
                    ]
                },
            }

            execution = record_collection_job_run(workspace, job_id=job_id, flow_id=1, result=result)
            rankings = collection_genre_rankings(workspace, job_id=job_id)

            self.assertEqual(execution["genreRankingCounts"]["popular"], len(rankings["popular"]))
            self.assertGreaterEqual(len(rankings["popular"]), 1)
            self.assertGreaterEqual(len(rankings["quality"]), 1)
            self.assertEqual(rankings["popular"][0]["genreKey"], "deckbuilder")
            self.assertIn("Slay the Spire", rankings["popular"][0]["representativeTitles"][0])
            self.assertEqual(rankings["quality"][0]["genreKey"], "deckbuilder")


if __name__ == "__main__":
    unittest.main()
