"""Abstract base for output writers."""

from abc import ABC, abstractmethod
from typing import Any


class OutputWriter(ABC):
    """Abstract output writer."""

    @abstractmethod
    def write(self, result: dict[str, Any], output_dir: str | None = None) -> str | None:
        """Write result and return path to written file, or None on failure."""
