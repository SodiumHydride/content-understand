"""Output schemas for structured content understanding.

Defines Pydantic models for each content type's analysis output.
Used with JSON mode to guarantee parseable, validated results.

Usage:
    from content_understand.schemas import SCHEMA_MAP, get_schema_for_type

    schema_class = get_schema_for_type("video")  # → VideoAnalysis
    schema_dict = schema_class.model_json_schema()  # for API calls
    result = schema_class.model_validate_json(raw_json)  # for parsing
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class VideoAnalysis(BaseModel):
    """Structured output schema for video understanding."""

    summary: str = Field(description="2-3 sentence overview of the video's main content and value")
    key_points: list[str] = Field(
        description="3-8 core takeaways from the video",
        min_length=1,
        max_length=12,
    )
    detailed_content: str = Field(description="Detailed analysis organized by timeline or theme")
    tags: list[str] = Field(
        description="5-10 relevant tags WITHOUT # prefix",
        min_length=1,
        max_length=15,
    )
    conclusion: str = Field(description="2-3 sentence summary of core value and takeaway")


class ImageAnalysis(BaseModel):
    """Structured output schema for image understanding."""

    summary: str = Field(description="Main content description of the image")
    key_elements: list[str] = Field(
        description="Key visual elements identified in the image",
        min_length=1,
        max_length=10,
    )
    tags: list[str] = Field(
        description="5-10 relevant tags WITHOUT # prefix",
        min_length=1,
        max_length=15,
    )
    conclusion: str = Field(description="1-2 sentence summary of the image's message")


class TimelineSegment(BaseModel):
    """A single segment in an audio timeline."""

    start: str = Field(description="Start time in MM:SS format")
    end: str = Field(description="End time in MM:SS format")
    description: str = Field(description="Content summary for this segment")


class AudioAnalysis(BaseModel):
    """Structured output schema for audio understanding."""

    summary: str = Field(description="2-3 sentence overview of the audio content")
    timeline: list[TimelineSegment] = Field(
        description="Timeline segments with time ranges and descriptions",
        min_length=1,
    )
    key_points: list[str] = Field(
        description="3-8 core takeaways from the audio",
        min_length=1,
        max_length=12,
    )
    speakers: list[str] = Field(
        description="Identified speakers (if multiple)",
        default_factory=list,
    )
    tags: list[str] = Field(
        description="5-10 relevant tags WITHOUT # prefix",
        min_length=1,
        max_length=15,
    )
    conclusion: str = Field(description="2-3 sentence summary of the audio's core message")


class ArticleAnalysis(BaseModel):
    """Structured output schema for article/text understanding."""

    summary: str = Field(description="2-3 sentence overview of the article")
    key_points: list[str] = Field(
        description="3-8 core takeaways from the article",
        min_length=1,
        max_length=12,
    )
    detailed_content: str = Field(description="Detailed analysis organized by argument or theme")
    tags: list[str] = Field(
        description="5-10 relevant tags WITHOUT # prefix",
        min_length=1,
        max_length=15,
    )
    conclusion: str = Field(description="2-3 sentence summary of the article's core message")


# ── Schema registry ─────────────────────────────────────────────────

SCHEMA_MAP: dict[str, type[BaseModel]] = {
    "video": VideoAnalysis,
    "image": ImageAnalysis,
    "audio": AudioAnalysis,
    "article": ArticleAnalysis,
}


def get_schema_for_type(content_type: str) -> type[BaseModel]:
    """Get the Pydantic schema class for a content type."""
    schema = SCHEMA_MAP.get(content_type)
    if schema is None:
        raise ValueError(
            f"No schema for content type '{content_type}'. "
            f"Available: {', '.join(sorted(SCHEMA_MAP))}"
        )
    return schema


def get_schema_dict(content_type: str) -> dict[str, Any]:
    """Get the JSON Schema dict for a content type (for API calls)."""
    return get_schema_for_type(content_type).model_json_schema()


# ── Prompt templates ────────────────────────────────────────────────

_ZH_TEMPLATE = """请分析这段{content_type_desc}，严格按以下 JSON 格式输出。

Schema:
{schema_json}

要求：
- 只输出合法 JSON，不要输出任何其他文字、Markdown 或代码块
- tags 数组中不带 # 前缀
- 所有文本字段使用中文
- 确保输出符合上述 Schema 的所有字段和类型"""

_EN_TEMPLATE = """Analyze this {content_type_desc}, output strictly in the following JSON format.

Schema:
{schema_json}

Requirements:
- Output ONLY valid JSON, no other text, Markdown, or code blocks
- tags array should NOT have # prefix
- All text fields in English
- Ensure output matches all fields and types in the schema above"""

_CONTENT_TYPE_DESC = {
    "video": {
        "zh": "视频（包括画面和音频内容）",
        "en": "video (including visual and audio content)",
    },
    "image": {"zh": "图片", "en": "image"},
    "audio": {"zh": "音频", "en": "audio"},
    "article": {"zh": "文章", "en": "article"},
}


def build_structured_prompt(
    content_type: str,
    language: str = "zh",
    custom_prompt: str = "",
) -> str:
    """Build a prompt that instructs the model to output structured JSON.

    If custom_prompt is provided, it's prepended as context.
    The JSON schema is appended so the model knows the exact structure.
    """
    schema_class = get_schema_for_type(content_type)
    schema_json = schema_class.model_json_schema()
    import json

    schema_str = json.dumps(schema_json, indent=2, ensure_ascii=False)

    desc = _CONTENT_TYPE_DESC.get(content_type, {}).get(language, content_type)
    template = _ZH_TEMPLATE if language == "zh" else _EN_TEMPLATE

    structured_part = template.format(
        content_type_desc=desc,
        schema_json=schema_str,
    )

    if custom_prompt:
        return f"{custom_prompt}\n\n{structured_part}"
    return structured_part
