"""Video/audio download via yt-dlp (open source)."""

from __future__ import annotations

import uuid
from pathlib import Path

from content_understand.defaults import VIDEO_QUALITY_DEFAULT


def download_video(url: str, dest_dir: Path, quality: int = VIDEO_QUALITY_DEFAULT) -> Path:
    import yt_dlp

    # Use a unique subdirectory per download to prevent race conditions
    # when multiple downloads run concurrently.
    download_id = uuid.uuid4().hex[:12]
    job_dir = dest_dir / download_id
    job_dir.mkdir(parents=True, exist_ok=True)

    outtmpl = str(job_dir / "%(id)s.%(ext)s")
    opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "format": f"bv*[height<={quality}]+ba/b[height<={quality}]/b",
        "merge_output_format": "mp4",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info))
        if path.exists():
            return path

    # Fallback: newest file in the job-specific directory
    files = sorted(job_dir.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise RuntimeError(f"yt-dlp produced no file for {url}")
    return files[0]
