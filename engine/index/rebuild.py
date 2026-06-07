"""Rebuild SQLite index by scanning vault Markdown files."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from engine.index.db import (
    delete_links_for_source,
    get_page_mtime,
    list_all_slugs,
    open_db,
    upsert_link,
    upsert_page,
)

_WIKILINK_RE = re.compile(r'\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]')


def extract_wikilinks(body: str) -> list[str]:
    """Extract [[wikilink]] targets from markdown body."""
    return [m.group(1).strip() for m in _WIKILINK_RE.finditer(body)]


def _resolve_wikilink_targets(
    conn, wikilinks: list[str]
) -> list[tuple[str, str]]:
    """Resolve wikilink display names to (raw_link, target_slug) pairs.

    Matches each link against page title or slug. Returns only those
    that resolve to an existing page.
    """
    if not wikilinks:
        return []

    all_pages = conn.execute("SELECT slug, title FROM pages").fetchall()
    title_map: dict[str, str] = {}
    slug_set: set[str] = set()
    for row in all_pages:
        slug_set.add(row[0])
        if row[1]:
            title_map[row[1].lower()] = row[0]

    resolved = []
    for link in wikilinks:
        slug = title_map.get(link.lower())
        if slug is None and link in slug_set:
            slug = link
        if slug is not None:
            resolved.append((link, slug))
    return resolved


def _wikilink_context(body: str, match_start: int, match_end: int, width: int = 80) -> str:
    """Extract ~width chars of surrounding context around a wikilink match."""
    start = max(0, match_start - width // 2)
    end = min(len(body), match_end + width // 2)
    ctx = body[start:end].replace("\n", " ").strip()
    if start > 0:
        ctx = "..." + ctx
    if end < len(body):
        ctx = ctx + "..."
    return ctx


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    meta: dict = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, parts[2]


def upsert_single_file(vault_path: Path, md_path: Path) -> bool:
    """Index a single .md file incrementally.

    Returns True if the file was actually upserted, False if skipped (unchanged).
    """
    conn = open_db(vault_path)
    rel = md_path.relative_to(vault_path)
    slug = str(rel.with_suffix("")).replace("\\", "/")

    # Fast path: mtime unchanged → skip
    disk_mtime = os.path.getmtime(md_path)
    db_mtime = get_page_mtime(conn, slug)
    if db_mtime is not None and abs(db_mtime - disk_mtime) < 1.0:
        return False

    # mtime changed — read file and hash body
    text = md_path.read_text(encoding="utf-8")
    meta, body = _parse_frontmatter(text)
    body_hash = hashlib.sha256(body.encode()).hexdigest()[:16]

    # Hash unchanged → just update mtime and skip content update
    if db_mtime is not None:
        existing = conn.execute(
            "SELECT body_hash FROM pages WHERE slug=?", (slug,)
        ).fetchone()
        if existing and existing[0] == body_hash:
            conn.execute(
                "UPDATE pages SET file_mtime=? WHERE slug=?", (disk_mtime, slug)
            )
            conn.commit()
            return False

    # Content changed — full upsert
    tags = meta.get("tags", "[]")
    if isinstance(tags, str) and not tags.startswith("["):
        tags = json.dumps([tags], ensure_ascii=False)
    upsert_page(
        conn,
        {
            "slug": slug,
            "path": str(rel).replace("\\", "/"),
            "title": meta.get("title", md_path.stem),
            "type": meta.get("type", "article"),
            "platform": meta.get("platform", ""),
            "url": (meta.get("sources") or meta.get("url") or "")[:500],
            "summary": meta.get("summary", "")[:500],
            "tags": tags if isinstance(tags, str) else json.dumps(tags, ensure_ascii=False),
            "created": meta.get("created", ""),
            "updated": meta.get("updated", datetime.now(timezone.utc).isoformat()),
            "body_hash": body_hash,
            "file_mtime": disk_mtime,
        },
    )

    # Extract and store wikilinks from the body
    wikilinks = extract_wikilinks(body)
    delete_links_for_source(conn, slug)
    if wikilinks:
        resolved = _resolve_wikilink_targets(conn, wikilinks)
        for match in _WIKILINK_RE.finditer(body):
            raw = match.group(1).strip()
            target_slug = next((s for r, s in resolved if r == raw), None)
            if target_slug is not None:
                ctx = _wikilink_context(body, match.start(), match.end())
                upsert_link(conn, slug, target_slug, ctx)

    return True


def rebuild_from_vault(vault_path: Path) -> int:
    """Incremental rebuild: only re-index files whose mtime has changed.

    Also cleans up orphaned records for files that no longer exist on disk.
    Returns the number of files actually upserted.
    """
    conn = open_db(vault_path)

    # Collect slugs present on disk
    disk_slugs: set[str] = set()
    count = 0
    for md in vault_path.rglob("*.md"):
        if ".content-app" in md.parts:
            continue
        rel = md.relative_to(vault_path)
        slug = str(rel.with_suffix("")).replace("\\", "/")
        disk_slugs.add(slug)
        if upsert_single_file(vault_path, md):
            count += 1

    # Clean up orphaned records
    db_slugs = list_all_slugs(conn)
    orphans = db_slugs - disk_slugs
    if orphans:
        conn.executemany(
            "DELETE FROM pages WHERE slug=?",
            [(s,) for s in orphans],
        )
        conn.commit()

    # Don't close — connection is pooled in db._connections
    return count
