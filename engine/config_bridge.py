"""Bridge UI settings → ContentConfig for the sidecar.

Handles both new (providers-based) and legacy (flat) settings formats.
"""

from __future__ import annotations

import contextlib
import os
from typing import Any

from content_understand.defaults import (
    CLAUDE_API_BASE,
    CLAUDE_DEFAULT_MODEL,
    GEMINI_DEFAULT_MODEL,
    MIMO_API_BASE,
    MIMO_DEFAULT_MODEL,
    OLLAMA_BASE_URL,
    OPENAI_COMPAT_DEFAULT_MODEL,
)
from engine.paths import cache_dir, ensure_app_dirs
from engine.understand.config import BackendConfig, ContentConfig

# Default model for each provider (fallback when selectedModel is empty)
_DEFAULT_MODELS: dict[str, str] = {
    "mimo": MIMO_DEFAULT_MODEL,
    "gemini": GEMINI_DEFAULT_MODEL,
    "claude": CLAUDE_DEFAULT_MODEL,
    "openai_compat": OPENAI_COMPAT_DEFAULT_MODEL,
    "local_server": "",  # Resolved at runtime from Ollama model list
}

# Default API bases (fallback when baseUrl is empty)
_DEFAULT_BASES: dict[str, str] = {
    "mimo": MIMO_API_BASE,
    "claude": CLAUDE_API_BASE,
}


def _provider_type(pid: str) -> str:
    if pid == "mimo":
        return "mimo"
    if pid == "gemini":
        return "gemini"
    if pid == "claude":
        return "claude"
    return "openai_compat"


def settings_to_config(data: dict[str, Any]) -> ContentConfig:
    """Map Electron settings payload to engine config.

    Supports two formats:
    - New: { providers: { mimo: {enabled, baseUrl, apiKeys, selectedModel}, ... }, ... }
    - Legacy: { apiBase, apiKey, mimoKeys, geminiKeys, videoBackend, videoModel, ... }
    """
    if "providers" in data:
        return _new_format(data)
    return _legacy_format(data)


def _new_format(data: dict[str, Any]) -> ContentConfig:
    """Convert new providers-based settings to ContentConfig."""
    from engine.runtime.manager import get_runtime_manager

    providers: dict[str, dict] = data.get("providers", {})
    inference_mode = data.get("inferenceMode", "prefer_api")
    modality_overrides: dict[str, dict] = data.get("modalityOverrides", {})
    default_provider = data.get("defaultProvider", "openai_compat")

    rt = get_runtime_manager()
    rt.set_prefer_user_ollama(bool(data.get("useOllamaIfAvailable", True)))
    preset_id = (data.get("localPresetId") or "").strip()
    if preset_id:
        with contextlib.suppress(ValueError):
            rt.apply_preset(preset_id)
    local_base = rt.resolve_local_base_url(inference_mode)

    # Build BackendConfig for each enabled provider
    backends: dict[str, BackendConfig] = {}

    for pid, pconf in providers.items():
        if not pconf.get("enabled") and pid != "local_server":
            continue

        base_url = (pconf.get("baseUrl") or "").strip()
        api_keys_raw = (pconf.get("apiKeys") or "").strip()
        model = (pconf.get("selectedModel") or "").strip()

        # Resolve API keys: env vars > provider config
        keys = _resolve_keys(pid, api_keys_raw)
        if pid == "local_server" and not keys:
            keys = ["local"]

        # Resolve base URL: provider config > defaults
        if pid == "local_server" and local_base:
            base_url = local_base.rstrip("/")
            if not base_url.endswith("/v1"):
                base_url = f"{base_url}/v1"
        elif not base_url and pid in _DEFAULT_BASES:
            base_url = _DEFAULT_BASES[pid]

        # Resolve model: provider config > defaults
        if not model:
            model = _DEFAULT_MODELS.get(pid, "")

        backends[pid] = BackendConfig(
            type=_provider_type(pid),
            api_base=base_url,
            api_keys=keys,
            model=model,
        )

    # Ensure local_server is always available
    if "local_server" not in backends:
        backends["local_server"] = BackendConfig(
            type="openai_compat",
            api_base=f"{local_base}/v1" if local_base else f"{OLLAMA_BASE_URL}/v1",
            api_keys=["local"],
            model="",
        )

    _apply_local_modality_models(backends["local_server"], rt)
    _apply_modality_override_models(backends, modality_overrides)

    # Build per-modality backend mapping
    content_types = ("video", "image", "audio", "article")
    backend_mapping: dict[str, str] = {}
    for ct in content_types:
        override = modality_overrides.get(ct, {})
        if override.get("providerId"):
            backend_mapping[ct] = override["providerId"]
        else:
            backend_mapping[ct] = default_provider

    # Apply inference mode overrides
    if inference_mode == "local_only" or (inference_mode == "prefer_local" and local_base):
        for ct in content_types:
            backend_mapping[ct] = "local_server"

    _validate_backend_mapping(backends, backend_mapping, inference_mode, local_base)

    ensure_app_dirs()
    cdir = (data.get("cacheDir") or "").strip() or str(cache_dir())

    # Extract frame settings from UI
    frame_settings = data.get("frameSettings", {})
    data.get("audioExtractSettings", {})
    proxy_settings = data.get("proxySettings", {})

    return ContentConfig(
        backends=backends,
        video_backend=backend_mapping.get("video", default_provider),
        image_backend=backend_mapping.get("image", default_provider),
        audio_backend=backend_mapping.get("audio", default_provider),
        article_backend=backend_mapping.get("article", default_provider),
        cache_dir=cdir,
        cache_max_age_seconds=int(data.get("cacheMaxAgeSeconds", 3600)),
        bilibili_cookies=(data.get("cookiesPath") or None) or None,
        output_language=(data.get("outputLanguage") or data.get("language") or "zh").strip(),
        prompt_template=(data.get("promptTemplate") or "").strip(),
        frame_fps=float(frame_settings.get("fps", 1.0)),
        frame_max_frames=int(frame_settings.get("maxFrames", 30)),
        frame_scale=str(frame_settings.get("scale", "")),
        frame_strategy=str(frame_settings.get("strategy", "uniform")),
        frame_num_ctx=int(frame_settings.get("numCtx", 16384)),
        http_proxy=str(proxy_settings.get("httpProxy", "")),
        github_mirror=str(proxy_settings.get("githubMirror", "")),
        ollama_mirror=str(proxy_settings.get("ollamaMirror", "")),
    )


