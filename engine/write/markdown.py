"""Write understanding results to vault Markdown (full writer migrates from sodium wiki_writer)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path


def slugify(text: str, max_len: int = 80) -> str:
    text = re.sub(r"[^\w一-鿿぀-ヿ-]", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text[:max_len] or "untitled"


def _yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def write_result(vault_path: Path, result: dict) -> Path:
    """Persist a minimal markdown note; replace with contract-based writer later."""
    content_type = result.get("type", "video")
    subdir = vault_path / content_type
    subdir.mkdir(parents=True, exist_ok=True)

    title = result.get("title", "Untitled")
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    fname = f"{date}_{slugify(title)}.md"
    path = subdir / fname

    tags = result.get("tags", [])
    tag_yaml = "\n".join(f"  - {t}" for t in tags) if tags else "  - content"
    url = result.get("url", "")
    summary = (result.get("summary", "") or "")[:500]
    platform = result.get("platform", "source")
    author = result.get("author", "")

    md = f"""---
title: {_yaml_quote(title)}
type: {content_type}
tags:
{tag_yaml}
sources:
  - {_yaml_quote(url)}
created: {date}
updated: {datetime.now(timezone.utc).isoformat()}
platform: {_yaml_quote(platform)}
author: {_yaml_quote(author)}
summary: {_yaml_quote(summary)}
---

# {title}

{result.get('summary', '')}

## 来源

- [{platform}]({url})
"""
    path.write_text(md, encoding="utf-8")
    return path
