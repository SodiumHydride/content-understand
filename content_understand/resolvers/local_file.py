"""Local file resolver — handles file paths and file:// URLs.

Cross-platform: correctly handles Windows drive-letter paths in file:// URLs
(e.g., file:///C:/Users/foo/video.mp4) using urllib.parse.urlparse.
"""

from __future__ import annotations

import logging
import mimetypes
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import url2pathname

from content_understand.resolvers.base import Resolver, ResolveResult

logger = logging.getLogger(__name__)

_EXTRA_MIMES = {
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".opus": "audio/opus",
    ".m4b": "audio/mp4",
}


def _file_url_to_path(url: str) -> str:
    """Convert a file:// URL to a local filesystem path.

    Correctly handles:
    - Unix: file:///path/to/file -> /path/to/file
    - Windows: file:///C:/Users/foo -> C:\\Users\\foo
    """
    parsed = urlparse(url)
    # url2pathname handles platform-specific path conversion
    path = url2pathname(parsed.path)
    path = os.path.normpath(path)
    # Reject path traversal attempts
    parts = path.replace("\\", "/").split("/")
    if ".." in parts:
        raise ValueError(f"Path traversal detected in file URL: {url}")
    return path


class LocalFileResolver(Resolver):
    """Resolve local file paths to ResolveResult."""

    priority = 0
    name = "local_file"

    def can_resolve(self, input: str) -> bool:
        if input.startswith("file://"):
            path = _file_url_to_path(input)
            return os.path.isfile(path)
        return os.path.isfile(input)

    def resolve(self, input: str, ctx: dict[str, Any] | None = None) -> ResolveResult:
        if input.startswith("file://"):
            path = _file_url_to_path(input)
        else:
            path = input
            parts = os.path.normpath(path).replace("\\", "/").split("/")
            if ".." in parts:
                raise ValueError(f"Path traversal detected: {input}")
        path = os.path.abspath(path)

        if not os.path.isfile(path):
            raise FileNotFoundError(f"File not found: {path}")

        mime, _ = mimetypes.guess_type(path)
        if not mime:
            ext = Path(path).suffix.lower()
            mime = _EXTRA_MIMES.get(ext)

        content_type = mime or "application/octet-stream"
        stat = os.stat(path)

        return ResolveResult(
            local_path=path,
            original_url=path,
            media_url=path,
            content_type=content_type,
            metadata={"title": Path(path).stem, "filesize": stat.st_size},
            source_type="local",
        )
