"""yt-dlp resolver — universal platform support for 1000+ sites."""

from __future__ import annotations

import logging
import mimetypes
import os
import uuid
from typing import Any

from content_understand.resolvers._ssrf import validate_url_not_ssrf
from content_understand.resolvers.base import Resolver, ResolveResult

logger = logging.getLogger(__name__)


class YtdlpResolver(Resolver):
    """Resolve URLs from 1000+ platforms using yt-dlp.

    Requires yt-dlp: pip install yt-dlp
    """

    priority = 50
    name = "ytdlp"

    def can_resolve(self, input: str) -> bool:
        if not input.startswith(("http://", "https://")):
            return False
        skip = ["asmr.one", "asmr-200.com"]
        return not any(s in input for s in skip)

    def resolve(self, input: str, ctx: dict[str, Any] | None = None) -> ResolveResult:
        validate_url_not_ssrf(input)
        try:
            import yt_dlp
        except ImportError:
            raise RuntimeError(
                "yt-dlp is required for URL resolution. "
                "Install with: pip install content-understand-engine[fetch]"
            ) from None

        ctx = ctx or {}
        import tempfile as _tf

        cache_dir = ctx.get("cache_dir") or f"{_tf.gettempdir()}/content_understand_cache"
        cookies_file = ctx.get("cookies_file")
        quality = ctx.get("quality", 360)

        os.makedirs(cache_dir, exist_ok=True)
        output_template = os.path.join(
            cache_dir, f"%(id)s_{uuid.uuid4().hex[:8]}.%(ext)s"
        )

        on_progress = (ctx or {}).get("on_progress")

        def _progress_hook(d: dict) -> None:
            if d.get("status") == "downloading" and on_progress:
                pct_str = d.get("_percent_str", "0%").replace("%", "").strip()
                try:
                    pct = int(float(pct_str))
                except (ValueError, TypeError):
                    pct = 0
                on_progress("download", 5 + int(pct * 0.25), f"Downloading: {d.get('_percent_str', '')}")

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "outtmpl": output_template,
            "format": f"bv*[height<={quality}]+ba/b[height<={quality}]/b",
            "merge_output_format": "mp4",
            "socket_timeout": 30,
            "progress_hooks": [_progress_hook],
        }

        if cookies_file and os.path.isfile(cookies_file):
            ydl_opts["cookiefile"] = cookies_file

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(input, download=True)

        if not info:
            raise RuntimeError(f"yt-dlp could not extract info from {input[:100]}")

        local_path = ydl.prepare_filename(info)
        if not os.path.isfile(local_path):
            base, _ = os.path.splitext(local_path)
            for ext in [".mp4", ".mkv", ".webm", ".mp3", ".m4a"]:
                candidate = base + ext
                if os.path.isfile(candidate):
                    local_path = candidate
                    break

        if not os.path.isfile(local_path):
            raise RuntimeError(f"Downloaded file not found: {local_path}")

        ext = os.path.splitext(local_path)[1].lower()
        content_type = mimetypes.types_map.get(ext, "application/octet-stream")

        if info.get("acodec") and not info.get("vcodec"):
            content_type = content_type if content_type.startswith("audio/") else "audio/mpeg"

        size = os.path.getsize(local_path)

        return ResolveResult(
            local_path=local_path,
            original_url=input,
            media_url=info.get("url", input),
            content_type=content_type,
            metadata={
                "title": info.get("title", ""),
                "author": info.get("uploader", "") or info.get("creator", ""),
                "platform": info.get("extractor_key", "") or info.get("extractor", ""),
                "duration": info.get("duration", 0),
                "filesize": size,
                "description": info.get("description", ""),
                "upload_date": info.get("upload_date", ""),
                "thumbnail_url": info.get("thumbnail", ""),
                "view_count": info.get("view_count", 0),
                "tags": info.get("tags", []),
            },
            source_type="platform",
        )
