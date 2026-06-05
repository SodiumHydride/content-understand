"""JSON output writer."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from content_understand.output.base import OutputWriter


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-") or "untitled"


class JsonWriter(OutputWriter):
    """Write analysis results as JSON files."""

    def write(self, result: dict[str, Any], output_dir: str | None = None) -> str | None:
        title = result.get("title", "untitled")
        filename = _slugify(title) + ".json"

        if output_dir is None:
            output_dir = os.getcwd()
        os.makedirs(output_dir, exist_ok=True)

        filepath = os.path.join(output_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        return filepath
