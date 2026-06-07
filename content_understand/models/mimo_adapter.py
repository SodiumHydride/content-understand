"""MiMo adapter — wraps existing MimoModel as ContentModel.

MiMo-V2.5 is a native omni model with vision + audio encoders.
The existing MimoModel only uses the vision encoder for video.
This adapter adds audio support by extracting audio separately
and passing it via the input_audio content type alongside video_url.
"""

from __future__ import annotations

import logging
from typing import Any

from content_understand.capabilities import (
    ContentBundle,
    Modality,
    ModelCapabilities,
)
from content_understand.models.base import ContentModel
from content_understand.preprocessing import FrameConfig

logger = logging.getLogger(__name__)


class MimoAdapter(ContentModel):
    """Adapter wrapping MimoModel for unified ContentModel interface.

    MiMo-V2.5 supports:
    - Video (video_url) — existing
    - Image (image_url) — existing
    - Audio (input_audio) — via MimoAudioModel
    - Text — existing

    This adapter adds the missing piece: video + audio simultaneously.
    When the bundle has both video and audio, it sends both to the API.
    """

    def __init__(self, config: Any) -> None:
        self.config = config
        # Lazy-load the actual models
        self._video_model = None
        self._audio_model = None

    @property
    def video_model(self):
        if self._video_model is None:
            from content_understand.models.mimo import MimoModel
            self._video_model = MimoModel(self.config)
        return self._video_model

    @property
    def audio_model(self):
        if self._audio_model is None:
            from content_understand.models.mimo_audio import MimoAudioModel
            self._audio_model = MimoAudioModel(self.config)
        return self._audio_model

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
            supports_url_input=True,  # MiMo supports video URLs
            supports_base64_input=True,
            supports_native_video=True,  # MiMo processes video natively
            default_fps=2.0,  # MiMo default
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
        if bundle.content_type == "video":
            return self._understand_video(bundle, prompt, timeout, language, frame_config, output_format, json_schema)
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
        frame_config: FrameConfig | None = None,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        """Video understanding with optional audio.

        If the bundle has separated audio, we send video + audio simultaneously
        by including both in the request content.
        """
        from content_understand._keys import rotate_request

        rotator = self.video_model.rotator
        api_base = self.video_model.api_base
        model_video = self.video_model.model_video
        max_tokens = self.video_model.max_tokens

        def _mimo_headers(key: str) -> dict[str, str]:
            return {"api-key": key, "Content-Type": "application/json"}

        # Build video content
        video_content: dict[str, Any] = {}

        if bundle.original_url and bundle.original_url.startswith("http"):
            video_content = {
                "type": "video_url",
                "video_url": {"url": bundle.original_url},
                "fps": frame_config.fps if frame_config else 2.0,
                "media_resolution": "default",
            }
        elif bundle.video_base64:
            video_content = {
                "type": "video_url",
                "video_url": {"url": f"data:video/mp4;base64,{bundle.video_base64}"},
                "fps": frame_config.fps if frame_config else 2.0,
                "media_resolution": "default",
            }
        elif bundle.video_path:
            # Need to encode video to base64
            from content_understand.preprocessing import ContentPreprocessor
            b64 = ContentPreprocessor._encode_base64(bundle.video_path)
            if b64:
                video_content = {
                    "type": "video_url",
                    "video_url": {"url": f"data:video/mp4;base64,{b64}"},
                    "fps": frame_config.fps if frame_config else 2.0,
                    "media_resolution": "default",
                }

        if not video_content:
            raise RuntimeError("No video content available for MiMo")

        # Build content list — video + optional audio + text
        content = [video_content]

        # Add audio if separated from video
        if bundle.audio_path and bundle.audio_path != bundle.video_path:
            import base64 as b64mod
            from pathlib import Path

            audio_data = b64mod.b64encode(Path(bundle.audio_path).read_bytes()).decode()
            content.append({
                "type": "input_audio",
                "input_audio": {"data": audio_data},
            })

        # Add text prompt
        content.append({"type": "text", "text": prompt or self._default_prompt(language)})

        body = {
            "model": model_video,
            "messages": [{"role": "user", "content": content}],
            "max_completion_tokens": max_tokens,
        }

        # Structured output: MiMo supports response_format
        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
            body["temperature"] = 0.1

        result = rotate_request(
            api_base, body, rotator, timeout, "mimo:video+audio",
            headers_factory=_mimo_headers,
        )

        # Parse JSON if structured output was requested
        if output_format == "json":
            import json
            try:
                return json.loads(result)
            except json.JSONDecodeError:
                return result

        return result

    def _understand_audio(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        return self.audio_model.understand_audio(
            audio_path=bundle.audio_path,
            prompt=prompt,
            timeout=timeout,
            language=language,
        )

    def _understand_image(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        from content_understand.models.mimo_image import MimoImageModel
        img_model = MimoImageModel(self.config)

        if bundle.images:
            return img_model.understand_image(
                image_path=str(bundle.images[0]),
                prompt=prompt,
                timeout=timeout,
                language=language,
            )
        raise ValueError("No images in bundle")

    def _understand_text(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        return self.video_model.understand_text(prompt, timeout)

    @staticmethod
    def _default_prompt(language: str = "zh") -> str:
        if language == "zh":
            return (
                "请详细分析这段视频（包括画面和音频），按以下结构输出：\n\n"
                "## 摘要\n用 2-3 句话概括视频主旨\n\n"
                "## 要点\n- 列出核心要点（3-8 条）\n\n"
                "## 详细内容\n按时间线或主题分段展开\n\n"
                "## 标签\n给出 5-10 个相关标签\n\n"
                "## 总结\n用 2-3 句话总结核心价值"
            )
        return (
            "Analyze this video in detail (including visual and audio content), "
            "output in the following structure:\n\n"
            "## Summary\n## Key Points\n## Detailed Content\n## Tags\n## Conclusion"
        )
