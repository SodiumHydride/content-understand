"""RAG retrieval with chunking, FTS5 BM25 scoring, and context window management."""

from __future__ import annotations

import logging
from typing import Any

from engine.index.db import fts_search, open_db
from engine.paths import vault_dir

logger = logging.getLogger(__name__)

# Maximum characters to include per note in the context
_MAX_NOTE_CHARS = 2000
# Maximum total context characters (rough estimate for token budget)
_MAX_CONTEXT_CHARS = 12000


def _chunk_text(text: str, max_chars: int = _MAX_NOTE_CHARS) -> str:
    """Truncate text to max_chars, preferring clean paragraph boundaries."""
    if len(text) <= max_chars:
        return text

    # Try to cut at a paragraph boundary
    truncated = text[:max_chars]
    last_paragraph = truncated.rfind("\n\n")
    if last_paragraph > max_chars * 0.5:
        return truncated[:last_paragraph] + "\n\n[...]"

    # Fall back to sentence boundary
    last_sentence = max(truncated.rfind(". "), truncated.rfind("。"))
    if last_sentence > max_chars * 0.3:
        return truncated[:last_sentence + 1] + " [...]"

    return truncated + " [...]"


def retrieve_context(query: str, limit: int = 5, max_context_chars: int = _MAX_CONTEXT_CHARS) -> dict[str, Any]:
    """Retrieve relevant notes using FTS5 with BM25 scoring.

    Returns a dict with 'context' (str) and 'sources' (list of dicts).
    Context is chunked to fit within the token budget.
    """
    vp = vault_dir()
    conn = open_db(vp)

    try:
        # Primary: FTS5 search with snippet
        results = fts_search(conn, query, limit=limit)

        # Fallback: if FTS MATCH returns nothing, try LIKE on titles
        if not results:
            safe_query = f"{query}%"
            rows = conn.execute(
                "SELECT slug, title, type, summary FROM pages "
                "WHERE title LIKE ? OR slug LIKE ? LIMIT ?",
                (safe_query, safe_query, limit),
            ).fetchall()
            results = [dict(r) for r in rows]

        if not results:
            return {"context": "", "sources": []}

        sources: list[dict[str, Any]] = []
        context_parts: list[str] = []
        total_chars = 0

        for r in results:
            slug = r["slug"]
            title = r["title"]

            # Fetch full content
            full_row = conn.execute(
                "SELECT body, summary, tags, type FROM pages WHERE slug=?",
                (slug,),
            ).fetchone()
            if not full_row:
                continue

            body, summary, tags_json, p_type = full_row
            content = body or summary or ""

            # Chunk the content to fit context window
            chunked = _chunk_text(content)

            # Check context budget
            note_text = (
                f"Note: {title}\n"
                f"Link: [[{title}]]\n"
                f"Content:\n{chunked}\n"
                f"---"
            )
            if total_chars + len(note_text) > max_context_chars and context_parts:
                break  # Budget exhausted

            sources.append({
                "slug": slug,
                "title": title,
                "type": p_type,
                "summary": summary,
            })
            context_parts.append(note_text)
            total_chars += len(note_text)

        context_text = "\n\n".join(context_parts)
        return {"context": context_text, "sources": sources}

    except Exception:
        logger.exception("RAG retrieval failed")
        return {"context": "", "sources": []}
