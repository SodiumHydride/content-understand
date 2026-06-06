"""Cache directory cleanup — evicts stale downloaded files."""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

logger = logging.getLogger(__name__)


def cleanup_stale_cache(cache_dir: Path, max_age_seconds: int = 3600) -> int:
    """Delete files in *cache_dir* older than *max_age_seconds*.

    Returns the number of files removed.
    """
    if not cache_dir.is_dir():
        return 0

    cutoff = time.time() - max_age_seconds
    removed = 0

    for entry in cache_dir.iterdir():
        if entry.is_file():
            try:
                if entry.stat().st_mtime < cutoff:
                    entry.unlink()
                    removed += 1
            except OSError:
                pass
        elif entry.is_dir():
            # UUID-named subdirectories (e.g. video_ytdlp downloader)
            try:
                if entry.stat().st_mtime < cutoff:
                    shutil.rmtree(entry)
                    removed += 1
            except OSError:
                pass

    if removed:
        logger.info("Cache cleanup: removed %d stale item(s) from %s", removed, cache_dir)
    return removed
