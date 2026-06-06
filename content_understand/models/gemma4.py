"""Gemma 4 12B backend — encoder-free omni model.

Gemma 4 12B (released 2026-06-03) is Google's first medium-sized encoder-free
multimodal model. It natively ingests text, images, audio, and video with audio
through a single decoder-only transformer — no separate vision/audio encoders.

Key characteristics:
- 12B dense model, runs on 16GB VRAM / unified memory
- Encoder-free: raw pixels and audio waveforms projected directly into LLM
- Supports video with audio (use_audio_in_video flag in Ollama/transformers)
- 1 FPS default sampling, configurable via video_metadata
- Apache 2.0 license

This backend uses Ollama's OpenAI-compatible API (/v1/chat/completions) since
Ollama natively supports Gemma 4 with multimodal inputs.
"""

from __future__ import annotations

import base64
import logging
import os
from pathlib import Path
from typing import Any

from content_understand.capabilities import (
    ContentBundle,
    Modality,
    ModelCapabilities,
)
from content_understand.models.base import ContentModel
from content_understand.preprocessing import FrameConfig

logger = logging.getLogger(__name__)

# Ollama's chat endpoint
_OLLAMA_CHAT = "/v1/chat/completions"


class Gemma4Model(ContentModel):
    """Gemma 4 12B — encoder-free omni model via Ollama.

    Supports all modalities: text, image, audio, video, video+audio.
    Uses Ollama's OpenAI-compatible API for inference.
    """

    def __init__(self, config: Any) -> None:
        self.api_base = config.api_base.rstrip("/")
        self.model_name = config.model or "gemma4:12b"
        self.max_tokens = config.max_tokens or 8192
        self.timeout = config.timeout or 600
        extra = getattr(config, "extra", {}) or {}
        self.force_base64 = extra.get("force_base64", False)

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
            supports_url_input=False,  # Ollama needs local files / base64
            supports_base64_input=True,
            supports_native_video=True,  # Gemma 4 eats video natively
            default_fps=1.0,  # Gemma 4 default is 1 FPS
            default_scale="",
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
        # Store format context for _chat
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
        """Process video with audio — Gemma 4's key capability.

        Gemma 4 can process video frames + audio simultaneously.
        We pass video as a sequence of image frames + audio track.
        """
        content: list[dict[str, Any]] = []

        # Add video frames if extracted by preprocessor
        if bundle.frames:
            for frame_path in bundle.frames:
                b64 = self._file_to_base64(str(frame_path))
                if b64:
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                    })
        elif bundle.video_base64:
            # Pass raw video as single image (Ollama handles video natively)
            content.append({
                "type": "video_url",
                "video_url": {"url": f"data:video/mp4;base64,{bundle.video_base64}"},
            })

        # Add audio if separated
        if bundle.audio_path and bundle.audio_path != bundle.video_path:
            audio_b64 = self._file_to_base64(bundle.audio_path)
            if audio_b64:
                content.append({
                    "type": "input_audio",
                    "input_audio": {"data": audio_b64, "format": "wav"},
                })

        # Add text prompt
        effective_prompt = self._build_prompt(prompt, bundle, language)
        content.append({"type": "text", "text": effective_prompt})

        return self._chat(content, timeout)

    def _understand_audio(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        """Process audio-only input."""
        content: list[dict[str, Any]] = []

        audio_path = bundle.audio_path
        if audio_path:
            audio_b64 = self._file_to_base64(audio_path)
            if audio_b64:
                content.append({
                    "type": "input_audio",
                    "input_audio": {"data": audio_b64, "format": "wav"},
                })

        effective_prompt = self._build_prompt(prompt, bundle, language)
        content.append({"type": "text", "text": effective_prompt})

        return self._chat(content, timeout)

    def _understand_image(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        """Process single or multiple images."""
        content: list[dict[str, Any]] = []

        for img_path in bundle.images:
            b64 = self._file_to_base64(str(img_path))
            if b64:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                })

        effective_prompt = self._build_prompt(prompt, bundle, language)
        content.append({"type": "text", "text": effective_prompt})

        return self._chat(content, timeout)

    def _understand_text(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        """Pure text understanding."""
        text = bundle.text or ""
        effective_prompt = self._build_prompt(prompt, bundle, language)
        if text:
            effective_prompt = f"{effective_prompt}\n\nContent:\n{text[:60000]}"

        content = [{"type": "text", "text": effective_prompt}]
        return self._chat(content, timeout)

    def _chat(self, content: list[dict], timeout: int) -> str | dict:
        """Send chat completion request to Ollama."""
        import requests

        url = f"{self.api_base}{_OLLAMA_CHAT}"
        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": self.max_tokens,
            "stream": False,
        }

        # Structured output: use Ollama's native format parameter
        output_format = getattr(self, "_output_format", "text")
        json_schema = getattr(self, "_json_schema", None)
        if output_format == "json":
            if json_schema:
                body["format"] = json_schema  # Full schema constraint
            else:
                body["format"] = "json"  # Just guarantee valid JSON
            body["options"] = body.get("options", {})
            body["options"]["temperature"] = 0.1

        try:
            resp = requests.post(url, json=body, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]

            # If JSON mode, try to parse the response
            if output_format == "json":
                import json
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    return content  # Return raw, let caller handle

            return content
        except Exception as e:
            logger.error("Gemma 4 API error: %s", e)
            raise

    def _build_prompt(self, prompt: str, bundle: ContentBundle, language: str) -> str:
        """Build effective prompt with defaults."""
        if prompt:
            return prompt

        defaults = {
            "video": {
                "zh": (
                    "请详细分析这段视频（包括画面和音频），按以下结构输出：\n\n"
                    "## 摘要\n用 2-3 句话概括视频主旨\n\n"
                    "## 要点\n- 列出核心要点（3-8 条）\n\n"
                    "## 详细内容\n按时间线或主题分段展开\n\n"
                    "## 标签\n给出 5-10 个相关标签，格式：#标签1 #标签2 ...\n\n"
                    "## 总结\n用 2-3 句话总结核心价值"
                ),
                "en": (
                    "Analyze this video in detail (including visual and audio content), "
                    "output in the following structure:\n\n"
                    "## Summary\nSummarize the main point in 2-3 sentences\n\n"
                    "## Key Points\n- List core points (3-8 items)\n\n"
                    "## Detailed Content\nExpand by timeline or theme\n\n"
                    "## Tags\nGive 5-10 relevant tags, format: #tag1 #tag2 ...\n\n"
                    "## Conclusion\nSummarize core value in 2-3 sentences"
                ),
            },
            "audio": {
                "zh": "请详细分析这段音频内容，包括说话人、关键信息和情感。",
                "en": "Analyze this audio in detail, including speakers, key information, and emotions.",
            },
            "image": {
                "zh": "请详细分析这张图片的内容。",
                "en": "Analyze this image in detail.",
            },
            "article": {
                "zh": "请分析以下文章内容，提取要点和标签。",
                "en": "Analyze the following article, extract key points and tags.",
            },
        }

        ct = bundle.content_type or "video"
        lang = language or "zh"
        return defaults.get(ct, {}).get(lang, defaults.get(ct, {}).get("zh", ""))

    @staticmethod
    def _file_to_base64(path: str) -> str | None:
        if not os.path.exists(path):
            return None
        try:
            return base64.b64encode(Path(path).read_bytes()).decode()
        except Exception:
            return None
