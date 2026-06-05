"""Abstract base for preprocessors."""

from abc import ABC, abstractmethod


class Preprocessor(ABC):
    """Abstract content preprocessor."""

    @abstractmethod
    def process(self, input_path: str, output_path: str, **kwargs) -> str:
        """Process input and return path to processed output."""

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this preprocessor's dependencies are available."""
