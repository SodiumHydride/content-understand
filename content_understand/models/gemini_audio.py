"""Gemini audio understanding backend — native audio input.

Rewritten as a ContentModel supporting audio and text modalities.
Keeps the exact Gemini API call logic (URL format, inline_data, responseMimeType).
"""

from __future__ import annotations

import base64
import json
import logging
from pathlib import Path
from typing import Any

from content_understand._keys import KeyRotator, rotate_request
from content_understand.capabilities import (
    ContentBundle,
    Modality,
    ModelCapabilities,
)
from content_understand.defaults import GEMINI_API_BASE, GEMINI_DEFAULT_MODEL
from content_understand.models.base import ContentModel

logger = logging.getLogger(__name__)

_GEMINI_API_BASE = GEMINI_API_BASE

# Gemini native audio: up to 9.5 hours per request
_MAX_AUDIO_SECONDS: int = 34_200  # 9.5 * 3600

_DEFAULT_AUDIO_PROMPT: dict[str, str] = {
    "zh": """请详细分析这段音频，按以下结构输出：

## 时间线
- MM:SS - MM:SS  内容分段概述（按内容逻辑分段）

## 要点
- 列出音频的核心要点（3-8 条）

## 说话人分析
- 识别到的说话人（如有多个）
- 每个说话人的立场或关键观点

## 情感与氛围
- 整体情感基调
- 情感变化或转折点（如有）

## 标签
- 给出 5-10 个相关标签，格式：#标签1 #标签2 ...

## 总结
- 用 2-3 句话总结音频主旨""",
    "en": """Analyze this audio in detail, output in the following structure:

## Timeline
- MM:SS - MM:SS  Segment overview

## Key Points
- List core points (3-8 items)

## Speaker Analysis
- Identified speakers (if multiple)
- Each speaker's stance or key viewpoints

## Emotion & Atmosphere
- Overall emotional tone
- Emotional shifts or turning points (if any)

## Tags
- Give 5-10 relevant tags, format: #tag1 #tag2 ...

## Conclusion
- Summarize the audio's core message in 2-3 sentences""",
}


def _gemini_url_factory(model_name: str):
    """Return a url_factory that builds the Gemini endpoint URL (no key in query)."""

    def _build_url(_key: str) -> str:
        return f"{_GEMINI_API_BASE}/{model_name}:generateContent"

    return _build_url


def _gemini_headers(key: str) -> dict[str, str]:
    """Return headers for Gemini API using x-goog-api-key."""
    return {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
    }


class GeminiAudioModel(ContentModel):
    """Gemini audio understanding via native audio API.

    Supports direct audio file input (up to 9.5 hours per request).
    Accepts AUDIO and TEXT modalities.
    """

    def __init__(self, config: Any) -> None:
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.audio_model or config.model or GEMINI_DEFAULT_MODEL
        self.max_tokens = config.max_tokens or 8192
        self.timeout = config.timeout or 300
        self._url_factory = _gemini_url_factory(self.model_name)

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            accepts=Modality.AUDIO | Modality.TEXT,
            preferred_input=Modality.AUDIO,
            max_audio_seconds=_MAX_AUDIO_SECONDS,
            supports_url_input=False,
            supports_base64_input=True,
            supports_native_video=False,
        )

    def understand(
        self,
        bundle: ContentBundle,
        prompt: str = "",
        timeout: int = 120,
        language: str = "zh",
        frame_config: Any | None = None,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        if bundle.has_audio:
            return self._understand_audio(
                bundle, prompt, timeout, language, output_format, json_schema
            )
        if bundle.has_text:
            return self._understand_text(
                bundle, prompt, timeout, language, output_format, json_schema
            )
        raise ValueError(
            "GeminiAudioModel requires audio or text in the ContentBundle; "
            f"got content_type={bundle.content_type!r}"
        )

    # ── Internal dispatch ──────────────────────────────────────────

    def _understand_audio(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str,
        json_schema: dict | None,
    ) -> str | dict:
        audio_path = bundle.audio_path or bundle.local_path
        if not audio_path:
            raise ValueError("ContentBundle has_audio but no audio_path set")

        if not prompt:
            prompt = _DEFAULT_AUDIO_PROMPT.get(language, _DEFAULT_AUDIO_PROMPT["zh"])

        audio_b64 = _encode_audio(audio_path)
        mime = _guess_mime(audio_path)

        parts = [
            {"inline_data": {"mime_type": mime, "data": audio_b64}},
            {"text": prompt},
        ]

        return self._call_gemini(
            parts, timeout or self.timeout, "understand", output_format, json_schema
        )

    def _understand_text(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str,
        json_schema: dict | None,
    ) -> str | dict:
        text = bundle.text or ""
        if not text.strip():
            raise ValueError("ContentBundle has_text but text is empty")

        user_prompt = prompt or text
        # If prompt is custom, prepend the bundle text as context
        if prompt and text:
            user_prompt = f"{text}\n\n---\n\n{prompt}"

        parts = [{"text": user_prompt}]

        return self._call_gemini(
            parts, timeout or self.timeout, "text", output_format, json_schema
        )

    # ── Gemini API call (preserved from original) ──────────────────

    def _call_gemini(
        self,
        parts: list[dict],
        timeout: int,
        label: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        gen_config: dict = {"maxOutputTokens": self.max_tokens}

        # Structured output: Gemini uses responseMimeType + responseSchema
        if output_format == "json":
            gen_config["responseMimeType"] = "application/json"
            if json_schema:
                gen_config["responseSchema"] = json_schema

        body = {
            "contents": [{"parts": parts}],
            "generationConfig": gen_config,
        }
        result = rotate_request(
            "",  # unused when url_factory is provided
            body,
            self.rotator,
            timeout,
            f"gemini-audio:{label}",
            url_factory=self._url_factory,
            headers_factory=_gemini_headers,
        )

        # Parse JSON if structured output was requested
        if output_format == "json":
            try:
                return json.loads(result)
            except (json.JSONDecodeError, TypeError):
                return result

        return result


def _encode_audio(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


def _guess_mime(path: str) -> str:
    from content_understand._mime import guess_mime

    return guess_mime(path, default="audio/mp3")
