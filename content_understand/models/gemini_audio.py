"""Gemini audio understanding backend — native audio input."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from content_understand._keys import KeyRotator, rotate_request
from content_understand.defaults import GEMINI_API_BASE, GEMINI_DEFAULT_MODEL
from content_understand.models.audio_base import AudioModel

logger = logging.getLogger(__name__)

_GEMINI_API_BASE = GEMINI_API_BASE

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


class GeminiAudioModel(AudioModel):
    """Gemini audio understanding via native audio API.

    Supports direct audio file input (up to 9.5 hours per request).
    """

    def __init__(self, config) -> None:
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.audio_model or GEMINI_DEFAULT_MODEL
        self.timeout = config.timeout or 300
        self._url_factory = _gemini_url_factory(self.model_name)

    def _call_gemini(self, parts: list[dict], timeout: int, label: str,
                     output_format: str = "text", json_schema: dict | None = None) -> str | dict:
        gen_config: dict = {"maxOutputTokens": 8192}

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
            import json
            try:
                return json.loads(result)
            except json.JSONDecodeError:
                return result

        return result

    def understand_audio(
        self,
        audio_path: str,
        prompt: str = "",
        timeout: int = 300,
        language: str = "zh",
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        if not prompt:
            prompt = _DEFAULT_AUDIO_PROMPT.get(language, _DEFAULT_AUDIO_PROMPT["zh"])

        audio_b64 = _encode_audio(audio_path)
        mime = _guess_mime(audio_path)

        parts = [
            {"inline_data": {"mime_type": mime, "data": audio_b64}},
            {"text": prompt},
        ]

        return self._call_gemini(parts, timeout or self.timeout, "understand",
                               output_format, json_schema)

    def transcribe_audio(
        self,
        audio_path: str,
        language: str = "zh",
        timeout: int = 300,
    ) -> str:
        lang_hint = "中文" if language.startswith("zh") else "English"
        prompt = f"请将这段音频转录为文字（{lang_hint}）。只输出转录文本，不要添加任何分析或总结。"

        audio_b64 = _encode_audio(audio_path)
        mime = _guess_mime(audio_path)

        parts = [
            {"inline_data": {"mime_type": mime, "data": audio_b64}},
            {"text": prompt},
        ]

        return self._call_gemini(parts, timeout or self.timeout, "transcribe")


def _encode_audio(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


def _guess_mime(path: str) -> str:
    from content_understand._mime import guess_mime

    return guess_mime(path, default="audio/mp3")
