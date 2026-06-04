"""Rebuild SQLite index by scanning vault Markdown files."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from engine.index.db import open_db, upsert_page


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


def rebuild_from_vault(vault_path: Path) -> int:
    conn = open_db(vault_path)
    count = 0
    for md in vault_path.rglob("*.md"):
        if ".content-app" in md.parts:
            continue
        rel = md.relative_to(vault_path)
        slug = str(rel.with_suffix("")).replace("\\", "/")
        text = md.read_text(encoding="utf-8")
        meta, body = _parse_frontmatter(text)
        body_hash = hashlib.sha256(body.encode()).hexdigest()[:16]
        tags = meta.get("tags", "[]")
        if isinstance(tags, str) and not tags.startswith("["):
            tags = json.dumps([tags], ensure_ascii=False)
        upsert_page(
            conn,
            {
                "slug": slug,
                "path": str(rel).replace("\\", "/"),
                "title": meta.get("title", md.stem),
                "type": meta.get("type", "article"),
                "platform": meta.get("platform", ""),
                "url": (meta.get("sources") or meta.get("url") or "")[:500],
                "summary": meta.get("summary", "")[:500],
                "tags": tags if isinstance(tags, str) else json.dumps(tags, ensure_ascii=False),
                "created": meta.get("created", ""),
                "updated": meta.get("updated", datetime.now(timezone.utc).isoformat()),
                "body_hash": body_hash,
            },
        )
        count += 1
    conn.close()
    return count
