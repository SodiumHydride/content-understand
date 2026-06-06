"""Abstract base for video understanding model backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from content_understand.capabilities import ContentBundle, ModelCapabilities
    from content_understand.preprocessing import FrameConfig


class VideoModel(ABC):
    """Abstract video understanding model.

    Deprecated: prefer ContentModel for new backends.
    Kept for backward compatibility with existing implementations.
    """

    @abstractmethod
    def understand_video(
        self,
        video_path: str | None = None,
        video_url: str | None = None,
        prompt: str = "",
        fps: float = 2.0,
        timeout: int = 120,
        language: str = "zh",
    ) -> str:
        """Understand a video and return text result.

        Args:
            video_path: Local path to video file.
            video_url: Public URL to video.
            prompt: The analysis prompt.
            fps: Frames per second for sampling.
            timeout: API call timeout in seconds.

        Returns:
            Text description/analysis of the video.
        """
        ...

    @abstractmethod
    def understand_text(self, prompt: str, timeout: int = 60) -> str:
        """Text-only understanding (used for subtitle fallback)."""
        ...

    @abstractmethod
    def supports_video_url(self) -> bool:
        """Return True if this backend supports direct video URL input."""
        ...

    @abstractmethod
    def supports_audio(self) -> bool:
        """Return True if this backend can process audio from video."""
        ...


class ContentModel(ABC):
    """Unified content understanding model — the new base class.

    Unlike the split VideoModel/ImageModel/AudioModel hierarchy,
    ContentModel accepts a ContentBundle and decides internally
    what to do based on its own capabilities().

    New backends (Gemma 4, Qwen2.5-Omni, etc.) should implement this.
    Old backends are wrapped via adapters.

    Usage:
        model = SomeContentModel(config)
        caps = model.capabilities()   # What can this model do?
        result = model.understand(bundle, prompt, timeout, language)
    """

    @abstractmethod
    def capabilities(self) -> ModelCapabilities:
        """Declare what this model can accept and how it prefers input."""
        ...

    @abstractmethod
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
        """Understand content from a ContentBundle.

        The model picks what to consume from the bundle based on its capabilities.
        It does NOT need to check capabilities — the pipeline already ensured
        the bundle contains exactly what the model needs.

        Args:
            bundle: Preprocessed content bundle.
            prompt: Custom analysis prompt.
            timeout: API call timeout in seconds.
            language: Output language ("zh" or "en").
            frame_config: Frame extraction hints (for models that extract frames internally).
            output_format: "text" for free-form, "json" for structured JSON.
            json_schema: JSON Schema dict for structured output (used with output_format="json").

        Returns:
            str for text format, dict for json format.
        """
        ...
