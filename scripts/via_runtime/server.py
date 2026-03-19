#!/usr/bin/env python3
"""Thin entrypoint for the embedded VIA runtime."""

from __future__ import annotations

import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from server_impl import main


if __name__ == "__main__":
    raise SystemExit(main())
