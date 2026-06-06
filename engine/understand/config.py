"""Configuration for multimodal understanding backends (OSS-friendly)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class BackendConfig(BaseModel):
    """One API endpoint (OpenAI-compatible cloud, Ollama, MiMo, etc.)."""

    type: str = "openai_compat"  # openai_compat | mimo | gemini | whisper
    api_base: str = ""
    api_keys: list[str] = Field(default_factory=list)
    model: str = ""
    image_model: str = ""
    audio_model: str = ""
    timeout: int = 600
    max_tokens: int = 8192
    extra: dict = Field(default_factory=dict)


class ContentConfig(BaseModel):
    """Per-modality backend selection + app dirs + video processing config."""

    backends: dict[str, BackendConfig] = Field(default_factory=dict)
    video_backend: str = "openai_compat"
    image_backend: str = "openai_compat"
    audio_backend: str = "openai_compat"
    article_backend: str = "openai_compat"
    cache_dir: str = ""
    cache_max_age_seconds: int = 3600
    bilibili_cookies: str | None = None
    output_language: str = "zh"  # "zh" | "en"
    prompt_template: str = ""

    # Video processing settings (from UI)
    frame_fps: float = 1.0
    frame_max_frames: int = 30
    frame_scale: str = ""
    frame_strategy: str = "uniform"
    audio_extract_enabled: bool = True
    audio_sample_rate: int = 16000

    def get_backend(self, name: str) -> BackendConfig:
        if name in self.backends:
            return self.backends[name]
        known = ", ".join(sorted(self.backends)) or "(none)"
        raise KeyError(
            f"Backend '{name}' is not configured. Available backends: {known}"
        )
