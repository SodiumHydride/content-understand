"""Centralized configuration for content-understand-engine."""

from __future__ import annotations

import tempfile
from pydantic import BaseModel, Field

_DEFAULT_CACHE_DIR = tempfile.gettempdir() + "/content_understand_cache"


class BackendConfig(BaseModel):
    """Configuration for a single model backend.

    Each backend (mimo, gemini, openai_compat, claude, etc.) gets its own block.
    The ``type`` field determines which implementation to use.
    """

    type: str = "openai_compat"  # openai_compat | mimo | gemini | claude
    api_base: str = ""
    api_keys: list[str] = Field(default_factory=list)
    model: str = ""
    image_model: str = ""  # override model for image tasks
    audio_model: str = ""  # override model for audio tasks
    timeout: int = 600
    max_tokens: int = 8192
    # Backend-specific params (e.g. whisper_model, fps, thinking, force_base64, etc.)
    extra: dict = Field(default_factory=dict)


class FFmpegConfig(BaseModel):
    """FFmpeg preprocessing configuration."""

    crf_values: list[int] = Field(default=[28, 32])
    scale_resolutions: list[str] = Field(default=["720:-2"])
    audio_bitrate: str = "128k"
    preset: str = "fast"
    normalize_timeout: int = 600
    compress_timeout: int = 600
    trim_timeout: int = 120
    hard_b64_limit: int = 52_000_000
    soft_b64_limit: int = 40_000_000


class OutputConfig(BaseModel):
    """Output layer configuration."""

    format: str = "markdown"  # markdown | json
    output_dir: str | None = None


class ContentConfig(BaseModel):
    """Top-level content-understand configuration.

    Structure:
        backends: named backend configurations
        video_backend / image_backend / audio_backend / article_backend:
            which backend to use for each content type
    """

    # -- Backend definitions --
    backends: dict[str, BackendConfig] = Field(default_factory=dict)

    # -- Content type -> backend mapping --
    video_backend: str = "mimo"
    image_backend: str = "mimo"
    audio_backend: str = "mimo"  # mimo-v2.5 supports native audio
    article_backend: str = "mimo"

    # -- Audio options --
    audio_use_whisper: bool = False
    whisper_model: str = "large-v3"

    # -- Download options --
    cache_dir: str = _DEFAULT_CACHE_DIR
    cache_max_age_seconds: int = 3600
    http_timeout: int = 300

    # -- Bilibili options --
    bilibili_cookies: str | None = None
    bilibili_quality: int = 360

    # -- Video URL mode (MiMo specific) --
    enable_url_mode: bool = False
    video_base_url: str = ""

    # -- FFmpeg --
    ffmpeg: FFmpegConfig = Field(default_factory=FFmpegConfig)

    # -- Output --
    output: OutputConfig = Field(default_factory=OutputConfig)

    # -- Custom prompt override --
    prompt_template: str = ""

    def get_backend(self, name: str) -> BackendConfig:
        """Get a backend config by name. Falls back to first available."""
        if name in self.backends:
            return self.backends[name]
        if self.backends:
            return next(iter(self.backends.values()))
        return BackendConfig()

    def backend_for_content_type(self, content_type: str) -> tuple[str, BackendConfig]:
        """Return (backend_name, BackendConfig) for a given content type."""
        name = getattr(self, f"{content_type}_backend", None) or self.video_backend
        return name, self.get_backend(name)
