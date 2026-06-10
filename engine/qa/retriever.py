import json
import logging
from typing import Any, Dict, List
from engine.index.db import fts_search, open_db
from engine.paths import vault_dir

logger = logging.getLogger(__name__)

def retrieve_context(query: str, limit: int = 5) -> Dict[str, Any]:
    """Retrieve relevant notes using SQLite FTS5 index search and build the RAG context block."""
    vp = vault_dir()
    conn = open_db(vp)
    try:
        # Search FTS5
        results = fts_search(conn, query, limit=limit)
        if not results:
            # Fallback: if FTS MATCH returns nothing, try a simple LIKE search on titles
            like_query = f"{query}%"
            rows = conn.execute(
                "SELECT slug, title, type, summary, body FROM pages WHERE title LIKE ? OR slug LIKE ? LIMIT ?",
                (like_query, like_query, limit)
            ).fetchall()
            results = [dict(r) for r in rows]

        sources = []
        context_parts = []
        
        for r in results:
            slug = r["slug"]
            title = r["title"]
            
            # Fetch full content
            full_row = conn.execute("SELECT body, summary, tags, type FROM pages WHERE slug=?", (slug,)).fetchone()
            if not full_row:
                continue
            body, summary, tags_json, p_type = full_row
            content = body or summary or ""
            
            sources.append({
                "slug": slug,
                "title": title,
                "type": p_type,
                "summary": summary
            })
            
            context_parts.append(
                f"Note Title: {title}\n"
                f"Slug/Link: [[{title}]]\n"
                f"Content:\n{content.strip()}\n"
                f"---"
            )
            
        context_text = "\n\n".join(context_parts)
        return {
            "context": context_text,
            "sources": sources
        }
    except Exception as e:
        logger.error(f"RAG retrieval failed: {e}")
        return {
            "context": "",
            "sources": []
        }
