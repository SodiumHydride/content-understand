"""Shared MIME type utilities."""

from __future__ import annotations

from pathlib import Path

_MIME_MAP = {
    # Images
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    # Audio
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".aiff": "audio/aiff",
    ".m4a": "audio/mp4",
    ".opus": "audio/opus",
    ".wma": "audio/x-ms-wma",
}


def guess_mime(path: str, default: str = "application/octet-stream") -> str:
    """Guess MIME type from file extension.

    More comprehensive than mimetypes.guess_type for media files.
    """
    ext = Path(path).suffix.lower()
    return _MIME_MAP.get(ext, default)
