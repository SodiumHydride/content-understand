"""Understand local files or URLs — wired to the bundled content_understand engine."""

from __future__ import annotations

import logging
import mimetypes
from collections.abc import Callable
from pathlib import Path
from typing import Any

from engine.understand.config import ContentConfig

logger = logging.getLogger(__name__)


def _inject_wikilink_context(config: ContentConfig) -> None:
    """Fetch existing note titles from the vault index and append a wikilink
    instruction to the config's prompt_template so the AI model will emit
    ``[[wikilinks]]`` when referencing related notes.

    Silently no-ops when the index is empty or unavailable.
    """
    try:
        from engine.paths import vault_dir
        from engine.index.db import list_titles, open_db
        from engine.write.markdown import build_wikilink_instruction

        vault = vault_dir()
        conn = open_db(vault)
        titles = list_titles(conn)
        if not titles:
            return

        lang = config.output_language or "zh"
        snippet = build_wikilink_instruction(titles, lang=lang)
        if snippet:
            if config.prompt_template:
                config.prompt_template += snippet
            else:
                # No custom template set — store the snippet so the pipeline
                # can prepend it to the default prompt at runtime.
                config.prompt_template = snippet
    except Exception as exc:
        logger.debug("Wikilink context injection skipped: %s", exc)

ProgressFn = Callable[[str, int, str], None]

_KINDS = ("video", "image", "audio", "article")


def _ensure_local_ready(
    config: ContentConfig,
    on_progress: ProgressFn | None = None,
    *,
    prefer_user: bool = True,
) -> str | None:
    """Ensure an Ollama instance is reachable. Returns OpenAI-compatible base URL."""
    from engine.paths import app_data_root, models_dir
    from engine.runtime.manager import get_runtime_manager
    from engine.runtime.ollama_manager import (
        detect_app_ollama,
        detect_user_ollama,
        download_ollama,
        find_app_binary,
        get_shared_daemon,
    )

    # Ensure ffmpeg is available for video/audio processing
    try:
        from engine.runtime.ffmpeg_manager import ensure_ffmpeg
        ensure_ffmpeg(app_data_root(), on_progress)
    except Exception as e:
        logger.warning("ffmpeg setup failed (video processing may be limited): %s", e)

    rt = get_runtime_manager()
    rt.set_prefer_user_ollama(prefer_user)

    if prefer_user and detect_user_ollama():
        base = detect_user_ollama()
        if base:
            rt.mark_ollama_ready(base, "user")
            return base

    if detect_app_ollama():
        base = detect_app_ollama()
        if base:
            rt.mark_ollama_ready(base, "app")
            return base

    runtime_dir = app_data_root() / "runtime"
    if not find_app_binary(runtime_dir):
        if on_progress:
            on_progress("model", 5, "Downloading app Ollama...")
        download_ollama(runtime_dir, on_progress=on_progress)

    if on_progress:
        on_progress("model", 10, "Starting app Ollama...")

    daemon = get_shared_daemon()
    try:
        base = daemon.start(runtime_dir, models_dir())
        rt.mark_ollama_ready(base, "app")
        return base
    except Exception as exc:
        logger.warning("Failed to start app Ollama: %s", exc)
        return None


def detect_kind(path: Path) -> str:
    from content_understand.pipeline import _detect_content_type
    return _detect_content_type(str(path))


