"""Abstract base class for image understanding models."""

from abc import ABC, abstractmethod


class ImageModel(ABC):
    """Base class for image understanding backends.

    Subclasses must implement ``understand_image``.
    Optionally override ``supports_image_url`` and ``understand_text``.
    """

    @abstractmethod
    def understand_image(
        self,
        image_path: str | None = None,
        image_url: str | None = None,
        prompt: str = "",
        timeout: int = 60,
        language: str = "zh",
    ) -> str:
        """Understand an image and return structured text.

        Args:
            image_path: Local file path (mutually exclusive with image_url).
            image_url: Remote URL (mutually exclusive with image_path).
            prompt: Instruction for the model.
            timeout: Request timeout in seconds.

        Returns:
            Model-generated description / analysis text.
        """

    def supports_image_url(self) -> bool:
        """Whether this backend can accept a remote image URL directly."""
        return False

    def understand_text(self, prompt: str, timeout: int = 60) -> str:
        """Pure text understanding (optional)."""
        raise NotImplementedError(f"{self.__class__.__name__} does not support understand_text")
