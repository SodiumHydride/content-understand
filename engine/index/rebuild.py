"""Rebuild SQLite index by scanning vault Markdown files."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from engine.index.db import open_db, upsert_page, get_page_mtime, list_all_slugs


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
