"""Resolve a URL to a local cache file."""

from __future__ import annotations

import tempfile
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlparse

ProgressFn = Callable[[str, int, str], None]


def fetch_to_cache(
    url: str,
    *,
    cache_dir: Path | None = None,
    on_progress: ProgressFn | None = None,
) -> Path:
    """Download URL to cache_dir. Uses yt-dlp for video hosts when installed."""
    parsed = urlparse(url)
    if parsed.scheme in ("", "file"):
        return Path(url).expanduser().resolve()

    dest_root = cache_dir or Path(tempfile.gettempdir()) / "content-understand-cache"
    dest_root.mkdir(parents=True, exist_ok=True)

    host = (parsed.netloc or "").lower()
    video_hosts = ("youtube.com", "youtu.be", "bilibili.com", "b23.tv")

    if any(h in host for h in video_hosts):
        try:
            from engine.fetch.video_ytdlp import download_video

            if on_progress:
                on_progress("download", 30, "yt-dlp")
            return download_video(url, dest_root)
        except ImportError as e:
            raise RuntimeError(
                "Video URL needs yt-dlp. Install: pip install 'yt-dlp>=2024.0.0'"
            ) from e

    try:
        from engine.fetch.http_fetch import download_http

        if on_progress:
            on_progress("download", 30, "http")
        return download_http(url, dest_root)
    except ImportError as e:
        raise RuntimeError("HTTP fetch unavailable") from e
