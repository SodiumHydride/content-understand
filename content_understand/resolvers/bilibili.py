"""Bilibili resolver — cookies + API fallback (not plain yt-dlp)."""

from __future__ import annotations

import logging
import mimetypes
import os
import uuid
from typing import Any

from content_understand.downloaders.bilibili import BilibiliDownloader
from content_understand.resolvers.base import Resolver, ResolveResult

logger = logging.getLogger(__name__)


class BilibiliResolver(Resolver):
    """Resolve Bilibili video URLs via the dedicated downloader."""

    priority = 35
    name = "bilibili"

    def can_resolve(self, input: str) -> bool:
        return BilibiliDownloader().can_handle(input)

    def resolve(self, input: str, ctx: dict[str, Any] | None = None) -> ResolveResult:
        ctx = ctx or {}
        import tempfile as _tf

        cache_dir = ctx.get("cache_dir") or f"{_tf.gettempdir()}/content_understand_cache"
        cookies_file = ctx.get("cookies_file")
        quality = ctx.get("quality", 80)

        os.makedirs(cache_dir, exist_ok=True)
        output_path = os.path.join(cache_dir, f"bili_{uuid.uuid4().hex[:10]}.mp4")

        downloader = BilibiliDownloader(
            cookies_file=cookies_file if cookies_file and os.path.isfile(cookies_file) else None,
            quality=quality,
        )
        info = downloader.get_info(input)
        local_path = downloader.download(input, output_path)

        ext = os.path.splitext(local_path)[1].lower() or ".mp4"
        content_type = mimetypes.types_map.get(ext, "video/mp4")
        size = os.path.getsize(local_path)

        return ResolveResult(
            local_path=local_path,
            original_url=input,
            media_url=info.url or input,
            content_type=content_type,
            metadata={
                "title": info.title,
                "author": info.author,
                "platform": info.platform or "BiliBili",
                "duration": info.duration,
                "filesize": size or info.filesize,
                "description": info.description,
                "upload_date": info.upload_date,
                "subtitles": info.subtitles,
            },
            source_type="platform",
        )
