"""Smart note recommendations using FTS5 BM25 scoring.

Computes similarity entirely inside SQLite's C engine via bm25(),
then applies lightweight post-processing boosts (shared tags,
title mentions) in Python.  Zero full-text loading into memory.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from typing import Any

from engine.index.db import sanitize_fts5

logger = logging.getLogger(__name__)

# Weight constants for the composite score
_BM25_WEIGHT = 1.0
_TAG_BOOST = 0.15   # per shared tag
_TITLE_MENTION_BOOST = 0.35


def get_recommendations(conn: sqlite3.Connection, slug: str, limit: int = 5) -> list[dict[str, Any]]:
    """Calculate note recommendations based on FTS5 BM25 similarity.

    Returns up to *limit* dicts with keys: slug, title, score, reason.
    Excludes pages that are already linked to *slug* in either direction.
    """
    # 1. Fetch the target page
    target = conn.execute(
        "SELECT slug, title, body, tags FROM pages WHERE slug = ?", (slug,)
    ).fetchone()
    if not target:
        return []

    target_slug, target_title, target_body, target_tags_json = target
    try:
        target_tags: set[str] = set(json.loads(target_tags_json))
    except Exception:
        target_tags = set()

    # 2. Build BM25 query from the target title
    if not target_title.strip():
        return []

    safe_query = sanitize_fts5(target_title)

    # 3. Retrieve BM25-scored candidates from FTS5
    #    bm25() returns negative values — lower (more negative) = better match.
    #    Column weights: title (col 0) weighted 5x, summary (col 1) 1x, body (col 2) 1x.
    try:
        rows = conn.execute(
            """
            SELECT p.slug, p.title, p.tags,
                   bm25(pages_fts, 5.0, 1.0, 1.0, 1.0) AS bm25_score
            FROM pages_fts
            JOIN pages p ON p.rowid = pages_fts.rowid
            WHERE pages_fts MATCH ?
              AND p.slug != ?
            ORDER BY bm25_score
            LIMIT ?
            """,
            (safe_query, slug, limit * 4),
        ).fetchall()
    except Exception:
        logger.debug("FTS5 BM25 query failed for slug=%s", slug, exc_info=True)
        return []

    if not rows:
        return []

    # 4. Build set of already-linked slugs (to exclude)
    linked: set[str] = set()
    link_rows = conn.execute(
        "SELECT target_slug FROM links WHERE source_slug = ?"
        " UNION "
        "SELECT source_slug FROM links WHERE target_slug = ?",
        (slug, slug),
    ).fetchall()
    for r in link_rows:
        linked.add(r[0])

    # 5. Post-process: apply tag boost and title-mention boost
    recommendations: list[dict[str, Any]] = []
    target_body_lower = target_body.lower()
    target_title_lower = target_title.lower()

    for row in rows:
        p_slug = row[0]
        p_title = row[1]
        p_tags_json = row[2]
        bm25_raw = row[3]

        if p_slug in linked:
            continue

        # Normalize BM25 score to a positive similarity value
        score = abs(bm25_raw) * _BM25_WEIGHT

        # Tag boost
        try:
            p_tags: set[str] = set(json.loads(p_tags_json))
        except Exception:
            p_tags = set()
        shared = target_tags & p_tags
        score += _TAG_BOOST * len(shared)

        # Title-mention boost
        reason = "similarity"
        if len(p_title) > 1:
            if p_title.lower() in target_body_lower:
                score += _TITLE_MENTION_BOOST
                reason = "mention"
            if target_title_lower in p_title.lower():
                score += _TITLE_MENTION_BOOST

        if shared:
            reason = "tag"

        recommendations.append({
            "slug": p_slug,
            "title": p_title,
            "score": round(score, 4),
            "reason": reason,
        })

    recommendations.sort(key=lambda x: x["score"], reverse=True)
    return recommendations[:limit]
