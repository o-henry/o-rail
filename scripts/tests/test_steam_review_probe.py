from __future__ import annotations

import unittest
from urllib.parse import parse_qs, urlencode, urlparse

from scripts.steam_review_probe import build_request_params, stable_slug


class SteamReviewProbeTests(unittest.TestCase):
    def test_build_request_params_keeps_raw_cursor_for_urlencode(self) -> None:
        cursor = "AoIIPwYcP9sC"
        params = build_request_params(cursor=cursor, day_range=365, page_size=40)

        self.assertEqual(params["cursor"], cursor)

        encoded = urlparse(f"https://example.com/?{urlencode(params)}")
        self.assertTrue(encoded.query)

    def test_build_request_params_caps_page_size(self) -> None:
        params = build_request_params(cursor="*", day_range=365, page_size=999)
        self.assertEqual(params["num_per_page"], 100)

    def test_urlencode_does_not_double_encode_cursor(self) -> None:
        params = build_request_params(cursor="AoIIPwYcP9sC", day_range=180, page_size=20)
        query = parse_qs(urlparse(f"https://example.com/?{urlencode(params)}").query)
        self.assertEqual(query["cursor"][0], "AoIIPwYcP9sC")

    def test_stable_slug_normalizes_text(self) -> None:
        self.assertEqual(stable_slug("Steam Review"), "steam-review")
        self.assertEqual(stable_slug("  Weird___Name!!  "), "weird-name")


if __name__ == "__main__":
    unittest.main()