def _legacy_format(data: dict[str, Any]) -> ContentConfig:
    """Convert legacy flat settings to ContentConfig."""
    from engine.runtime.manager import get_runtime_manager

    api_base = (data.get("apiBase") or "").strip()
    api_key = (data.get("apiKey") or "").strip()
    mimo_keys_raw = (data.get("mimoKeys") or "").strip()
    gemini_keys_raw = (data.get("geminiKeys") or "").strip()

    inference_mode = data.get("inferenceMode") or "prefer_api"
    rt = get_runtime_manager()
    local_base = rt.resolve_local_base_url(inference_mode)

    def endpoint_for(backend_id: str, model_field: str) -> BackendConfig:
        model = (data.get(model_field) or data.get("defaultModel") or "").strip()

        if backend_id == "mimo":
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
                api_base=os.environ.get("MIMO_API_BASE", api_base or MIMO_API_BASE),
                api_keys=keys,
                model=model or MIMO_DEFAULT_MODEL,
            )

        if backend_id == "gemini":
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
                model=model or GEMINI_DEFAULT_MODEL,
            )

        if backend_id == "claude":
            return BackendConfig(
                type="claude",
                api_base=api_base or CLAUDE_API_BASE,
                api_keys=[api_key] if api_key else [],
                model=model or CLAUDE_DEFAULT_MODEL,
            )

        if backend_id == "local_server":
            base = (local_base or f"{OLLAMA_BASE_URL}/v1").rstrip("/")
            if not base.endswith("/v1"):
                base = f"{base}/v1"
            return BackendConfig(
                type="openai_compat",
                api_base=base,
                api_keys=["local"],
                model=model or "",
            )

        return BackendConfig(
            type="openai_compat",
            api_base=api_base,
            api_keys=[api_key] if api_key else [],
            model=model or OPENAI_COMPAT_DEFAULT_MODEL,
        )

    backends: dict[str, BackendConfig] = {}
    for key, field in (
        ("video", "videoBackend"),
        ("image", "imageBackend"),
        ("audio", "audioBackend"),
        ("article", "articleBackend"),
    ):
        bid = data.get(field) or "openai_compat"
        if inference_mode in ("prefer_local", "local_only") and local_base:
            bid = "local_server"
        model_field = f"{key}Model"
        backends[f"{key}_active"] = endpoint_for(str(bid), model_field)

    for bid in ("mimo", "gemini", "claude", "openai_compat", "local_server"):
        if bid not in backends:
            backends[bid] = endpoint_for(bid, "videoModel")

    ensure_app_dirs()
    cdir = (data.get("cacheDir") or "").strip() or str(cache_dir())

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
        cache_max_age_seconds=int(data.get("cacheMaxAgeSeconds", 3600)),
        bilibili_cookies=(data.get("cookiesPath") or None) or None,
        output_language=(data.get("outputLanguage") or data.get("language") or "zh").strip(),
        prompt_template=(data.get("promptTemplate") or "").strip(),
    )


