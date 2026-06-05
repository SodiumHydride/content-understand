"""Bridge UI JSON settings → ContentConfig for the sidecar."""

from __future__ import annotations

import os
from typing import Any

from engine.paths import cache_dir, ensure_app_dirs
from engine.understand.config import BackendConfig, ContentConfig


def settings_to_config(data: dict[str, Any]) -> ContentConfig:
    """Map Electron settings payload to engine config."""
    from engine.runtime.manager import get_runtime_manager

    api_base = (data.get("apiBase") or "").strip()
    api_key = (data.get("apiKey") or "").strip()

    # Vendor-specific keys
    mimo_keys_raw = (data.get("mimoKeys") or "").strip()
    gemini_keys_raw = (data.get("geminiKeys") or "").strip()

    inference_mode = data.get("inferenceMode") or "prefer_api"
    rt = get_runtime_manager()
    local_base = rt.resolve_local_base_url(inference_mode)

    def endpoint_for(backend_id: str, model_field: str) -> BackendConfig:
        model = (data.get(model_field) or data.get("defaultModel") or "").strip()

        if backend_id == "mimo":
            # MiMo keys: env var > mimoKeys field > apiKey field
            keys = [
                k.strip()
                for k in (
                    os.environ.get("MIMO_KEYS")
                    or os.environ.get("MIMO_KEY")
                    or mimo_keys_raw
                    or api_key
                ).split(",")
                if k.strip()
            ]
            return BackendConfig(
                type="mimo",
                api_base=os.environ.get(
                    "MIMO_API_BASE", api_base or "https://api.xiaomimimo.com/v1"
                ),
                api_keys=keys,
                model=model or "mimo-v2.5",
            )

        if backend_id == "gemini":
            # Gemini keys: env var > geminiKeys field > apiKey field
            keys = [
                k.strip()
                for k in (
                    os.environ.get("GEMINI_KEYS")
                    or os.environ.get("GEMINI_API_KEY")
                    or gemini_keys_raw
                    or api_key
                ).split(",")
                if k.strip()
            ]
            return BackendConfig(
                type="gemini",
                api_keys=keys,
                model=model or "gemini-2.5-flash",
            )

        if backend_id == "claude":
            return BackendConfig(
                type="claude",
                api_base=api_base or "https://api.anthropic.com",
                api_keys=[api_key] if api_key else [],
                model=model or "claude-sonnet-4-6",
            )

        if backend_id == "local_server":
            base = (local_base or "http://127.0.0.1:11434/v1").rstrip("/")
            if not base.endswith("/v1"):
                base = f"{base}/v1"
            if not model:
                model = "gemma"
            return BackendConfig(
                type="openai_compat",
                api_base=base,
                api_keys=["local"],
                model=model,
            )

        # Default: openai_compat
        return BackendConfig(
            type="openai_compat",
            api_base=api_base,
            api_keys=[api_key] if api_key else [],
            model=model or "gpt-4o-mini",
        )

    # Build per-modality backend configs — each gets its own model name
    backends: dict[str, BackendConfig] = {}

    for key, field in (
        ("video", "videoBackend"),
        ("image", "imageBackend"),
        ("audio", "audioBackend"),
        ("article", "articleBackend"),
    ):
        bid = data.get(field) or "openai_compat"

        # Force local_server when inference mode demands it
        if inference_mode in ("prefer_local", "local_only") and local_base:
            bid = "local_server"

        model_field = f"{key}Model"
        backends[f"{key}_active"] = endpoint_for(str(bid), model_field)

    # Also populate named backends (for engine registry lookups)
    for bid in ("mimo", "gemini", "claude", "openai_compat", "local_server"):
        if bid not in backends:
            backends[bid] = endpoint_for(bid, "videoModel")

    ensure_app_dirs()
    cdir = (data.get("cacheDir") or "").strip() or str(cache_dir())

    # Determine effective backend per content type
    def effective_backend(field: str) -> str:
        bid = data.get(field) or "openai_compat"
        if inference_mode in ("prefer_local", "local_only") and local_base:
            return "local_server"
        return bid

    return ContentConfig(
        backends=backends,
        video_backend=effective_backend("videoBackend"),
        image_backend=effective_backend("imageBackend"),
        audio_backend=effective_backend("audioBackend"),
        article_backend=effective_backend("articleBackend"),
        cache_dir=cdir,
        bilibili_cookies=(data.get("cookiesPath") or None) or None,
    )
