"""PDF content extractor using PyMuPDF."""

from __future__ import annotations

import logging

from content_understand.extractors.html import ExtractedContent

logger = logging.getLogger(__name__)


def extract_pdf(
    input: str,
    url: str = "",
) -> ExtractedContent:
    """Extract text content from PDF.

    Args:
        input: Path to PDF file.
        url: Original URL (for metadata).

    Returns:
        ExtractedContent with title, text, etc.

    Raises:
        RuntimeError: If extraction fails.
        ImportError: If pymupdf is not installed.
    """
    try:
        import pymupdf
    except ImportError:
        raise RuntimeError(
            "pymupdf is required for PDF extraction. "
            "Install with: pip install content-understand-engine[pdf]"
        ) from None

    doc = pymupdf.open(input)
    if doc.page_count == 0:
        doc.close()
        raise RuntimeError(f"PDF has no pages: {input}")

    meta = doc.metadata or {}
    title = meta.get("title", "") or ""
    author = meta.get("author", "") or ""

    texts = []
    for page in doc:
        text = page.get_text()
        if text.strip():
            texts.append(text.strip())

    doc.close()

    full_text = "\n\n".join(texts)
    if not full_text.strip():
        raise RuntimeError(f"PDF contains no extractable text: {input}")

    if not title:
        title = full_text.split("\n")[0][:100] if full_text else "Untitled"

    return ExtractedContent(
        title=title,
        text=full_text,
        author=author,
        url=url,
        date=meta.get("creationDate", ""),
        site_name="",
        language="",
    )
