"""Backend registry — lazy-loads model modules on demand.

Single unified registry mapping backend names to ContentModel implementations.
All backends implement the ContentModel interface with capabilities() support.
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from content_understand.config import BackendConfig
    from content_understand.models.base import ContentModel

# ── Unified ContentModel registry ──────────────────────────────────
# Maps backend name → "module.path.ClassName" for lazy import.
_MODELS: dict[str, str] = {
    "gemma4": "content_understand.models.gemma4.Gemma4Model",
    "qwen_omni": "content_understand.models.qwen_omni.QwenOmniModel",
    "mimo": "content_understand.models.mimo_unified.MimoUnifiedContentModel",
    "openai_compat": "content_understand.models.openai_compat_unified.OpenAICompatUnifiedContentModel",
    "local_server": "content_understand.models.openai_compat_unified.OpenAICompatUnifiedContentModel",
    "claude": "content_understand.models.claude_image.ClaudeContentModel",
    "gemini": "content_understand.models.gemini_audio.GeminiAudioModel",
}

# Model name patterns → backend keys (for model-name-based routing)
_MODEL_NAME_PATTERNS: list[tuple[str, str]] = [
    ("gemma4", "gemma4"),
    ("gemma3", "gemma4"),
    ("qwen2.5-omni", "qwen_omni"),
    ("qwen_omni", "qwen_omni"),
    ("claude", "claude"),
    ("mimo", "mimo"),
    ("gemini", "gemini"),
]


def _load_class(dotted_path: str):
    """Lazy-import a class from a dotted module.ClassName path."""
    module_path, class_name = dotted_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


def _resolve_backend_by_model_name(model_name: str) -> str | None:
    """Resolve a model name (e.g. 'gemma4:12b-it-qat') to a backend key."""
    lower = model_name.lower()
    for pattern, backend in _MODEL_NAME_PATTERNS:
        if pattern in lower:
            return backend
    return None


def create_content_model(backend_name: str, config: BackendConfig) -> ContentModel:
    """Create a unified ContentModel by backend name.

    Uses model-name-based routing first (e.g. gemma4 model on local_server),
    then falls back to backend_name.
    """
    model_name = getattr(config, "model", "") or ""
    resolved = _resolve_backend_by_model_name(model_name) or backend_name

    if resolved not in _MODELS:
        known = ", ".join(sorted(_MODELS))
        raise ValueError(f"Unknown content model backend '{resolved}'. Known: {known}")

    try:
        cls = _load_class(_MODELS[resolved])
    except (ImportError, ModuleNotFoundError) as e:
        raise NotImplementedError(f"Content model backend '{resolved}' not available: {e}") from e

    return cls(config)


def has_content_model(backend_name: str) -> bool:
    """Check if a backend has a ContentModel implementation."""
    return backend_name in _MODELS


def list_content_models() -> list[str]:
    """List all available ContentModel backend names."""
    return sorted(_MODELS.keys())


def list_backends(content_type: str | None = None) -> dict[str, list[str]]:
    """List available backends.

    Args:
        content_type: Ignored (all backends are ContentModel now).
            Kept for backward compatibility.

    Returns:
        Dict with single key "content" mapping to all backend names.
    """
    return {"content": list(_MODELS.keys())}
