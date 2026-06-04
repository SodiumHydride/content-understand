"""Light SQLite index — cache only; Markdown vault is source of truth."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


SCHEMA = """
CREATE TABLE IF NOT EXISTS pages (
    slug TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    created TEXT NOT NULL DEFAULT '',
    updated TEXT NOT NULL DEFAULT '',
    body_hash TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_url ON pages(url) WHERE url != '';

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    progress_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    result_slug TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);
"""


def open_db(vault_path: Path) -> sqlite3.Connection:
    meta = vault_path / ".content-app"
    meta.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(meta / "index.db")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_page(conn: sqlite3.Connection, row: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO pages (slug, path, title, type, platform, url, summary, tags, created, updated, body_hash)
        VALUES (:slug, :path, :title, :type, :platform, :url, :summary, :tags, :created, :updated, :body_hash)
        ON CONFLICT(slug) DO UPDATE SET
            path=excluded.path, title=excluded.title, type=excluded.type,
            platform=excluded.platform, url=excluded.url, summary=excluded.summary,
            tags=excluded.tags, updated=excluded.updated, body_hash=excluded.body_hash
        """,
        row,
    )
    conn.commit()


def list_pages(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM pages ORDER BY updated DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]
