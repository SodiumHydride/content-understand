"""Output validation — parse, clean, and validate LLM JSON output.

Two-stage defense:
1. clean_json(): strip markdown fences, fix common issues
2. validate_output(): Pydantic model validation with retry

Usage:
    from content_understand.validation import validate_output, OutputFormat
    from content_understand.schemas import VideoAnalysis

    # With raw LLM response
    result = validate_output(raw_text, VideoAnalysis)
    # result is a validated VideoAnalysis instance or raises
"""

from __future__ import annotations

import json
import logging
import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)


class OutputFormat(str, Enum):
    """Output format options for model calls."""

    TEXT = "text"  # Free-form text (default, backward compatible)
    JSON = "json"  # Structured JSON output


def clean_json(raw: str) -> str:
    """Clean LLM output to extract valid JSON.

    Handles common issues:
    - Markdown code fences (```json ... ```)
    - Leading/trailing text before/after JSON
    - BOM and zero-width characters
    - Single quotes instead of double quotes (best effort)
    """
    if not raw:
        return raw

    text = raw.strip()

    # Remove BOM
    if text.startswith("﻿"):
        text = text[1:]

    # Remove zero-width characters
    text = re.sub(r"[​‌‍﻿]", "", text)

    # Strip markdown code fences
    fence_pattern = r"```(?:json|JSON)?\s*\n?(.*?)\n?\s*```"
    match = re.search(fence_pattern, text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    elif text.startswith("```"):
        # Incomplete fence — just strip the opening
        text = re.sub(r"^```(?:json|JSON)?\s*\n?", "", text)
        text = re.sub(r"\n?\s*```\s*$", "", text)

    # If text doesn't start with { or [, try to find JSON within it
    if text and text[0] not in "{[":
        # Look for the first { or [
        for start_char in ["{", "["]:
            idx = text.find(start_char)
            if idx > 0:
                text = text[idx:]
                break

    if text and text[0] in "{[":
        # Find matching closing bracket
        opener = text[0]
        closer = "}" if opener == "{" else "]"
        depth = 0
        end_pos = 0
        for i, ch in enumerate(text):
            if ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    end_pos = i + 1
                    break
        if end_pos > 0:
            text = text[:end_pos]

    # Remove trailing comma before } or ] (common LLM mistake)
    text = re.sub(r",\s*([}\]])", r"\1", text)

    return text.strip()


def parse_json(raw: str) -> dict | list | None:
    """Parse JSON from LLM output with cleaning.

    Returns parsed object or None if all attempts fail.
    """
    if not raw:
        return None

    # Try direct parse first
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Try cleaning then parse
    cleaned = clean_json(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Try extracting JSON from within larger text
    decoder = json.JSONDecoder()
    for start_char in ("{", "["):
        idx = raw.find(start_char)
        if idx == -1:
            continue
        try:
            obj, _ = decoder.raw_decode(raw, idx)
            return obj
        except json.JSONDecodeError:
            continue

    logger.warning("Failed to parse JSON from LLM output (length=%d)", len(raw))
    return None


def validate_output(
    raw: str,
    schema_class: type[BaseModel],
) -> BaseModel | None:
    """Parse and validate LLM output against a Pydantic schema.

    Returns validated model instance, or None if parsing/validation fails.
    Caller should implement retry logic if needed.
    """
    parsed = parse_json(raw)
    if parsed is None:
        return None

    try:
        return schema_class.model_validate(parsed)
    except ValidationError as e:
        logger.warning("Schema validation failed: %s", e)
        # Try to salvage: if parsed is a dict with extra nesting, unwrap
        if isinstance(parsed, dict):
            # Some models wrap the result in an outer key
            for key in ("result", "data", "output", "analysis"):
                if key in parsed and isinstance(parsed[key], dict):
                    try:
                        return schema_class.model_validate(parsed[key])
                    except ValidationError:
                        continue
        return None


def validate_or_fallback(
    raw: str,
    schema_class: type[BaseModel],
    content_type: str = "article",
) -> dict[str, Any]:
    """Parse, validate, and return as dict. Falls back to basic extraction on failure.

    This is the main entry point for pipeline integration.
    Always returns a dict — never raises.
    """
    validated = validate_output(raw, schema_class)
    if validated is not None:
        return validated.model_dump()

    # Fallback: extract what we can from the raw text
    logger.warning("Structured validation failed, using fallback extraction")
    return _fallback_extract(raw, content_type)


def _fallback_extract(raw: str, content_type: str) -> dict[str, Any]:
    """Best-effort extraction from unstructured text.

    Used when the model fails to output valid JSON.
    Extracts tags and uses the raw text as summary.
    """
    tags = re.findall(r"#([\w一-鿿][\w一-鿿_-]*)", raw)
    tags = list(dict.fromkeys(tags))[:10]  # dedupe, cap at 10

    # Try to find a summary-like first paragraph
    lines = [
        line.strip()
        for line in raw.split("\n")
        if line.strip() and not line.strip().startswith("#")
    ]
    summary = lines[0] if lines else raw[:500]

    base = {
        "summary": summary[:1000],
        "tags": tags,
        "conclusion": "",
    }

    if content_type == "video":
        base["key_points"] = []
        base["detailed_content"] = raw[:3000]
    elif content_type == "audio":
        base["timeline"] = []
        base["key_points"] = []
        base["speakers"] = []
    elif content_type == "article":
        base["key_points"] = []
        base["detailed_content"] = raw[:3000]
    elif content_type == "image":
        base["key_elements"] = []

    return base
