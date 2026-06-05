"""Base resolver and result data model."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ResolveResult:
    """Standardized output from any resolver."""

    local_path: str
    original_url: str
    media_url: str
    content_type: str
    metadata: dict[str, Any] = field(default_factory=dict)
    source_type: str = "unknown"


class Resolver(ABC):
    """Base class for content resolvers.

    Each resolver knows how to handle a specific type of input.
    Resolvers are tried in priority order (lower number = higher priority).
    """

    priority: int = 50
    name: str = "base"

    @abstractmethod
    def can_resolve(self, input: str) -> bool:
        """Return True if this resolver can handle the given input."""

    @abstractmethod
    def resolve(self, input: str, ctx: dict[str, Any] | None = None) -> ResolveResult:
        """Resolve the input to a local file + metadata."""
