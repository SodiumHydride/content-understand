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
    body TEXT NOT NULL DEFAULT '',
    created TEXT NOT NULL DEFAULT '',
    updated TEXT NOT NULL DEFAULT '',
    body_hash TEXT NOT NULL DEFAULT '',
    file_mtime REAL NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_url ON pages(url) WHERE url != '';

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
    title, summary, body, tags,
    content=pages, content_rowid=rowid
);

CREATE TABLE IF NOT EXISTS links (
    source_slug TEXT NOT NULL,
    target_slug TEXT NOT NULL,
    context TEXT,
    link_type TEXT DEFAULT 'wikilink',
    created_at REAL DEFAULT (julianday('now')),
    PRIMARY KEY (source_slug, target_slug),
    FOREIGN KEY (source_slug) REFERENCES pages(slug) ON DELETE CASCADE,
    FOREIGN KEY (target_slug) REFERENCES pages(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_slug);

CREATE TABLE IF NOT EXISTS tags (
    slug TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (slug, tag),
    FOREIGN KEY (slug) REFERENCES pages(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

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
        conn.execute("PRAGMA foreign_keys=ON")  # Enable foreign keys
        conn.executescript(SCHEMA)
        _migrate(conn)
        _connections[db_path] = conn
        return conn


def close_db() -> None:
    """Close all pooled database connections. Safe to call multiple times.

    Attempts a WAL checkpoint on each connection before closing so the
    WAL file is merged back into the main database and cleaned up.
    """
    with _pool_lock:
        for db_path, conn in list(_connections.items()):
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass
        _connections.clear()


def _migrate(conn: sqlite3.Connection) -> None:
    """Apply incremental migrations for existing databases."""
    try:
        conn.execute("SELECT body FROM pages LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE pages ADD COLUMN body TEXT NOT NULL DEFAULT ''")
    
    # Migrate links table for link_type and created_at
    try:
        conn.execute("SELECT link_type FROM links LIMIT 1")
    except sqlite3.OperationalError:
        try:
            conn.execute("ALTER TABLE links ADD COLUMN link_type TEXT DEFAULT 'wikilink'")
            conn.execute("ALTER TABLE links ADD COLUMN created_at REAL DEFAULT (julianday('now'))")
        except sqlite3.OperationalError:
            pass
    conn.commit()


def fts_rebuild(conn: sqlite3.Connection) -> None:
    """Rebuild the FTS index from the pages table."""
    conn.execute("INSERT INTO pages_fts(pages_fts) VALUES('rebuild')")


def fts_search(conn: sqlite3.Connection, query: str, limit: int = 20) -> list[dict[str, Any]]:
    """Full-text search with snippet highlights."""
    safe_query = query.replace('"', '""')
    rows = conn.execute(
        """
        SELECT p.slug, p.title, p.type, p.summary,
                snippet(pages_fts, 2, '<mark>', '</mark>', '…', 32) as snippet,
                rank
        FROM pages_fts
        JOIN pages p ON p.rowid = pages_fts.rowid
        WHERE pages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
        """,
        (safe_query, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def get_page_mtime(conn: sqlite3.Connection, slug: str) -> float | None:
    """Return the stored file_mtime for a slug, or None if not found."""
    row = conn.execute("SELECT file_mtime FROM pages WHERE slug=?", (slug,)).fetchone()
    return row[0] if row else None


def upsert_page(conn: sqlite3.Connection, row: dict[str, Any]) -> None:
    row.setdefault("body", "")
    conn.execute(
        """
        INSERT INTO pages (slug, path, title, type, platform, url, summary, tags, body, created, updated, body_hash, file_mtime)
        VALUES (:slug, :path, :title, :type, :platform, :url, :summary, :tags, :body, :created, :updated, :body_hash, :file_mtime)
        ON CONFLICT(slug) DO UPDATE SET
            path=excluded.path, title=excluded.title, type=excluded.type,
            platform=excluded.platform, url=excluded.url, summary=excluded.summary,
            tags=excluded.tags, body=excluded.body, updated=excluded.updated,
            body_hash=excluded.body_hash, file_mtime=excluded.file_mtime
        """,
        row,
    )
    conn.commit()


def list_all_slugs(conn: sqlite3.Connection) -> set[str]:
    """Return all slug values currently in the index."""
    rows = conn.execute("SELECT slug FROM pages").fetchall()
    return {row[0] for row in rows}


def upsert_link(
    conn: sqlite3.Connection,
    source_slug: str,
    target_slug: str,
    context: str | None = None,
    link_type: str = "wikilink",
) -> None:
    """Insert or replace a wikilink edge."""
    conn.execute(
        """
        INSERT INTO links (source_slug, target_slug, context, link_type)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source_slug, target_slug) DO UPDATE SET
            context=excluded.context,
            link_type=excluded.link_type
        """,
        (source_slug, target_slug, context, link_type),
    )
    conn.commit()


def delete_tags_for_page(conn: sqlite3.Connection, slug: str) -> None:
    """Delete all tags for a page."""
    conn.execute("DELETE FROM tags WHERE slug=?", (slug,))
    conn.commit()


def upsert_tags_for_page(conn: sqlite3.Connection, slug: str, tags: list[str]) -> None:
    """Replace all tags for a page."""
    delete_tags_for_page(conn, slug)
    if tags:
        conn.executemany(
            "INSERT OR REPLACE INTO tags (slug, tag) VALUES (?, ?)",
            [(slug, t) for t in tags],
        )
        conn.commit()


def get_tags_for_page(conn: sqlite3.Connection, slug: str) -> list[str]:
    """Get all tags for a page."""
    rows = conn.execute("SELECT tag FROM tags WHERE slug=?", (slug,)).fetchall()
    return [row[0] for row in rows]


def get_pages_with_tag(conn: sqlite3.Connection, tag: str) -> list[str]:
    """Get all pages that have a specific tag."""
    rows = conn.execute("SELECT slug FROM tags WHERE tag=?", (tag,)).fetchall()
    return [row[0] for row in rows]


def list_all_tags(conn: sqlite3.Connection) -> list[str]:
    """List all unique tags in the system."""
    rows = conn.execute("SELECT DISTINCT tag FROM tags ORDER BY tag").fetchall()
    return [row[0] for row in rows]


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
    rows = conn.execute("SELECT source_slug, target_slug, context FROM links").fetchall()
    return [dict(r) for r in rows]


def list_titles(conn: sqlite3.Connection, limit: int = 500) -> list[str]:
    """Return all page titles, most-recent first. Used for wikilink suggestions."""
    rows = conn.execute(
        "SELECT title FROM pages WHERE title != '' ORDER BY updated DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [row[0] for row in rows]


def list_pages(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM pages ORDER BY updated DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]
