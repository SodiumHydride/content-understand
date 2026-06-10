"""Export browser cookies for Bilibili (no yt-dlp URL extraction)."""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_SUPPORTED = frozenset(
    {"brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale"}
)


def export_browser_cookies(browser: str, dest: Path) -> int:
    """Write Netscape cookie jar from *browser* to *dest*. Returns byte size."""
    name = (browser or "chrome").strip().lower()
    if name not in _SUPPORTED:
        raise ValueError(
            f"Unsupported browser '{browser}'. Use one of: {', '.join(sorted(_SUPPORTED))}"
        )

    try:
        from yt_dlp.cookies import extract_cookies_from_browser
    except ImportError as exc:
        raise RuntimeError("yt-dlp is required. Install with: pip install yt-dlp") from exc

    dest.parent.mkdir(parents=True, exist_ok=True)
    jar = extract_cookies_from_browser(name, None, logger)
    jar.save(str(dest), ignore_discard=True, ignore_expires=True)

    if not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(
            f"No cookies exported from {name}. "
            "Log into bilibili.com in that browser, then try again."
        )
    return dest.stat().st_size
