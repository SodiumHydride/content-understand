"""Light SQLite index — cache only; Markdown vault is source of truth.

Uses WAL mode for concurrent read/write safety and a module-level
connection pool so multiple threads don't create competing connections.
"""

from __future__ import annotations

import sqlite3
import threading
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
    body_hash TEXT NOT NULL DEFAULT '',
    file_mtime REAL NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_url ON pages(url) WHERE url != '';

CREATE TABLE IF NOT EXISTS links (
    source_slug TEXT NOT NULL,
    target_slug TEXT NOT NULL,
    context TEXT,
    PRIMARY KEY (source_slug, target_slug),
    FOREIGN KEY (source_slug) REFERENCES pages(slug) ON DELETE CASCADE,
    FOREIGN KEY (target_slug) REFERENCES pages(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_slug);

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

# Module-level connection pool: one connection per vault path.
# Thread-safe via threading.Lock.
_pool_lock = threading.Lock()
_connections: dict[str, sqlite3.Connection] = {}


def open_db(vault_path: Path) -> sqlite3.Connection:
    """Get or create a SQLite connection for the given vault path.

    Uses WAL mode for concurrent read/write safety.
    Connections are pooled — repeated calls for the same vault_path
    return the same connection object.
    """
    db_path = str(vault_path / ".content-app" / "index.db")

    with _pool_lock:
        conn = _connections.get(db_path)
        if conn is not None:
            try:
                # Test if connection is still alive
                conn.execute("SELECT 1")
                return conn
            except sqlite3.ProgrammingError:
                # Connection was closed, remove from pool
                _connections.pop(db_path, None)

        (vault_path / ".content-app").mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(
            db_path,
            timeout=30,  # Wait up to 30s for locks
            check_same_thread=False,  # Allow cross-thread use
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")  # Concurrent reads + single write
        conn.execute("PRAGMA busy_timeout=10000")  # 10s retry on lock
        conn.executescript(SCHEMA)
        _connections[db_path] = conn
        return conn


def get_page_mtime(conn: sqlite3.Connection, slug: str) -> float | None:
    """Return the stored file_mtime for a slug, or None if not found."""
    row = conn.execute("SELECT file_mtime FROM pages WHERE slug=?", (slug,)).fetchone()
    return row[0] if row else None


def upsert_page(conn: sqlite3.Connection, row: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO pages (slug, path, title, type, platform, url, summary, tags, created, updated, body_hash, file_mtime)
        VALUES (:slug, :path, :title, :type, :platform, :url, :summary, :tags, :created, :updated, :body_hash, :file_mtime)
        ON CONFLICT(slug) DO UPDATE SET
            path=excluded.path, title=excluded.title, type=excluded.type,
            platform=excluded.platform, url=excluded.url, summary=excluded.summary,
            tags=excluded.tags, updated=excluded.updated, body_hash=excluded.body_hash,
            file_mtime=excluded.file_mtime
        """,
        row,
    )
    conn.commit()


def list_all_slugs(conn: sqlite3.Connection) -> set[str]:
    """Return all slug values currently in the index."""
    rows = conn.execute("SELECT slug FROM pages").fetchall()
    return {row[0] for row in rows}


def upsert_link(conn: sqlite3.Connection, source_slug: str, target_slug: str, context: str | None = None) -> None:
    """Insert or replace a wikilink edge."""
    conn.execute(
        "INSERT OR REPLACE INTO links (source_slug, target_slug, context) VALUES (?, ?, ?)",
        (source_slug, target_slug, context),
    )
    conn.commit()


def delete_links_for_source(conn: sqlite3.Connection, source_slug: str) -> None:
    """Delete all outgoing links from a source page."""
    conn.execute("DELETE FROM links WHERE source_slug=?", (source_slug,))
    conn.commit()


def get_backlinks(conn: sqlite3.Connection, target_slug: str) -> list[dict[str, Any]]:
    """Return all incoming links to target_slug, joined with source page title."""
    rows = conn.execute(
        """
        SELECT l.source_slug, p.title AS source_title, l.context
        FROM links l
        JOIN pages p ON p.slug = l.source_slug
        WHERE l.target_slug = ?
        ORDER BY p.title
        """,
        (target_slug,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_all_links(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return all link edges for graph building."""
    rows = conn.execute(
        "SELECT source_slug, target_slug, context FROM links"
    ).fetchall()
    return [dict(r) for r in rows]


def list_titles(conn: sqlite3.Connection, limit: int = 500) -> list[str]:
    """Return all page titles, most-recent first. Used for wikilink suggestions."""
    rows = conn.execute(
        "SELECT title FROM pages WHERE title != '' ORDER BY updated DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [row[0] for row in rows]


def list_pages(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM pages ORDER BY updated DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]
