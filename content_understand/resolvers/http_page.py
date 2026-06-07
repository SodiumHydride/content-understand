"""HTTP page resolver — handles generic web pages (HTML, PDF, etc.)."""

from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Any
from urllib.parse import urlparse

import requests

from content_understand.resolvers._ssrf import validate_url_not_ssrf
from content_understand.resolvers.base import Resolver, ResolveResult

logger = logging.getLogger(__name__)

_VIDEO_HOST_FRAGMENTS = (
    "youtube.com",
    "youtu.be",
    "bilibili.com",
    "b23.tv",
    "vimeo.com",
    "tiktok.com",
    "douyin.com",
    "twitch.tv",
    "nicovideo.jp",
)


class HttpPageResolver(Resolver):
    """Download generic HTTP pages (HTML, PDF, etc.)."""

    priority = 40
    name = "http_page"

    def can_resolve(self, input: str) -> bool:
        if not input.startswith(("http://", "https://")):
            return False
        parsed = urlparse(input)
        host = (parsed.netloc or "").lower().lstrip("www.")
        path = (parsed.path or "").lower()
        if any(frag in host for frag in _VIDEO_HOST_FRAGMENTS):
            return False
        if "bilibili" in host and ("/video/" in path or "bv" in path):
            return False
        return True

    def resolve(self, input: str, ctx: dict[str, Any] | None = None) -> ResolveResult:
        ctx = ctx or {}
        timeout = ctx.get("timeout", 60)
        import tempfile as _tf

        cache_dir = ctx.get("cache_dir") or f"{_tf.gettempdir()}/content_understand_cache"

        os.makedirs(cache_dir, exist_ok=True)

        validate_url_not_ssrf(input)

        r = requests.get(
            input,
            timeout=timeout,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; content-understand/1.0)",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        r.raise_for_status()

        content_type = r.headers.get("content-type", "").split(";")[0].strip()

        ext_map = {
            "text/html": ".html",
            "application/pdf": ".pdf",
            "text/plain": ".txt",
            "application/json": ".json",
        }
        ext = ext_map.get(content_type, ".html")

        filename = f"page_{uuid.uuid4().hex[:12]}{ext}"
        local_path = os.path.join(cache_dir, filename)

        with open(local_path, "wb") as f:
            f.write(r.content)

        size = len(r.content)
        title = _extract_title(r.text) if content_type == "text/html" else ""

        return ResolveResult(
            local_path=local_path,
            original_url=input,
            media_url=input,
            content_type=content_type,
            metadata={
                "title": title or urlparse(input).path.split("/")[-1] or "page",
                "platform": urlparse(input).netloc or "unknown",
                "filesize": size,
            },
            source_type="direct",
        )


def _extract_title(html: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1).strip()[:200]
    return ""
