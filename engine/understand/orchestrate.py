"""Understand local files or URLs — wired to the bundled content_understand engine."""

from __future__ import annotations

import logging
import mimetypes
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from engine.understand.config import ContentConfig

logger = logging.getLogger(__name__)

ProgressFn = Callable[[str, int, str], None]

_KINDS = ("video", "image", "audio", "article")


def _ensure_local_ready(
    config: ContentConfig,
    on_progress: ProgressFn | None = None,
) -> str | None:
    """Ensure local inference server is ready. Returns base URL or None.

    If autoStartLocal is enabled and the server is idle, triggers setup.
    Waits for the server to become ready (up to 120s).
    """
    from engine.runtime.manager import get_runtime_manager

    rt = get_runtime_manager()

    if rt.state == "ready" and rt.local_base_url:
        return rt.local_base_url

    if rt.state == "working":
        # Already starting, wait for it
        if on_progress:
            on_progress("model", 5, "Waiting for local server to start...")
        for _ in range(240):
            if rt.state == "ready" and rt.local_base_url:
                return rt.local_base_url
            if rt.state == "error":
                raise RuntimeError(f"Local engine failed: {rt.message}")
            time.sleep(0.5)
        raise RuntimeError("Local engine startup timeout (120s)")

    if rt.state == "idle":
        # Try to auto-start
        from engine.runtime.presets import recommend_preset

        rt.refresh_hardware()
        preset = recommend_preset(rt.hardware)
        if on_progress:
            on_progress("model", 5, f"Starting local server ({preset.get('id', 'unknown')})...")
        rt.setup_async(preset["id"], prefer_ollama=True)

        for _ in range(240):
            if rt.state == "ready" and rt.local_base_url:
                return rt.local_base_url
            if rt.state == "error":
                raise RuntimeError(f"Local engine failed: {rt.message}")
            time.sleep(0.5)
        raise RuntimeError("Local engine startup timeout (120s)")

    if rt.state == "error":
        raise RuntimeError(f"Local engine in error state: {rt.message}")

    return None


def detect_kind(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    if not mime:
        return "article"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("audio/"):
        return "audio"
    if mime in ("text/html", "application/pdf", "text/plain"):
        return "article"
    return "article"


def _build_pipeline(config: ContentConfig, on_progress: ProgressFn | None = None):
    """Build a ContentPipeline from the app's ContentConfig.

    If the config references local_server backends, ensures the local
    inference server is ready before building the pipeline.
    """
    from content_understand import ContentPipeline
    from content_understand.config import BackendConfig as EngineBackend
    from content_understand.config import ContentConfig as EngineConfig

    # Check if any content type uses local_server — ensure it's running
    local_needed = any(
        getattr(config, f"{ct}_backend", "") == "local_server"
        for ct in ("video", "image", "audio", "article")
    )
    if local_needed:
        local_url = _ensure_local_ready(config, on_progress)
        if local_url:
            # Inject the actual local URL into local_server backend configs
            for name, bc in config.backends.items():
                if name == "local_server" or bc.type == "openai_compat":
                    if "127.0.0.1" in bc.api_base:
                        bc.api_base = local_url if local_url.endswith("/v1") else f"{local_url}/v1"

    # Map app config -> engine config
    backends = {}
    for name, bc in config.backends.items():
        backends[name] = EngineBackend(
            type=bc.type,
            api_base=bc.api_base,
            api_keys=bc.api_keys,
            model=bc.model,
            image_model=bc.image_model,
            audio_model=bc.audio_model,
            timeout=bc.timeout,
            max_tokens=bc.max_tokens,
            extra=bc.extra,
        )

    engine_config = EngineConfig(
        backends=backends,
        video_backend=config.video_backend,
        image_backend=config.image_backend,
        audio_backend=config.audio_backend,
        article_backend=config.article_backend,
        cache_dir=config.cache_dir,
        bilibili_cookies=config.bilibili_cookies,
        prompt_template=config.prompt_template,
    )

    return ContentPipeline(engine_config)


def understand_path(
    path: str | Path,
    *,
    kind: str | None = None,
    config: ContentConfig | None = None,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    """Run understanding on an existing local file (no URL fetch)."""
    p = Path(path).expanduser().resolve()
    if not p.is_file():
        raise FileNotFoundError(path)

    content_kind = kind or detect_kind(p)
    cfg = config or ContentConfig()

    pipeline = _build_pipeline(cfg, on_progress)

    try:
        result = pipeline.understand(
            str(p),
            content_type=content_kind,
            on_progress=on_progress,
        )
        result["type"] = content_kind
        result["url"] = p.as_uri()
        result.setdefault("platform", "local")
        return result
    except Exception as e:
        logger.error("Understanding failed: %s", e)
        raise


def understand_url(
    url: str,
    *,
    config: ContentConfig | None = None,
    on_progress: ProgressFn | None = None,
) -> dict[str, Any]:
    """Fetch (optional extras) then understand."""
    from engine.fetch import fetch_to_cache

    cfg = config or ContentConfig()
    cache = Path(cfg.cache_dir) if cfg.cache_dir else None

    if on_progress:
        on_progress("resolve", 10, "resolve url")
        on_progress("download", 25, "download")

    local = fetch_to_cache(url, cache_dir=cache, on_progress=on_progress)
    result = understand_path(local, config=cfg, on_progress=on_progress)
    result["url"] = url
    return result
