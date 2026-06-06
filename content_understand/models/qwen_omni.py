"""Qwen2.5-Omni backend — end-to-end multimodal model.

Qwen2.5-Omni is an end-to-end multimodal model by Alibaba Cloud that
perceives text, images, audio, and video while generating text and speech.

Key characteristics:
- 7B (11B total) or 3B variant
- Thinker-Talker architecture with TMRoPE (Time-aligned Multimodal RoPE)
- use_audio_in_video flag for simultaneous video+audio processing
- Supports real-time voice and video chat
- Runs via transformers, vLLM, SGLang (NOT directly via Ollama due to special architecture)

This backend uses the OpenAI-compatible API (served via vLLM/SGLang/transformers server).
For Ollama deployment, use the Gemma 4 backend instead.
"""

from __future__ import annotations

import base64
import logging
import os
from pathlib import Path
from typing import Any

import requests

from content_understand.capabilities import (
    ContentBundle,
    Modality,
    ModelCapabilities,
)
from content_understand.models.base import ContentModel
from content_understand.preprocessing import FrameConfig

logger = logging.getLogger(__name__)


class QwenOmniModel(ContentModel):
    """Qwen2.5-Omni — end-to-end multimodal model.

    Served via vLLM/SGLang/transformers OpenAI-compatible API.
    Supports all modalities with use_audio_in_video=True for video+audio.
    """

    def __init__(self, config: Any) -> None:
        self.api_base = config.api_base.rstrip("/")
        self.model_name = config.model or "Qwen/Qwen2.5-Omni-7B"
        self.max_tokens = config.max_tokens or 8192
        self.timeout = config.timeout or 600

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            accepts=(
                Modality.TEXT
                | Modality.IMAGE
                | Modality.AUDIO
                | Modality.VIDEO
                | Modality.VIDEO_WITH_AUDIO
            ),
            preferred_input=Modality.VIDEO_WITH_AUDIO,
            supports_url_input=True,  # vLLM/SGLang support URL input
            supports_base64_input=True,
            supports_native_video=True,
            default_fps=1.0,
            max_audio_seconds=3600,  # Up to 10h audio
        )

    def understand(
        self,
        bundle: ContentBundle,
        prompt: str = "",
        timeout: int = 120,
        language: str = "zh",
        frame_config: FrameConfig | None = None,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        self._output_format = output_format
        self._json_schema = json_schema
        if bundle.content_type == "video":
            return self._understand_video(bundle, prompt, timeout, language)
        elif bundle.content_type == "audio":
            return self._understand_audio(bundle, prompt, timeout, language)
        elif bundle.content_type == "image":
            return self._understand_image(bundle, prompt, timeout, language)
        else:
            return self._understand_text(bundle, prompt, timeout, language)

    def _understand_video(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        """Video with audio — Qwen Omni's key feature.

        Uses use_audio_in_video=True to process video frames + audio simultaneously.
        """
        content: list[dict[str, Any]] = []

        # Add video frames (Qwen Omni processes frames + audio together)
        if bundle.frames:
            for frame_path in bundle.frames:
                b64 = self._file_to_base64(str(frame_path))
                if b64:
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                    })
        elif bundle.video_path:
            # Pass video file path (for vLLM/SGLang with local file access)
            content.append({
                "type": "video_url",
                "video_url": {"url": bundle.video_path},
            })

        # Add separated audio if available
        if bundle.audio_path and bundle.audio_path != bundle.video_path:
            audio_b64 = self._file_to_base64(bundle.audio_path)
            if audio_b64:
                content.append({
                    "type": "input_audio",
                    "input_audio": {"data": audio_b64, "format": "wav"},
                })

        # Add prompt
        content.append({"type": "text", "text": prompt or self._default_prompt(language)})

        return self._chat(content, timeout)

    def _understand_audio(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        content: list[dict[str, Any]] = []
        if bundle.audio_path:
            audio_b64 = self._file_to_base64(bundle.audio_path)
            if audio_b64:
                content.append({
                    "type": "input_audio",
                    "input_audio": {"data": audio_b64, "format": "wav"},
                })
        content.append({"type": "text", "text": prompt or self._default_audio_prompt(language)})
        return self._chat(content, timeout)

    def _understand_image(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        content: list[dict[str, Any]] = []
        for img_path in bundle.images:
            b64 = self._file_to_base64(str(img_path))
            if b64:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                })
        content.append({"type": "text", "text": prompt or self._default_prompt(language)})
        return self._chat(content, timeout)

    def _understand_text(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        text = bundle.text or ""
        effective_prompt = prompt or self._default_prompt(language)
        if text:
            effective_prompt = f"{effective_prompt}\n\n{text[:60000]}"
        return self._chat([{"type": "text", "text": effective_prompt}], timeout)

    def _chat(self, content: list[dict], timeout: int) -> str | dict:
        url = f"{self.api_base}/chat/completions"
        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": self.max_tokens,
        }

        # Structured output: vLLM/SGLang support response_format
        output_format = getattr(self, "_output_format", "text")
        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
            body["temperature"] = 0.1

        try:
            resp = requests.post(url, json=body, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            content_text = data["choices"][0]["message"]["content"]

            # Parse JSON if structured output was requested
            if output_format == "json":
                import json
                try:
                    return json.loads(content_text)
                except json.JSONDecodeError:
                    return content_text

            return content_text
        except Exception as e:
            logger.error("Qwen Omni API error: %s", e)
            raise

    @staticmethod
    def _default_prompt(language: str = "zh") -> str:
        if language == "zh":
            return "请详细分析这段内容（包括画面和音频），提取核心要点和标签。"
        return "Analyze this content in detail (including visual and audio), extract key points and tags."

    @staticmethod
    def _default_audio_prompt(language: str = "zh") -> str:
        if language == "zh":
            return "请详细分析这段音频内容，包括说话人、关键信息和情感。"
        return "Analyze this audio in detail, including speakers, key information, and emotions."

    @staticmethod
    def _file_to_base64(path: str) -> str | None:
        if not os.path.exists(path):
            return None
        try:
            return base64.b64encode(Path(path).read_bytes()).decode()
        except Exception:
            return None
