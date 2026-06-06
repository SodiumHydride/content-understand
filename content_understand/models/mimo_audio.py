"""MiMo audio understanding backend — native audio input."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from content_understand._keys import KeyRotator, rotate_request
from content_understand.defaults import MIMO_DEFAULT_MODEL
from content_understand.models.audio_base import AudioModel

logger = logging.getLogger(__name__)


def _mimo_headers(key: str) -> dict[str, str]:
    """MiMo uses 'api-key' header instead of 'Authorization: Bearer'."""
    return {"api-key": key, "Content-Type": "application/json"}

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


class MimoAudioModel(AudioModel):
    """MiMo audio understanding via OpenAI-compatible API.

    Uses mimo-v2.5's native audio support (input_audio content type).
    Supports both URL and base64 input.
    Max 100MB for URL, 50MB for base64.
    """

    def __init__(self, config) -> None:
        self.api_base = config.api_base
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.model or MIMO_DEFAULT_MODEL
        self.max_tokens = config.max_tokens
        self.timeout = config.timeout or 600
        extra = getattr(config, "extra", {}) or {}
        self.force_base64 = extra.get("force_base64", False)

    def _post(self, body: dict, timeout: int, label: str) -> str:
        return rotate_request(
            self.api_base, body, self.rotator, timeout, f"mimo-audio:{label}",
            headers_factory=_mimo_headers,
        )

    def understand_audio(
        self,
        audio_path: str,
        prompt: str = "",
        timeout: int = 600,
        language: str = "zh",
    ) -> str:
        if not prompt:
            prompt = _DEFAULT_AUDIO_PROMPT.get(language, _DEFAULT_AUDIO_PROMPT["zh"])

        if self.force_base64 or not audio_path.startswith("http"):
            audio_data = _encode_audio(audio_path)
        else:
            audio_data = audio_path

        body = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_audio", "input_audio": {"data": audio_data}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_completion_tokens": self.max_tokens,
        }

        return self._post(body, timeout or self.timeout, "audio")

    def transcribe_audio(
        self,
        audio_path: str,
        language: str = "zh",
        timeout: int = 600,
    ) -> str:
        prompt = "请将这段音频转录为文字。只输出转录文本，不要添加任何分析或总结。"

        if self.force_base64 or not audio_path.startswith("http"):
            audio_data = _encode_audio(audio_path)
        else:
            audio_data = audio_path

        body = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_audio", "input_audio": {"data": audio_data}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_completion_tokens": self.max_tokens,
        }

        return self._post(body, timeout or self.timeout, "transcribe")


def _encode_audio(path: str) -> str:
    mime = _guess_mime(path)
    raw = Path(path).read_bytes()
    b64 = base64.b64encode(raw).decode()
    return f"data:{mime};base64,{b64}"


def _guess_mime(path: str) -> str:
    from content_understand._mime import guess_mime

    return guess_mime(path, default="audio/mpeg")
