"""Configuration for multimodal understanding backends (OSS-friendly)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class BackendConfig(BaseModel):
    """One API endpoint (OpenAI-compatible cloud, Ollama, llama.cpp server, MiMo, etc.)."""

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
    """Per-modality backend selection + app dirs."""

    backends: dict[str, BackendConfig] = Field(default_factory=dict)
    video_backend: str = "openai_compat"
    image_backend: str = "openai_compat"
    audio_backend: str = "openai_compat"
    article_backend: str = "openai_compat"
    cache_dir: str = ""
    bilibili_cookies: str | None = None
    prompt_template: str = ""

    def get_backend(self, name: str) -> BackendConfig:
        if name in self.backends:
            return self.backends[name]
        if self.backends:
            return next(iter(self.backends.values()))
        return BackendConfig()
