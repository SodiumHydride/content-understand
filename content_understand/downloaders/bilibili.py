"""Bilibili video downloader with multi-strategy fallback."""

from __future__ import annotations

import logging
import os
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import requests
import yt_dlp

from content_understand.defaults import BILIBILI_QUALITY_DEFAULT
from content_understand.downloaders._utils import parse_vtt, safe_int
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


def _ydl_opts(**overrides) -> dict:
    """Base yt-dlp options for Bilibili."""
    base = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 3,
    }
    base.update(overrides)
    return base


class BilibiliDownloader(Downloader):
    """Download videos from Bilibili with 4-level strategy fallback.

    Strategy order:
    1. yt-dlp (with cookies if provided)
    2. yt-dlp (without cookies)
    3. Bilibili DASH API + ffmpeg merge
    4. Bilibili single-stream API
    """

    def __init__(
        self,
        cookies_file: str | None = None,
        quality: int = BILIBILI_QUALITY_DEFAULT,
        max_retries: int = 3,
        request_timeout: int = 10,
        download_timeout: int = 600,
        ffmpeg_path: str = "ffmpeg",
    ) -> None:
        self.cookies_file = cookies_file
        self.quality = quality
        self.max_retries = max_retries
        self.request_timeout = request_timeout
        self.download_timeout = download_timeout
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
                opts = _ydl_opts(
                    outtmpl=out_tpl,
                    writeautomaticsub=True,
                    subtitleslangs=[lang],
                    subtitlesformat="vtt",
                    skip_download=True,
                )
                if self.cookies_file:
                    opts["cookiefile"] = self.cookies_file
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

    # ── yt-dlp library helpers ──────────────────────────────────────────────

    def _get_info_ytdlp(self, url: str) -> VideoInfo:
        opts = _ydl_opts(skip_download=True)
        if self.cookies_file:
            opts["cookiefile"] = self.cookies_file
        with yt_dlp.YoutubeDL(opts) as ydl:
            data = ydl.extract_info(url, download=False)

        if not data:
            raise RuntimeError(f"yt-dlp returned no info for {url}")

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
            duration=safe_int(data.get("duration")),
            description=data.get("description", ""),
            upload_date=data.get("upload_date", ""),
            platform=extractor or "BiliBili",
            filesize=safe_int(data.get("filesize") or data.get("filesize_approx")),
            format=data.get("format", ""),
            subtitles=unique_subs,
        )

    def _download_ytdlp(self, url: str, output_path: str, *, use_cookies: bool) -> str | None:
        uid = uuid.uuid4().hex[:8]
        parent = Path(output_path).parent
        outtmpl = str(parent / f"%(id)s_{uid}.%(ext)s")

        opts = _ydl_opts(
            outtmpl=outtmpl,
            format="best[ext=mp4]/best",
            merge_output_format="mp4",
            no_playlist=True,
            no_overwrites=True,
        )
        if use_cookies and self.cookies_file:
            opts["cookiefile"] = self.cookies_file

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

        if not info:
            raise RuntimeError(f"yt-dlp produced no info for {url}")

        # Try canonical filename
        filename = yt_dlp.YoutubeDL(opts).prepare_filename(info)
        if os.path.exists(filename) and os.path.getsize(filename) > 0:
            return filename

        # Fallback: search by ID
        video_id = info.get("id", "")
        for candidate in parent.iterdir():
            if candidate.is_file() and video_id in candidate.name and candidate.suffix in (
                ".mp4", ".mkv", ".webm",
            ):
                return str(candidate)
        return None

    # ── Bilibili API fallback ───────────────────────────────────────────────

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
            duration=safe_int(info.get("duration")),
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


def _extract_bvid(url: str) -> str | None:
    match = _BVID_RE.search(url)
    return match.group(0) if match else None
