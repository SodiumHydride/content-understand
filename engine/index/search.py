"""Advanced search with structured filters.

Supports:
    tag:技术              Filter by tag (joins tags table)
    type:video            Filter by content type
    created:2024-01       Filter by creation date (prefix match)
    has:link              Has outgoing wikilinks
    has:backlink          Has incoming backlinks
    orphan:true           No links at all
    "exact phrase"        Exact phrase match (FTS5 phrase)
    plain text            FTS5 full-text search

Filters are combined with AND.  Free text (if any) uses FTS5 MATCH.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from typing import Any

import jieba

# ── Query parser ──────────────────────────────────────────────────────

# Matches key:value tokens.  Key is one of the known filter names.
_FILTER_RE = re.compile(
    r'(tag|type|created|has|orphan):(\S+)',
    re.IGNORECASE,
)

# Matches double-quoted phrases.
_QUOTED_RE = re.compile(r'"([^"]+)"')


@dataclass
class SearchFilters:
    tags: list[str] = field(default_factory=list)
    types: list[str] = field(default_factory=list)
    created_prefix: str | None = None  # e.g. "2024-01"
    has_link: bool | None = None
    has_backlink: bool | None = None
    orphan: bool | None = None
    exact_phrases: list[str] = field(default_factory=list)
    free_text: str = ""


def parse_query(query: str) -> SearchFilters:
    """Parse a search query string into structured filters + free text."""
    filters = SearchFilters()

    remaining = query

    # 1. Extract quoted phrases first (they are opaque to filter parsing)
    phrases: list[str] = []
    for m in _QUOTED_RE.finditer(remaining):
        phrases.append(m.group(1))
    remaining = _QUOTED_RE.sub("", remaining)
    filters.exact_phrases = phrases

    # 2. Extract key:value filters
    for m in _FILTER_RE.finditer(remaining):
        key = m.group(1).lower()
        val = m.group(2).lower()

        if key == "tag":
            filters.tags.append(val)
        elif key == "type":
            filters.types.append(val)
        elif key == "created":
            filters.created_prefix = val
        elif key == "has":
            if val == "link":
                filters.has_link = True
            elif val == "backlink":
                filters.has_backlink = True
        elif key == "orphan":
            filters.orphan = val in ("true", "1", "yes")

    remaining = _FILTER_RE.sub("", remaining)

    # 3. Whatever remains is free text
    free = remaining.strip()
    if free:
        filters.free_text = free

    return filters


def filters_to_api_dict(filters: SearchFilters) -> dict[str, Any]:
    """Convert filters to a JSON-serialisable dict for the API response."""
    d: dict[str, Any] = {}
    if filters.tags:
        d["tags"] = filters.tags
    if filters.types:
        d["types"] = filters.types
    if filters.created_prefix:
        d["created_prefix"] = filters.created_prefix
    if filters.has_link is not None:
        d["has_link"] = filters.has_link
    if filters.has_backlink is not None:
        d["has_backlink"] = filters.has_backlink
    if filters.orphan is not None:
        d["orphan"] = filters.orphan
    if filters.exact_phrases:
        d["exact_phrases"] = filters.exact_phrases
    if filters.free_text:
        d["free_text"] = filters.free_text
    return d


# ── SQL builder ───────────────────────────────────────────────────────

def _build_fts_match(
    free_text: str,
    exact_phrases: list[str],
) -> tuple[str, list[str]]:
    """Build the FTS5 MATCH expression and its bind parameters.

    Returns (match_clause, params).  The clause is the content inside
    ``pages_fts MATCH ?`` — i.e. just the expression, no column filter.
    """
    parts: list[str] = []
    params: list[str] = []

    if free_text:
        # Tokenise with jieba for better CJK matching
        tokens = " ".join(jieba.cut(free_text))
        parts.append(tokens)
        params.append(tokens)

    for phrase in exact_phrases:
        parts.append('"' + phrase.replace('"', '""') + '"')
        params.append(phrase)

    if not parts:
        return "", []

    # FTS5 OR across free text + each phrase
    match_expr = " OR ".join(parts)
    return match_expr, params


def advanced_search(
    conn: sqlite3.Connection,
    query: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Execute an advanced search and return result rows.

    Each result dict contains: slug, title, type, summary, snippet, rank.
    """
    filters = parse_query(query)

    # Degenerate: nothing to search for
    if (
        not filters.free_text
        and not filters.exact_phrases
        and not filters.tags
        and not filters.types
        and filters.created_prefix is None
        and filters.has_link is None
        and filters.has_backlink is None
        and filters.orphan is None
    ):
        return []

    # ── Determine search strategy ────────────────────────────────────
    #
    # If there is free text / exact phrases we use FTS5 as the driver
    # and apply structural filters as post-filters via subqueries.
    #
    # If there is NO free text we drive from `pages` directly and
    # apply structural filters as WHERE clauses.

    has_fts = bool(filters.free_text or filters.exact_phrases)

    if has_fts:
        return _search_fts_driven(conn, filters, limit)
    else:
        return _search_structural_only(conn, filters, limit)


