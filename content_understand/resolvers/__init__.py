"""Content resolvers — map URLs/paths to local files + metadata."""

from content_understand.resolvers.base import Resolver, ResolveResult
from content_understand.resolvers.chain import ResolverChain

__all__ = ["ResolveResult", "Resolver", "ResolverChain"]
