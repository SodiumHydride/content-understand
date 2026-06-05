"""Backend registry — lazy-loads model modules on demand.

Supports four model categories:
- Video: VideoModel backends
- Image: ImageModel backends
- Audio: AudioModel backends
- Article: ArticleModel backends
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING, Union

if TYPE_CHECKING:
    from content_understand.config import BackendConfig
    from content_understand.models.base import VideoModel
    from content_understand.models.image_base import ImageModel
    from content_understand.models.audio_base import AudioModel
    from content_understand.models.article_base import ArticleModel

# ── Video backends ──────────────────────────────────────────────────
_VIDEO_BACKENDS: dict[str, tuple[str, str]] = {
    "mimo": ("content_understand.models.mimo", "MimoModel"),
    "openai_compat": ("content_understand.models.openai_compat", "OpenAICompatModel"),
    "local_server": ("content_understand.models.openai_compat", "OpenAICompatModel"),
}

# ── Image backends ──────────────────────────────────────────────────
_IMAGE_BACKENDS: dict[str, tuple[str, str]] = {
    "mimo": ("content_understand.models.mimo_image", "MimoImageModel"),
    "claude": ("content_understand.models.claude_image", "ClaudeImageModel"),
    "openai_compat": ("content_understand.models.openai_compat_image", "OpenAICompatImageModel"),
    "local_server": ("content_understand.models.openai_compat_image", "OpenAICompatImageModel"),
}

# ── Audio backends ──────────────────────────────────────────────────
_AUDIO_BACKENDS: dict[str, tuple[str, str]] = {
    "mimo": ("content_understand.models.mimo_audio", "MimoAudioModel"),
    "gemini": ("content_understand.models.gemini_audio", "GeminiAudioModel"),
    "local_server": ("content_understand.models.mimo_audio", "MimoAudioModel"),
}

# ── Article backends ────────────────────────────────────────────────
_ARTICLE_BACKENDS: dict[str, tuple[str, str]] = {
    "mimo": ("content_understand.models.mimo_article", "MimoArticleModel"),
    "openai_compat": ("content_understand.models.openai_compat_article", "OpenAICompatArticleModel"),
    "local_server": ("content_understand.models.openai_compat_article", "OpenAICompatArticleModel"),
}


def _load_class(module_path: str, class_name: str):
    """Lazy-import a class from its module path."""
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


def create_video_model(backend_name: str, config: BackendConfig) -> VideoModel:
    """Instantiate a VideoModel by backend name."""
    if backend_name not in _VIDEO_BACKENDS:
        known = ", ".join(sorted(_VIDEO_BACKENDS))
        raise ValueError(f"Unknown video backend '{backend_name}'. Known: {known}")
    module_path, class_name = _VIDEO_BACKENDS[backend_name]
    try:
        cls = _load_class(module_path, class_name)
    except (ImportError, ModuleNotFoundError) as e:
        raise NotImplementedError(
            f"Video backend '{backend_name}' not available: {e}"
        ) from None
    return cls(config)


def create_image_model(backend_name: str, config: BackendConfig) -> ImageModel:
    """Instantiate an ImageModel by backend name."""
    if backend_name not in _IMAGE_BACKENDS:
        known = ", ".join(sorted(_IMAGE_BACKENDS))
        raise ValueError(f"Unknown image backend '{backend_name}'. Known: {known}")
    module_path, class_name = _IMAGE_BACKENDS[backend_name]
    try:
        cls = _load_class(module_path, class_name)
    except (ImportError, ModuleNotFoundError) as e:
        raise NotImplementedError(
            f"Image backend '{backend_name}' not available: {e}"
        ) from None
    return cls(config)


def create_audio_model(backend_name: str, config: BackendConfig) -> AudioModel:
    """Instantiate an AudioModel by backend name."""
    if backend_name not in _AUDIO_BACKENDS:
        known = ", ".join(sorted(_AUDIO_BACKENDS))
        raise ValueError(f"Unknown audio backend '{backend_name}'. Known: {known}")
    module_path, class_name = _AUDIO_BACKENDS[backend_name]
    try:
        cls = _load_class(module_path, class_name)
    except (ImportError, ModuleNotFoundError) as e:
        raise NotImplementedError(
            f"Audio backend '{backend_name}' not available: {e}"
        ) from None
    return cls(config)


def create_article_model(backend_name: str, config: BackendConfig) -> ArticleModel:
    """Instantiate an ArticleModel by backend name."""
    if backend_name not in _ARTICLE_BACKENDS:
        known = ", ".join(sorted(_ARTICLE_BACKENDS))
        raise ValueError(
            f"Unknown article backend '{backend_name}'. Known: {known}"
        )
    module_path, class_name = _ARTICLE_BACKENDS[backend_name]
    try:
        cls = _load_class(module_path, class_name)
    except (ImportError, ModuleNotFoundError) as e:
        raise NotImplementedError(
            f"Article backend '{backend_name}' not available: {e}"
        ) from None
    return cls(config)


def create_model(
    content_type: str,
    backend_name: str,
    config: BackendConfig,
) -> Union[VideoModel, ImageModel, AudioModel, ArticleModel]:
    """Create a model for the given content type.

    Args:
        content_type: One of "video", "image", "audio", "article".
        backend_name: Backend identifier (e.g. "mimo", "gemini", "claude").
        config: BackendConfig with API keys, base URL, model name, etc.

    Returns:
        A concrete model instance.

    Raises:
        ValueError: If content_type or backend_name is unknown.
        NotImplementedError: If the backend module is not installed.
    """
    creators = {
        "video": create_video_model,
        "image": create_image_model,
        "audio": create_audio_model,
        "article": create_article_model,
    }
    if content_type not in creators:
        raise ValueError(
            f"Unknown content type '{content_type}'. "
            f"Known: {', '.join(sorted(creators))}"
        )
    return creators[content_type](backend_name, config)


def list_backends(content_type: str | None = None) -> dict[str, list[str]]:
    """List available backends, optionally filtered by content type.

    Returns:
        Dict mapping content type to list of backend names.
    """
    all_backends = {
        "video": list(_VIDEO_BACKENDS.keys()),
        "image": list(_IMAGE_BACKENDS.keys()),
        "audio": list(_AUDIO_BACKENDS.keys()),
        "article": list(_ARTICLE_BACKENDS.keys()),
    }
    if content_type:
        return {content_type: all_backends.get(content_type, [])}
    return all_backends
