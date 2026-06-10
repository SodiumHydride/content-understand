"""Search engine resolver — extracts real media URLs from search result pages."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from content_understand.resolvers._ssrf import validate_url_not_ssrf
from content_understand.resolvers.base import Resolver, ResolveResult

logger = logging.getLogger(__name__)

_SEARCH_PATTERNS = [
    "yandex.com/images",
    "images.google",
    "google.com/search",
    "bing.com/images",
    "baidu.com/search",
]

_MEDIA_PARAMS = ["img_url", "imgurl", "url", "mediaurl", "source", "media"]


class SearchEngineResolver(Resolver):
    """Extract real media URLs from search engine result pages."""

    priority = 20
    name = "search_engine"

    def can_resolve(self, input: str) -> bool:
        if not input.startswith(("http://", "https://")):
            return False
        return any(pattern in input for pattern in _SEARCH_PATTERNS)

    def resolve(self, input: str, ctx: dict[str, Any] | None = None) -> ResolveResult:
        real_url = self._extract_media_url(input)

        if real_url != input:
            validate_url_not_ssrf(real_url)

        if real_url == input:
            raise RuntimeError(f"Could not extract media URL from search page: {input[:100]}")

        from content_understand.resolvers.direct_url import DirectURLResolver

        direct = DirectURLResolver()
        if direct.can_resolve(real_url):
            return direct.resolve(real_url, ctx)

        raise RuntimeError(f"Extracted URL is not a direct media link: {real_url[:100]}")

    def _extract_media_url(self, url: str) -> str:
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)

        for param in _MEDIA_PARAMS:
            if param in qs:
                candidate = unquote(qs[param][0])
                if candidate.startswith(("http://", "https://")):
                    return candidate

        return url
