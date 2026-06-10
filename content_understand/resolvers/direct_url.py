"""Direct URL resolver — downloads files with known media extensions."""

from __future__ import annotations

import logging
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from content_understand.resolvers._ssrf import create_safe_session
from content_understand.resolvers.base import Resolver, ResolveResult

logger = logging.getLogger(__name__)

_MEDIA_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".tiff",
    ".svg",
    ".mp3",
    ".wav",
    ".flac",
    ".aac",
    ".ogg",
    ".aiff",
    ".m4a",
    ".wma",
    ".mp4",
    ".mkv",
    ".webm",
    ".avi",
    ".mov",
    ".flv",
}


class DirectURLResolver(Resolver):
    """Download files from direct media URLs."""

    priority = 10
    name = "direct_url"

    def can_resolve(self, input: str) -> bool:
        if not input.startswith(("http://", "https://")):
            return False
        path_lower = urlparse(input).path.lower()
        return any(path_lower.endswith(ext) for ext in _MEDIA_EXTENSIONS)

    def resolve(self, input: str, ctx: dict[str, Any] | None = None) -> ResolveResult:
        ctx = ctx or {}
        timeout = ctx.get("timeout", 120)
        import tempfile as _tf

        cache_dir = ctx.get("cache_dir") or f"{_tf.gettempdir()}/content_understand_cache"

        os.makedirs(cache_dir, exist_ok=True)

        session = create_safe_session()

        r = session.get(
            input,
            timeout=timeout,
            stream=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; content-understand/1.0)"},
        )
        r.raise_for_status()

        content_type = r.headers.get("content-type", "").split(";")[0].strip()
        ext = _guess_extension(content_type, input)
        if not content_type or content_type == "application/octet-stream":
            content_type = mimetypes.types_map.get(ext, "application/octet-stream")

        filename = f"{uuid.uuid4().hex}{ext}"
        local_path = os.path.join(cache_dir, filename)

        with open(local_path, "wb") as f:
            for chunk in session.safe_iter_content(r, chunk_size=8192):
                f.write(chunk)

        size = os.path.getsize(local_path)
        title = Path(urlparse(input).path).stem or "untitled"

        return ResolveResult(
            local_path=local_path,
            original_url=input,
            media_url=input,
            content_type=content_type,
            metadata={
                "title": title,
                "filesize": size,
                "platform": urlparse(input).netloc or "unknown",
            },
            source_type="direct",
        )


def _guess_extension(content_type: str, url: str) -> str:
    ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
    if ext:
        return ext
    url_ext = Path(urlparse(url).path).suffix.lower()
    if url_ext in _MEDIA_EXTENSIONS:
        return url_ext
    return ".bin"
