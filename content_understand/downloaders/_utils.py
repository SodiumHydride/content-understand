"""Shared utilities for video downloaders."""

from __future__ import annotations

import re
from pathlib import Path


def safe_int(val, default: int = 0) -> int:
    """Convert *val* to int, returning *default* on failure."""
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def parse_vtt(vtt_path: Path) -> str:
    """Extract plain text from a WebVTT subtitle file, deduplicating lines."""
    lines: list[str] = []
    prev = ""
    with open(vtt_path, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("WEBVTT") or line.startswith("NOTE"):
                continue
            if re.match(r"^\d+$", line):
                continue
            if re.match(r"[\d:.,]+\s*-->\s*[\d:.,]+", line):
                continue
            clean = re.sub(r"<[^>]+>", "", line).strip()
            if clean and clean != prev:
                lines.append(clean)
                prev = clean
    return " ".join(lines)
