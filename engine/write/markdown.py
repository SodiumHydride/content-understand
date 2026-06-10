"""Write understanding results to vault Markdown.

Output format matches sodium-core wiki contract (schema v2):
- YAML frontmatter with required fields
- Structured sections: 时间线, 要点, 详细内容, 来源, 变更记录
"""

from __future__ import annotations

import contextlib
import json
import os as _os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path


def build_wikilink_instruction(titles: list[str], lang: str = "zh") -> str:
    """Build a prompt fragment instructing the model to use [[wikilinks]].

    Returns an empty string when *titles* is empty (nothing to link to).
    """
    if not titles:
        return ""

    title_list = "\n".join(f"- {t}" for t in titles)
    if lang == "zh":
        return (
            "\n\n## 已有笔记（可用 [[wikilinks]] 引用）\n"
            "以下是知识库中已有的笔记标题。在输出中引用相关内容时，"
            "请使用 Obsidian 风格的双链语法 `[[笔记标题]]` 或 `[[笔记标题|显示文本]]`。\n"
            "只在内容确实相关时才创建链接，不要为了链接而链接。\n\n"
            f"{title_list}"
        )
    return (
        "\n\n## Existing notes (use [[wikilinks]] to reference)\n"
        "Below are titles of notes already in the vault. When referencing related content "
        "in your output, use Obsidian-style wikilink syntax `[[note title]]` or "
        "`[[note title|display text]]`. Only link when genuinely relevant.\n\n"
        f"{title_list}"
    )


def slugify(text: str, max_len: int = 80) -> str:
    text = re.sub(r"[^\w一-鿿぀-ヿ-]", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text[:max_len] or "untitled"


def _yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _extract_sections(body: str) -> dict[str, str]:
    """Extract ## sections from markdown body."""
    sections: dict[str, str] = {}
    current_name = ""
    current_lines: list[str] = []

    for line in body.split("\n"):
        match = re.match(r"^##\s+(.+?)\s*$", line)
        if match:
            if current_name:
                sections[current_name] = "\n".join(current_lines).strip()
            current_name = match.group(1).strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_name:
        sections[current_name] = "\n".join(current_lines).strip()

    return sections


def _extract_tags_from_body(body: str) -> list[str]:
    """Extract #tags from body text."""
    return list(set(re.findall(r"#([\w一-鿿][\w一-鿿_-]*)", body)))


def write_result(vault_path: Path, result: dict) -> Path:
    """Persist a wiki page to the vault.

    Format matches sodium-core wiki contract:
    - YAML frontmatter (schema v2)
    - Standard sections: 摘要, 时间线, 要点, 详细内容, 来源, 变更记录
    """
    content_type = result.get("type", "video")
    subdir = vault_path / content_type
    subdir.mkdir(parents=True, exist_ok=True)

    title = result.get("title", "Untitled")
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    short_id = uuid.uuid4().hex[:8]
    fname = f"{date}_{slugify(title)}_{short_id}.md"
    path = subdir / fname

    tags = result.get("tags", [])
    if not tags:
        tags = _extract_tags_from_body(result.get("summary", ""))

    url = result.get("url", "")
    platform = result.get("platform", "")
    author = result.get("author", "")
    body = result.get("summary", "")

    # Extract sections from body if it has them
    sections = _extract_sections(body)

    # Build summary: prefer ## 摘要, then ## 详细内容 first paragraph, then first non-heading line
    summary_text = sections.get("摘要", "")
    if not summary_text:
        detail = sections.get("详细内容", "")
        if detail:
            # First non-empty paragraph of 详细内容
            for para in detail.split("\n\n"):
                para = para.strip()
                if para and not para.startswith("#"):
                    summary_text = para[:300]
                    break
    if not summary_text:
        # Fallback: first non-heading line in body
        for line in body.split("\n"):
            line = line.strip()
            if line and not line.startswith("#"):
                summary_text = line[:300]
                break
    if not summary_text:
        summary_text = "（待补充）"

    # Build sources
    sources = []
    if url:
        sources.append(url)

    # Build frontmatter
    tag_yaml = "\n".join(f"  - {_yaml_quote(t)}" for t in tags) if tags else "  - content"
    source_yaml = (
        "\n".join(f"  - {_yaml_quote(s)}" for s in sources)
        if sources
        else "  - legacy:missing-source"
    )

    frontmatter = f"""---
title: {_yaml_quote(title)}
type: {content_type}
tags:
{tag_yaml}
aliases: []
sources:
{source_yaml}
created: '{date}'
updated: '{datetime.now(timezone.utc).strftime("%Y-%m-%d")}'
status: mature
summary: {_yaml_quote(summary_text[:300])}
sensitive: false
generated_by: content-understand
schema_version: 2
"""

    # Add media-specific frontmatter
    if platform:
        frontmatter += f"platform: {_yaml_quote(platform)}\n"
    if author:
        frontmatter += f"author: {_yaml_quote(author)}\n"
    duration = result.get("duration", "")
    if duration:
        frontmatter += f"duration: {duration}\n"

    frontmatter += "---\n"

    # Build body with standard sections
    body_parts = [f"# {title}\n"]

    # If body already has sections, use them; otherwise build from scratch
    if sections:
        # Reconstruct with standard section order
        standard_order = ["摘要", "时间线", "要点", "详细内容", "来源", "变更记录"]
        for section_name in standard_order:
            if section_name in sections:
                body_parts.append(f"## {section_name}\n{sections[section_name]}\n")
        # Add any non-standard sections
        for section_name, content in sections.items():
            if section_name not in standard_order:
                body_parts.append(f"## {section_name}\n{content}\n")
    else:
        # No sections detected — put everything under 详细内容
        if body.strip():
            body_parts.append(f"## 摘要\n{summary_text}\n")
            body_parts.append(f"## 详细内容\n{body}\n")

    # Always add 来源 and 变更记录
    if "来源" not in sections:
        source_lines = "\n".join(
            f"- [{platform}]({url})" if url and platform else f"- {url}" for url in sources
        )
        body_parts.append(f"## 来源\n{source_lines or '- （待补充）'}\n")

    if "变更记录" not in sections:
        body_parts.append(f"## 变更记录\n- {date}: 自动生成\n")

    full_content = frontmatter + "\n" + "\n".join(body_parts)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with _os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            f.write(full_content)
        _os.replace(tmp_path, str(path))  # atomic
    except BaseException:
        with contextlib.suppress(OSError):
            _os.unlink(tmp_path)
        raise
    return path
