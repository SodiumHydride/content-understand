"""HTML content extractor using trafilatura."""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ExtractedContent:
    """Result of content extraction."""

    title: str
    text: str
    author: str
    url: str
    date: str
    site_name: str
    language: str


def extract_html(
    input: str,
    url: str = "",
) -> ExtractedContent:
    """Extract main content from HTML.

    Args:
        input: HTML string, file path, or URL.
        url: Original URL (for metadata).

    Returns:
        ExtractedContent with title, text, author, etc.

    Raises:
        RuntimeError: If extraction fails.
        ImportError: If trafilatura is not installed.
    """
    try:
        import trafilatura
    except ImportError:
        raise RuntimeError(
            "trafilatura is required for HTML extraction. "
            "Install with: pip install content-understand-engine[html]"
        ) from None

    if input.startswith(("http://", "https://")):
        downloaded = trafilatura.fetch_url(input)
        if not downloaded:
            raise RuntimeError(f"Failed to fetch URL: {input[:100]}")
        html_content = downloaded
    elif input.endswith((".html", ".htm")) or input.startswith("<"):
        if input.startswith("<"):
            html_content = input
        else:
            with open(input, "r", encoding="utf-8", errors="replace") as f:
                html_content = f.read()
    else:
        try:
            with open(input, "r", encoding="utf-8", errors="replace") as f:
                html_content = f.read()
        except Exception:
            raise ValueError(f"Cannot read input as HTML: {input[:100]}")

    import json as _json

    result = trafilatura.extract(
        html_content,
        include_comments=False,
        include_tables=True,
        include_links=False,
        output_format="json",
        with_metadata=True,
    )

    if not result:
        raise RuntimeError("trafilatura could not extract content from HTML")

    title = ""
    text = ""
    author = ""
    date = ""
    sitename = ""
    language = ""

    try:
        meta = _json.loads(result) if isinstance(result, str) else result
        text = meta.get("text", "")
        title = meta.get("title", "")
        author = meta.get("author", "")
        date = meta.get("date", "")
        sitename = meta.get("sitename", "")
        language = meta.get("language", "")
    except (_json.JSONDecodeError, TypeError):
        # If JSON parsing fails, treat result as plain text
        text = str(result)

    if not text:
        raise RuntimeError("trafilatura could not extract content from HTML")

    if not title:
        lines = text.strip().split("\n")
        title = lines[0][:100] if lines else "Untitled"

    return ExtractedContent(
        title=title,
        text=text,
        author=author,
        url=url,
        date=date,
        site_name=sitename,
        language=language,
    )
