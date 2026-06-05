"""Bilibili video downloader with multi-strategy fallback."""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests

from content_understand.downloaders.base import Downloader, VideoInfo

logger = logging.getLogger(__name__)

_BVID_RE = re.compile(r"BV[\w]+")
_BILIBILI_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:bilibili\.com/video/|b23\.tv/)"
)
_FULL_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)
_REFERER = "https://www.bilibili.com/"
_QUALITY_MAP = {"360p": 16, "480p": 32, "720p": 64, "1080p": 80}


class BilibiliDownloader(Downloader):
    """Download videos from Bilibili with 4-level strategy fallback."""

    def __init__(
        self,
        cookies_file: str | None = None,
        quality: int = 32,
        max_retries: int = 3,
        request_timeout: int = 10,
        download_timeout: int = 600,
        yt_dlp_path: str = "yt-dlp",
        ffmpeg_path: str = "ffmpeg",
    ) -> None:
        self.cookies_file = cookies_file
        self.quality = quality
        self.max_retries = max_retries
        self.request_timeout = request_timeout
        self.download_timeout = download_timeout
        self.yt_dlp_path = yt_dlp_path
        self.ffmpeg_path = ffmpeg_path
        self._headers = {"User-Agent": _FULL_USER_AGENT, "Referer": _REFERER}

    def can_handle(self, url: str) -> bool:
        return bool(_BILIBILI_URL_RE.search(url))

    def get_info(self, url: str) -> VideoInfo:
        try:
            return self._get_info_ytdlp(url)
        except Exception as exc:
            logger.warning("yt-dlp info failed: %s — trying API fallback", exc)

        bvid = _extract_bvid(url)
        if not bvid:
            raise RuntimeError(f"Cannot extract BVID from URL and yt-dlp failed: {url}")
        try:
            return self._get_info_api(bvid)
        except Exception as exc:
            raise RuntimeError(
                f"Both yt-dlp and Bilibili API failed for {url}: {exc}"
            ) from exc

    def download(self, url: str, output_path: str) -> str:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        errors: list[str] = []

        if self.cookies_file:
            try:
                result = self._download_ytdlp(url, output_path, use_cookies=True)
                if result:
                    return result
            except Exception as exc:
                errors.append(f"yt-dlp+cookies: {exc}")

        try:
            result = self._download_ytdlp(url, output_path, use_cookies=False)
            if result:
                return result
        except Exception as exc:
            errors.append(f"yt-dlp: {exc}")

        bvid = _extract_bvid(url)
        if not bvid:
            raise RuntimeError(
                f"All yt-dlp strategies failed and cannot extract BVID from {url}. "
                f"Errors: {errors}"
            )

        try:
            result = self._download_dash(bvid, output_path)
            if result:
                return result
        except Exception as exc:
            errors.append(f"DASH: {exc}")

        try:
            result = self._download_single_stream(bvid, output_path)
            if result:
                return result
        except Exception as exc:
            errors.append(f"single-stream: {exc}")

        raise RuntimeError(f"All download strategies failed for {url}. Errors: {errors}")

    def extract_subtitles(self, url: str, languages: str = "zh-CN,en") -> str | None:
        langs = [lang.strip() for lang in languages.split(",") if lang.strip()]
        for lang in langs:
            with tempfile.TemporaryDirectory(prefix="bili_sub_") as tmpdir:
                out_tpl = os.path.join(tmpdir, "sub")
                proc = self._run_ytdlp(
                    [
                        "--write-auto-sub",
                        "--sub-lang",
                        lang,
                        "--sub-format",
                        "vtt",
                        "--skip-download",
                        "-o",
                        out_tpl,
                        url,
                    ]
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

    # -- Private helpers (yt-dlp, DASH, single-stream, info) --

    def _download_ytdlp(self, url: str, output_path: str, *, use_cookies: bool) -> str | None:
        args = ["-f", "best[ext=mp4]/best", "--no-playlist", "-o", output_path, "--no-overwrites"]
        if use_cookies and self.cookies_file:
            args.extend(["--cookies", self.cookies_file])
        args.append(url)

        proc = self._run_ytdlp(args)
        if proc.returncode != 0:
            stderr = proc.stderr.strip()
            if "has already been downloaded" in stderr and os.path.exists(output_path):
                return output_path
            raise RuntimeError(f"yt-dlp exited {proc.returncode}: {stderr}")

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return output_path

        parent = Path(output_path).parent
        stem = Path(output_path).stem
        for candidate in parent.iterdir():
            if candidate.stem == stem and candidate.suffix in (".mp4", ".mkv", ".webm"):
                return str(candidate)
        return None

    def _download_dash(self, bvid: str, output_path: str) -> str | None:
        cid = self._get_cid(bvid)
        if not cid:
            raise RuntimeError(f"Cannot get CID for {bvid}")
        dash = self._get_dash_streams(bvid, cid)
        if not dash:
            raise RuntimeError(f"No DASH streams available for {bvid}")

        video_url = dash["video"][0]["baseUrl"]
        audio_url = dash["audio"][0]["baseUrl"]
        tmp_video = output_path + ".v.m4s"
        tmp_audio = output_path + ".a.m4s"

        try:
            self._download_stream(video_url, tmp_video, timeout=300)
            self._download_stream(audio_url, tmp_audio, timeout=120)

            proc = subprocess.run(
                [
                    self.ffmpeg_path, "-y",
                    "-i", tmp_video, "-i", tmp_audio,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "28",
                    "-c:a", "aac", "-b:a", "64k",
                    "-movflags", "+faststart",
                    output_path,
                ],
                capture_output=True,
                timeout=self.download_timeout,
            )
            if proc.returncode != 0:
                raise RuntimeError(
                    f"ffmpeg merge failed (rc={proc.returncode}): "
                    f"{proc.stderr.decode(errors='replace').strip()}"
                )
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                return output_path
            raise RuntimeError("ffmpeg produced empty output file")
        finally:
            for tmp in (tmp_video, tmp_audio):
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

    def _download_single_stream(self, bvid: str, output_path: str) -> str | None:
        cid = self._get_cid(bvid)
        if not cid:
            raise RuntimeError(f"Cannot get CID for {bvid}")
        playback_url = self._get_playback_url(bvid, cid)
        if not playback_url:
            raise RuntimeError(f"Cannot get playback URL for {bvid}")

        for attempt in range(self.max_retries):
            try:
                return self._download_with_resume(playback_url, output_path)
            except Exception as exc:
                logger.warning("Single-stream attempt %d/%d failed: %s", attempt + 1, self.max_retries, exc)
                if attempt < self.max_retries - 1:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise
        return None

    def _download_with_resume(self, url: str, output_path: str) -> str:
        headers = dict(self._headers)
        downloaded = 0
        if os.path.exists(output_path):
            downloaded = os.path.getsize(output_path)
            headers["Range"] = f"bytes={downloaded}-"

        r = requests.get(url, headers=headers, timeout=300, stream=True)
        if r.status_code == 416:
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                return output_path
            raise RuntimeError("416 Range Not Satisfiable but no existing file")
        if r.status_code not in (200, 206):
            raise RuntimeError(f"HTTP {r.status_code} downloading single stream")

        mode = "ab" if downloaded > 0 else "wb"
        with open(output_path, mode) as f:
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return output_path
        raise RuntimeError("Downloaded file is empty")

    def _get_info_ytdlp(self, url: str) -> VideoInfo:
        proc = self._run_ytdlp(["--dump-json", "--no-download", url])
        if proc.returncode != 0:
            raise RuntimeError(f"yt-dlp --dump-json failed: {proc.stderr.strip()}")
        data = json.loads(proc.stdout)
        extractor = data.get("extractor_key") or data.get("extractor") or ""
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
            duration=_safe_int(data.get("duration")),
            description=data.get("description", ""),
            upload_date=data.get("upload_date", ""),
            platform=extractor or "BiliBili",
            filesize=_safe_int(data.get("filesize") or data.get("filesize_approx")),
            format=data.get("format", ""),
            subtitles=unique_subs,
        )

    def _get_info_api(self, bvid: str) -> VideoInfo:
        r = self._api_get(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}")
        data = r.json()
        if data.get("code") != 0:
            raise RuntimeError(f"Bilibili API returned code={data.get('code')}: {data.get('message')}")
        info = data["data"]
        return VideoInfo(
            url=f"https://www.bilibili.com/video/{bvid}/",
            title=info.get("title", ""),
            author=info.get("owner", {}).get("name", ""),
            duration=_safe_int(info.get("duration")),
            description=info.get("desc", ""),
            upload_date=str(info.get("pubdate", "")),
            platform="BiliBili",
        )

    def _api_get(self, url: str) -> requests.Response:
        r = requests.get(url, headers=self._headers, timeout=self.request_timeout)
        if r.status_code != 200:
            raise RuntimeError(f"Bilibili API HTTP {r.status_code} for {url}")
        return r

    def _get_cid(self, bvid: str) -> int | None:
        try:
            r = self._api_get(f"https://api.bilibili.com/x/player/pagelist?bvid={bvid}")
            data = r.json()
            pages = data.get("data")
            if not pages:
                raise RuntimeError(f"Empty pagelist for {bvid}")
            cid = pages[0].get("cid")
            if not cid:
                raise RuntimeError(f"No CID in first page for {bvid}")
            return int(cid)
        except (RuntimeError, requests.RequestException) as exc:
            raise RuntimeError(f"Failed to get CID for {bvid}: {exc}") from exc

    def _get_dash_streams(self, bvid: str, cid: int) -> dict | None:
        try:
            r = self._api_get(
                f"https://api.bilibili.com/x/player/playurl"
                f"?bvid={bvid}&cid={cid}&qn={self.quality}&fnval=16"
            )
            data = r.json()
            if data.get("code") != 0:
                raise RuntimeError(f"playurl API code={data.get('code')}: {data.get('message')}")
            dash = data.get("data", {}).get("dash")
            if not dash or not dash.get("video") or not dash.get("audio"):
                return None
            return dash
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"Failed to get DASH streams for {bvid}: {exc}") from exc

    def _get_playback_url(self, bvid: str, cid: int) -> str | None:
        try:
            r = self._api_get(
                f"https://api.bilibili.com/x/player/playurl"
                f"?bvid={bvid}&cid={cid}&qn={self.quality}&fnval=1"
            )
            data = r.json()
            if data.get("code") != 0:
                raise RuntimeError(f"playurl API code={data.get('code')}: {data.get('message')}")
            durl = data.get("data", {}).get("durl", [])
            if not durl:
                return None
            url = durl[0].get("url")
            if not url:
                raise RuntimeError("playurl returned empty URL in durl")
            return url
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"Failed to get playback URL for {bvid}: {exc}") from exc

    def _download_stream(self, url: str, dest: str, *, timeout: int) -> None:
        for attempt in range(self.max_retries):
            try:
                r = requests.get(url, headers=self._headers, stream=True, timeout=timeout)
                if r.status_code != 200:
                    raise RuntimeError(f"HTTP {r.status_code}")
                with open(dest, "wb") as f:
                    for chunk in r.iter_content(65536):
                        f.write(chunk)
                return
            except Exception as exc:
                if attempt == self.max_retries - 1:
                    raise RuntimeError(f"Stream download failed after {self.max_retries} attempts: {exc}") from exc
                time.sleep(2 * (attempt + 1))

    def _run_ytdlp(self, args: list[str]) -> subprocess.CompletedProcess:
        cmd = [self.yt_dlp_path, *args]
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=self.download_timeout)
        except FileNotFoundError as exc:
            raise RuntimeError(f"yt-dlp not found at '{self.yt_dlp_path}': {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"yt-dlp timed out after {self.download_timeout}s") from exc


def _extract_bvid(url: str) -> str | None:
    match = _BVID_RE.search(url)
    return match.group(0) if match else None


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
