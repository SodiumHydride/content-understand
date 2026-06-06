"""Abstract base class for article/text understanding models."""

from abc import ABC, abstractmethod


class ArticleModel(ABC):
    """Base class for article understanding backends.

    Takes extracted text and produces structured analysis.
    """

    @abstractmethod
    def understand_article(
        self,
        text: str,
        title: str = "",
        url: str = "",
        prompt: str = "",
        timeout: int = 120,
        language: str = "zh",
    ) -> str:
        """Understand article text and return structured analysis.

        Args:
            text: The extracted article text.
            title: Article title (if known).
            url: Original URL (for context).
            prompt: Custom instruction for the model.
            timeout: Request timeout in seconds.

        Returns:
            Model-generated analysis text (Markdown).
        """
