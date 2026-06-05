"""Abstract base for video understanding model backends."""

from abc import ABC, abstractmethod


class VideoModel(ABC):
    """Abstract video understanding model."""

    @abstractmethod
    def understand_video(
        self,
        video_path: str | None = None,
        video_url: str | None = None,
        prompt: str = "",
        fps: float = 2.0,
        timeout: int = 120,
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