# ── FTS-driven search ────────────────────────────────────────────────

def _search_fts_driven(
    conn: sqlite3.Connection,
    filters: SearchFilters,
    limit: int,
) -> list[dict[str, Any]]:
    """FTS5 MATCH as driver, structural filters as JOIN / WHERE."""

    match_expr, match_params = _build_fts_match(
        filters.free_text, filters.exact_phrases
    )
    if not match_expr:
        return []

    # Build dynamic WHERE clauses applied to the joined `pages` row
    extra_where: list[str] = []
    extra_params: list[Any] = []

    if filters.types:
        placeholders = ",".join("?" for _ in filters.types)
        extra_where.append(f"p.type IN ({placeholders})")
        extra_params.extend(filters.types)

    if filters.created_prefix:
        extra_where.append("p.created LIKE ?")
        extra_params.append(filters.created_prefix + "%")

    # Tag filter: page must have ALL specified tags
    for tag in filters.tags:
        extra_where.append(
            "EXISTS (SELECT 1 FROM tags t WHERE t.slug = p.slug AND t.tag = ?)"
        )
        extra_params.append(tag)

    # Link-based filters
    if filters.has_link is True:
        extra_where.append(
            "EXISTS (SELECT 1 FROM links l WHERE l.source_slug = p.slug)"
        )
    if filters.has_backlink is True:
        extra_where.append(
            "EXISTS (SELECT 1 FROM links l WHERE l.target_slug = p.slug)"
        )
    if filters.orphan is True:
        extra_where.append(
            "NOT EXISTS (SELECT 1 FROM links l WHERE l.source_slug = p.slug OR l.target_slug = p.slug)"
        )

    where_clause = ""
    if extra_where:
        where_clause = "AND " + " AND ".join(extra_where)

    sql = f"""
        SELECT p.slug, p.title, p.type, p.summary,
               snippet(pages_fts, 2, '<mark>', '</mark>', '…', 32) as snippet,
               rank
        FROM pages_fts
        JOIN pages p ON p.rowid = pages_fts.rowid
        WHERE pages_fts MATCH ?
        {where_clause}
        ORDER BY rank
        LIMIT ?
    """
    params = match_params + extra_params + [limit]
    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# ── Structural-only search (no FTS) ──────────────────────────────────

def _search_structural_only(
    conn: sqlite3.Connection,
    filters: SearchFilters,
    limit: int,
) -> list[dict[str, Any]]:
    """No free text — drive purely from pages + structural filters."""

    where_parts: list[str] = ["1=1"]
    params: list[Any] = []

    if filters.types:
        placeholders = ",".join("?" for _ in filters.types)
        where_parts.append(f"p.type IN ({placeholders})")
        params.extend(filters.types)

    if filters.created_prefix:
        where_parts.append("p.created LIKE ?")
        params.append(filters.created_prefix + "%")

    for tag in filters.tags:
        where_parts.append(
            "EXISTS (SELECT 1 FROM tags t WHERE t.slug = p.slug AND t.tag = ?)"
        )
        params.append(tag)

    if filters.has_link is True:
        where_parts.append(
            "EXISTS (SELECT 1 FROM links l WHERE l.source_slug = p.slug)"
        )
    if filters.has_backlink is True:
        where_parts.append(
            "EXISTS (SELECT 1 FROM links l WHERE l.target_slug = p.slug)"
        )
    if filters.orphan is True:
        where_parts.append(
            "NOT EXISTS (SELECT 1 FROM links l WHERE l.source_slug = p.slug OR l.target_slug = p.slug)"
        )

    where_clause = " AND ".join(where_parts)

    sql = f"""
        SELECT p.slug, p.title, p.type, p.summary,
               substr(p.summary, 1, 200) as snippet,
               0 as rank
        FROM pages p
        WHERE {where_clause}
        ORDER BY p.updated DESC
        LIMIT ?
    """
    params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]
