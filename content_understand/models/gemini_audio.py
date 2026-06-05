"""Gemini audio understanding backend — native audio input."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from content_understand._keys import KeyRotator, rotate_request
from content_understand.models.audio_base import AudioModel

logger = logging.getLogger(__name__)

_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

_DEFAULT_AUDIO_PROMPT = """请详细分析这段音频，按以下结构输出：

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
- 用 2-3 句话总结音频主旨"""


def _gemini_url_factory(model_name: str):
    """Return a url_factory that puts the API key in the query param."""
    def _build_url(key: str) -> str:
        return f"{_GEMINI_API_BASE}/{model_name}:generateContent?key={key}"
    return _build_url


class GeminiAudioModel(AudioModel):
    """Gemini audio understanding via native audio API.

    Supports direct audio file input (up to 9.5 hours per request).
    """

    def __init__(self, config) -> None:
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.audio_model or "gemini-2.5-flash"
        self.timeout = config.timeout or 300
        self._url_factory = _gemini_url_factory(self.model_name)

    def _call_gemini(self, parts: list[dict], timeout: int, label: str) -> str:
        body = {
            "contents": [{"parts": parts}],
            "generationConfig": {"maxOutputTokens": 8192},
        }
        return rotate_request(
            "",  # unused when url_factory is provided
            body,
            self.rotator,
            timeout,
            f"gemini-audio:{label}",
            url_factory=self._url_factory,
            # Gemini response format is handled by the default extractor
        )

    def understand_audio(
        self,
        audio_path: str,
        prompt: str = "",
        timeout: int = 300,
    ) -> str:
        if not prompt:
            prompt = _DEFAULT_AUDIO_PROMPT

        audio_b64 = _encode_audio(audio_path)
        mime = _guess_mime(audio_path)

        parts = [
            {"inline_data": {"mime_type": mime, "data": audio_b64}},
            {"text": prompt},
        ]

        return self._call_gemini(parts, timeout or self.timeout, "understand")

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
