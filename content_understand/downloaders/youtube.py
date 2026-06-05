"""YouTube downloader using yt-dlp Python library."""

from __future__ import annotations

import logging
import os
import re
import tempfile
import uuid
from pathlib import Path

import yt_dlp

from content_understand.defaults import VIDEO_QUALITY_DEFAULT
from content_understand.downloaders._utils import parse_vtt, safe_int
from content_understand.downloaders.base import Downloader, VideoInfo

logger = logging.getLogger(__name__)


def _ydl_opts(**overrides) -> dict:
    """Base yt-dlp options.  Callers merge in site-specific overrides."""
    base = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 3,
    }
    base.update(overrides)
    return base


class YouTubeDownloader(Downloader):
    """Downloader for YouTube videos via yt-dlp Python library."""

    _PATTERNS = [re.compile(r"(www\.)?youtube\.com"), re.compile(r"youtu\.be")]

    def __init__(self, quality: int = VIDEO_QUALITY_DEFAULT) -> None:
        self.quality = quality

    def can_handle(self, url: str) -> bool:
        return any(p.search(url) for p in self._PATTERNS)

    def get_info(self, url: str) -> VideoInfo:
        opts = _ydl_opts(skip_download=True)
        with yt_dlp.YoutubeDL(opts) as ydl:
            data = ydl.extract_info(url, download=False)

        if not data:
            raise RuntimeError(f"yt-dlp returned no info for {url}")

        sub_langs: list[str] = []
        for key in ("subtitles", "automatic_captions"):
            if isinstance(data.get(key), dict):
                sub_langs.extend(data[key].keys())
        seen: set[str] = set()
        unique_subs = [lang for lang in sub_langs if lang not in seen and not seen.add(lang)]

        return VideoInfo(
            url=url,
            title=data.get("title", ""),
            author=data.get("uploader") or data.get("channel") or "",
            duration=safe_int(data.get("duration")),
            description=data.get("description", ""),
            upload_date=data.get("upload_date", ""),
            platform="YouTube",
            filesize=safe_int(data.get("filesize") or data.get("filesize_approx")),
            format=data.get("format", ""),
            subtitles=unique_subs,
        )

    def download(self, url: str, output_path: str) -> str:
        output_dir = os.path.dirname(output_path) or "."
        os.makedirs(output_dir, exist_ok=True)

        uid = uuid.uuid4().hex[:8]
        outtmpl = os.path.join(output_dir, f"%(id)s_{uid}.%(ext)s")

        opts = _ydl_opts(
            outtmpl=outtmpl,
            format=f"bv*[height<={self.quality}]+ba/b[height<={self.quality}]/b",
            merge_output_format="mp4",
            no_playlist=True,
        )

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

        if not info:
            raise RuntimeError(f"yt-dlp produced no info for {url}")

        # Try the canonical filename first
        filename = yt_dlp.YoutubeDL(opts).prepare_filename(info)
        if os.path.exists(filename) and os.path.getsize(filename) > 0:
            return filename

        # Fallback: search by ID in the output directory
        video_id = info.get("id", "")
        for candidate in Path(output_dir).iterdir():
            if candidate.is_file() and video_id in candidate.name and candidate.suffix in (
                ".mp4", ".mkv", ".webm", ".mov",
            ):
                return str(candidate.resolve())

        raise RuntimeError(f"Download completed but no video file found at {output_path}")

    def extract_subtitles(self, url: str, languages: str = "zh-CN,en") -> str | None:
        langs = [lang.strip() for lang in languages.split(",") if lang.strip()]
        for lang in langs:
            with tempfile.TemporaryDirectory(prefix="vtt_") as tmpdir:
                out_tpl = os.path.join(tmpdir, "sub")
                opts = _ydl_opts(
                    outtmpl=out_tpl,
                    writeautomaticsub=True,
                    subtitleslangs=[lang],
                    subtitlesformat="vtt",
                    skip_download=True,
                )
                try:
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        ydl.extract_info(url, download=True)
                except Exception:
                    logger.debug("Subtitle extraction failed for lang=%s", lang, exc_info=True)
                    continue

                vtt_files = list(Path(tmpdir).glob("*.vtt"))
                if not vtt_files:
                    continue
                text = parse_vtt(vtt_files[0])
                if text:
                    return text
        return None
