"""Markdown output writer."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from content_understand.output.base import OutputWriter


def slugify(text: str, max_len: int = 80) -> str:
    text = re.sub(r"[^\w一-鿿぀-ヿ-]", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text[:max_len]


def _escape_yaml(text: str) -> str:
    return text.replace('"', '\\"').replace("\n", " ")


class MarkdownWriter(OutputWriter):
    """Write results as Markdown files with YAML frontmatter."""

    def write(self, result: dict[str, Any], output_dir: str | None = None) -> str | None:
        title = result.get("title", "Untitled")
        author = result.get("author", "")
        duration = result.get("duration", 0)
        platform = result.get("platform", "")
        url = result.get("url", "")
        summary = result.get("summary", "")
        tags = result.get("tags", [])

        now = datetime.now().strftime("%Y-%m-%d")
        duration_str = f"{duration // 60}m{duration % 60}s" if duration else ""

        tags_yaml = ", ".join(f'"{t}"' for t in tags) if tags else ""
        frontmatter = f"""---
title: "{_escape_yaml(title)}"
author: "{_escape_yaml(author)}"
duration: {duration}
platform: "{_escape_yaml(platform)}"
url: "{url}"
tags: [{tags_yaml}]
created: '{now}'
---"""

        body_parts = [f"# {title}\n"]
        body_parts.append(summary.strip() + "\n")

        if tags:
            body_parts.append("## Tags\n")
            body_parts.append(" · ".join(f"`{t}`" for t in tags) + "\n")

        body_parts.append("## Source\n")
        body_parts.append(f"- [{platform}]({url})")
        if author:
            body_parts.append(f"- Author: {author}")
        if duration_str:
            body_parts.append(f"- Duration: {duration_str}")
        body_parts.append("")

        content = frontmatter + "\n\n" + "\n".join(body_parts)

        out_dir = Path(output_dir) if output_dir else Path.cwd()
        out_dir.mkdir(parents=True, exist_ok=True)

        slug = slugify(title)
        filepath = out_dir / f"{slug}.md"

        counter = 1
        while filepath.exists():
            filepath = out_dir / f"{slug}_{counter}.md"
            counter += 1

        filepath.write_text(content, encoding="utf-8")
        return str(filepath)
