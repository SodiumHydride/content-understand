"""YouTube downloader using yt-dlp."""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path

from content_understand.downloaders.base import Downloader, VideoInfo

logger = logging.getLogger(__name__)

_YT_DLP = "yt-dlp"
_DEFAULT_TIMEOUT = 120


def _run(args: list[str], timeout: int = _DEFAULT_TIMEOUT) -> subprocess.CompletedProcess:
    return subprocess.run([_YT_DLP, *args], capture_output=True, text=True, timeout=timeout)


def _safe_int(val, default: int = 0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _parse_vtt(vtt_path: Path) -> str:
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


class YouTubeDownloader(Downloader):
    """Downloader for YouTube videos via yt-dlp."""

    _PATTERNS = [re.compile(r"(www\.)?youtube\.com"), re.compile(r"youtu\.be")]

    def can_handle(self, url: str) -> bool:
        return any(p.search(url) for p in self._PATTERNS)

    def get_info(self, url: str) -> VideoInfo:
        proc = _run(["--dump-json", "--no-download", url])
        if proc.returncode != 0:
            raise RuntimeError(f"yt-dlp --dump-json failed: {proc.stderr.strip()}")
        data = json.loads(proc.stdout)

        sub_langs: list[str] = []
        if isinstance(data.get("subtitles"), dict):
            sub_langs.extend(data["subtitles"].keys())
        if isinstance(data.get("automatic_captions"), dict):
            sub_langs.extend(data["automatic_captions"].keys())
        seen: set[str] = set()
        unique_subs = [lang for lang in sub_langs if lang not in seen and not seen.add(lang)]

        return VideoInfo(
            url=url,
            title=data.get("title", ""),
            author=data.get("uploader") or data.get("channel") or "",
            duration=_safe_int(data.get("duration")),
            description=data.get("description", ""),
            upload_date=data.get("upload_date", ""),
            platform="YouTube",
            filesize=_safe_int(data.get("filesize") or data.get("filesize_approx")),
            format=data.get("format", ""),
            subtitles=unique_subs,
        )

    def download(self, url: str, output_path: str) -> str:
        output_dir = os.path.dirname(output_path) or "."
        os.makedirs(output_dir, exist_ok=True)

        proc = _run(["-f", "best[ext=mp4]/best", "--no-playlist", "-o", output_path, url], timeout=600)
        if proc.returncode != 0:
            raise RuntimeError(f"yt-dlp download failed: {proc.stderr.strip()}")

        if os.path.exists(output_path):
            return output_path

        candidates = [
            p
            for p in Path(output_dir).iterdir()
            if p.is_file() and p.suffix in (".mp4", ".mkv", ".webm", ".mov")
        ]
        if candidates:
            downloaded = max(candidates, key=lambda p: p.stat().st_mtime)
            return str(downloaded.resolve())

        raise RuntimeError(f"Download completed but no video file found at {output_path}")

    def extract_subtitles(self, url: str, languages: str = "zh-CN,en") -> str | None:
        langs = [l.strip() for l in languages.split(",") if l.strip()]
        for lang in langs:
            with tempfile.TemporaryDirectory(prefix="vtt_") as tmpdir:
                out_tpl = os.path.join(tmpdir, "sub")
                proc = _run(
                    ["--write-auto-sub", "--sub-lang", lang, "--sub-format", "vtt", "--skip-download", "-o", out_tpl, url],
                    timeout=120,
                )
                if proc.returncode != 0:
                    continue
                vtt_files = list(Path(tmpdir).glob("*.vtt"))
                if not vtt_files:
                    continue
                text = _parse_vtt(vtt_files[0])
                if text:
                    return text
        return None