def _apply_modality_override_models(
    backends: dict[str, BackendConfig],
    modality_overrides: dict[str, dict],
) -> None:
    """Apply per-modality model picks from the settings UI."""
    for ct, field in (
        ("video", "model"),
        ("image", "image_model"),
        ("audio", "audio_model"),
        ("article", "model"),
    ):
        override = modality_overrides.get(ct, {})
        pid = (override.get("providerId") or "").strip()
        model = (override.get("model") or "").strip()
        if not pid or not model or pid not in backends:
            continue
        bc = backends[pid]
        if ct == "article":
            bc.model = model
        elif field == "model":
            if not bc.model:
                bc.model = model
        else:
            setattr(bc, field, model)


def _validate_backend_mapping(
    backends: dict[str, BackendConfig],
    backend_mapping: dict[str, str],
    inference_mode: str,
    local_base: str | None,
) -> None:
    """Fail early when routing points at a missing or unusable backend."""
    if inference_mode == "local_only" and not local_base:
        raise ValueError(
            "Local-only inference requires a running Ollama instance. "
            "Start Ollama in Settings or switch inference mode."
        )
    for ct, pid in backend_mapping.items():
        if pid not in backends:
            raise ValueError(f"Provider '{pid}' for {ct} is not enabled or missing API keys.")


def _apply_local_modality_models(local_bc: BackendConfig, rt) -> None:
    """Inject per-modality models into the local_server backend.

    User-set models (persisted in state.json) take priority over preset
    defaults, so manually configured non-preset models survive preset changes.
    Validates that the chosen model is actually installed in Ollama.
    """
    import logging

    import requests

    from engine.runtime.state import get_modality_models

    logger = logging.getLogger(__name__)

    persisted = get_modality_models()

    # Fetch installed models from Ollama for validation
    installed_models: set[str] = set()
    if local_bc.api_base:
        try:
            r = requests.get(f"{local_bc.api_base.rstrip('/')}/models", timeout=5)
            if r.status_code == 200:
                for m in r.json().get("data", []):
                    installed_models.add(m.get("id", ""))
        except Exception:
            pass

    for modality, attr in (
        ("video", "model"),
        ("image", "image_model"),
        ("audio", "audio_model"),
        ("article", "model"),
    ):
        # 1. User-persisted override wins
        user_val = persisted.get(modality, "").strip()
        # 2. Fall back to runtime resolution (preset default)
        resolved = rt.resolve_model_for_modality(modality)
        value = user_val or resolved
        if not value:
            continue

        # Validate model is installed (warn but don't block)
        if installed_models and value not in installed_models:
            logger.warning(
                "Model '%s' for %s is not installed in Ollama. "
                "Available: %s. The request will likely fail with 404.",
                value,
                modality,
                ", ".join(sorted(installed_models)) or "(none)",
            )

        if modality == "article" and attr == "model":
            # article only sets model if video didn't already set it
            if not local_bc.model:
                local_bc.model = value
        else:
            setattr(local_bc, attr, value)


def _resolve_keys(provider_id: str, config_keys: str) -> list[str]:
    """Resolve API keys with env var fallback."""
    env_map = {
        "mimo": ["MIMO_KEYS", "MIMO_KEY"],
        "gemini": ["GEMINI_KEYS", "GEMINI_API_KEY"],
        "claude": ["ANTHROPIC_API_KEY"],
        "openai_compat": ["OPENAI_API_KEY"],
    }
    env_keys = env_map.get(provider_id, [])
    raw = config_keys
    for env_key in env_keys:
        env_val = os.environ.get(env_key)
        if env_val:
            raw = env_val
            break
    return [k.strip() for k in raw.split(",") if k.strip()]
