"""OpenAI-compat adapter — wraps existing backends as ContentModel.

This adapter wraps OpenAICompatModel (video), OpenAICompatImageModel (image),
OpenAICompatAudioModel (audio), and OpenAICompatArticleModel (article) into
a single ContentModel interface.

For video, the existing OpenAICompatModel already does frame extraction internally.
This adapter delegates to it for video, and to the specialized models for other types.
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


class OpenAICompatAdapter(ContentModel):
    """Adapter wrapping all OpenAI-compat backends as ContentModel.

    Capabilities depend on the underlying model:
    - Cloud endpoints: image, video (frames), text
    - Local Ollama endpoints: image, video (frames), audio (some models), text
    """

    def __init__(self, config: Any) -> None:
        self.config = config
        self._is_local = "127.0.0.1" in (config.api_base or "") or "localhost" in (config.api_base or "")
        self._models: dict[str, Any] = {}

    def _get_model(self, model_type: str) -> Any:
        if model_type not in self._models:
            if model_type == "video":
                from content_understand.models.openai_compat import OpenAICompatModel
                self._models[model_type] = OpenAICompatModel(self.config)
            elif model_type == "image":
                from content_understand.models.openai_compat_image import OpenAICompatImageModel
                self._models[model_type] = OpenAICompatImageModel(self.config)
            elif model_type == "audio":
                from content_understand.models.openai_compat_audio import OpenAICompatAudioModel
                self._models[model_type] = OpenAICompatAudioModel(self.config)
            elif model_type == "article":
                from content_understand.models.openai_compat_article import OpenAICompatArticleModel
                self._models[model_type] = OpenAICompatArticleModel(self.config)
        return self._models.get(model_type)

    def capabilities(self) -> ModelCapabilities:
        # OpenAI-compat can handle video (via frame extraction) and image natively.
        # Audio support depends on the specific model.
        accepts = Modality.TEXT | Modality.IMAGE | Modality.VIDEO

        # Add audio for local endpoints (Ollama models may support it)
        if self._is_local:
            accepts |= Modality.AUDIO

        return ModelCapabilities(
            accepts=accepts,
            preferred_input=Modality.VIDEO,  # Frames extracted from video
            supports_url_input=False,
            supports_base64_input=True,
            supports_native_video=False,  # Needs frame extraction
            default_fps=2.0 if not self._is_local else 0.5,
            default_scale="512:-2" if self._is_local else "",
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
            return self._understand_article(bundle, prompt, timeout, language)

    def _understand_video(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        """Video understanding via frame extraction (existing behavior)."""
        model = self._get_model("video")
        if bundle.frames:
            # Frames already extracted by preprocessor — use them directly
            import base64
            frames_b64 = []
            for f in bundle.frames:
                frames_b64.append(base64.b64encode(f.read_bytes()).decode())
            return model._analyze_frames(frames_b64, prompt or model._default_prompt(language), timeout)
        elif bundle.video_path:
            return model.understand_video(
                video_path=bundle.video_path,
                prompt=prompt,
                timeout=timeout,
                language=language,
            )
        raise ValueError("No video content in bundle")

    def _understand_audio(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        model = self._get_model("audio")
        if model is None:
            raise NotImplementedError("Audio not supported by this OpenAI-compat endpoint")
        return model.understand_audio(
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
        model = self._get_model("image")
        if bundle.images:
            return model.understand_image(
                image_path=str(bundle.images[0]),
                prompt=prompt,
                timeout=timeout,
                language=language,
            )
        raise ValueError("No images in bundle")

    def _understand_article(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
    ) -> str:
        model = self._get_model("article")
        return model.understand_article(
            text=bundle.text or "",
            title=bundle.metadata.get("title", ""),
            url=bundle.original_url,
            prompt=prompt,
            timeout=timeout,
            language=language,
        )
