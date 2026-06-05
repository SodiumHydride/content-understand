"""Abstract base class for audio understanding models."""

from abc import ABC, abstractmethod


class AudioModel(ABC):
    """Base class for audio understanding backends.

    Two modes of operation:
    - ``understand_audio``: end-to-end understanding (e.g. Gemini native audio)
    - ``transcribe_audio``: speech-to-text only (e.g. Whisper)
    """

    @abstractmethod
    def understand_audio(
        self,
        audio_path: str,
        prompt: str = "",
        timeout: int = 300,
    ) -> str:
        """Understand audio content and return structured text.

        Args:
            audio_path: Local audio file path.
            prompt: Instruction for the model.
            timeout: Request timeout in seconds.

        Returns:
            Model-generated analysis / summary text.
        """

    @abstractmethod
    def transcribe_audio(
        self,
        audio_path: str,
        language: str = "zh",
        timeout: int = 300,
    ) -> str:
        """Transcribe audio to text (speech-to-text).

        Args:
            audio_path: Local audio file path.
            language: Language hint (e.g. "zh", "en").
            timeout: Request timeout in seconds.

        Returns:
            Transcribed text.
        """