def _build_pipeline(config: ContentConfig, on_progress: ProgressFn | None = None):
    """Build a ContentPipeline from the app's ContentConfig."""
    from content_understand import ContentPipeline
    from content_understand.config import BackendConfig as EngineBackend
    from content_understand.config import ContentConfig as EngineConfig

    local_needed = any(
        getattr(config, f"{ct}_backend", "") == "local_server"
        for ct in _KINDS
    )
    if local_needed:
        from engine.runtime.manager import get_runtime_manager

        prefer_user = get_runtime_manager().prefer_user_ollama()
        local_url = _ensure_local_ready(config, on_progress, prefer_user=prefer_user)
        if local_url:
            bc = config.backends.get("local_server")
            if bc:
                bc.api_base = (
                    local_url if local_url.endswith("/v1") else f"{local_url}/v1"
                )
        elif any(
            getattr(config, f"{ct}_backend", "") == "local_server" for ct in _KINDS
        ):
            raise RuntimeError(
                "Local Ollama is required but could not be started. "
                "Check Settings → Ollama or switch inference mode."
            )

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

    # Inject frame settings into backend extra dicts
    frame_extra = {
        "fps": config.frame_fps,
        "max_frames": config.frame_max_frames,
        "scale": config.frame_scale,
        "strategy": config.frame_strategy,
        "num_ctx": config.frame_num_ctx,
    }
    for bc in backends.values():
        bc.extra = {**frame_extra, **bc.extra}

    engine_config = EngineConfig(
        backends=backends,
        video_backend=config.video_backend,
        image_backend=config.image_backend,
        audio_backend=config.audio_backend,
        article_backend=config.article_backend,
        cache_dir=config.cache_dir,
        cache_max_age_seconds=config.cache_max_age_seconds,
        bilibili_cookies=config.bilibili_cookies,
        output_language=config.output_language,
        prompt_template=config.prompt_template,
    )

    return ContentPipeline(engine_config)


def understand_path(
    path: str | Path,
    *,
    kind: str | None = None,
    config: ContentConfig | None = None,
    on_progress: ProgressFn | None = None,
    output_language: str | None = None,
    prompt_template: str | None = None,
    output_format: str = "text",
) -> dict[str, Any]:
    """Run understanding on an existing local file (no URL fetch)."""
    p = Path(path).expanduser().resolve()
    if not p.is_file():
        raise FileNotFoundError(path)

    content_kind = kind or detect_kind(p)
    cfg = config or ContentConfig()
    if output_language:
        cfg.output_language = output_language
    if prompt_template:
        cfg.prompt_template = prompt_template
    _inject_wikilink_context(cfg)
    pipeline = _build_pipeline(cfg, on_progress)

    try:
        result = pipeline.understand(
            str(p),
            content_type=content_kind,
            on_progress=on_progress,
            output_format=output_format,
        )
        result["type"] = content_kind
        result["url"] = p.as_uri()
        result.setdefault("platform", "local")
        return result
    except Exception as e:
        logger.error("Understanding failed: %s", e)
        raise


def _validate_ingest_url(url: str) -> None:
    """Reject common malformed URLs before hitting downloaders."""
    from urllib.parse import urlparse

    parsed = urlparse(url.strip())
    host = (parsed.netloc or "").lower()
    path = parsed.path or "/"

    if host in ("www.bilibili.com", "bilibili.com", "m.bilibili.com") and path in ("", "/"):
        raise ValueError(
            "Bilibili homepage is not a video. Paste a video URL, e.g. "
            "https://www.bilibili.com/video/BV1xxxxxxxxxx"
        )

    if host.endswith("bilibili.com") and "/video/" not in path and "b23.tv" not in host:
        if "BV" not in url and "/av" not in path.lower():
            raise ValueError(
                "Unrecognized Bilibili URL. Use a /video/BV… link or a b23.tv short link."
            )


def understand_url(
    url: str,
    *,
    config: ContentConfig | None = None,
    on_progress: ProgressFn | None = None,
    output_language: str | None = None,
    prompt_template: str | None = None,
    output_format: str = "text",
) -> dict[str, Any]:
    """Resolve URL via ContentPipeline (Bilibili cookies/API fallbacks, yt-dlp, HTTP)."""
    cfg = config or ContentConfig()
    if output_language:
        cfg.output_language = output_language
    if prompt_template:
        cfg.prompt_template = prompt_template
    _inject_wikilink_context(cfg)
    _validate_ingest_url(url)
    pipeline = _build_pipeline(cfg, on_progress)
    return pipeline.understand(url, on_progress=on_progress, output_format=output_format)
