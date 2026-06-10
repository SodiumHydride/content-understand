"""Resolver chain — tries resolvers in priority order until one succeeds."""

from __future__ import annotations

import logging
from typing import Any

from content_understand.resolvers.base import Resolver, ResolveResult

logger = logging.getLogger(__name__)


class ResolverChain:
    """Ordered chain of resolvers with automatic fallback."""

    def __init__(self, resolvers: list[Resolver]) -> None:
        self.resolvers = sorted(resolvers, key=lambda r: r.priority)

    def resolve(self, input: str, ctx: dict[str, Any] | None = None) -> ResolveResult:
        errors = []

        for resolver in self.resolvers:
            if not resolver.can_resolve(input):
                continue

            logger.info("[chain] Trying %s for %s", resolver.name, input[:100])
            try:
                result = resolver.resolve(input, ctx)
                logger.info("[chain] %s resolved successfully", resolver.name)
                return result
            except Exception as e:
                logger.warning("[chain] %s failed: %s", resolver.name, e)
                errors.append((resolver.name, str(e)))
                continue

        raise RuntimeError(f"No resolver could handle: {input[:200]}\nErrors: {errors}")

    def add_resolver(self, resolver: Resolver) -> None:
        self.resolvers.append(resolver)
        self.resolvers.sort(key=lambda r: r.priority)
