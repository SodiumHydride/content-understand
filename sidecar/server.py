#!/usr/bin/env python3
"""Local HTTP API for the Electron UI."""

from __future__ import annotations

import argparse
import atexit
import json
import logging
import os
import platform
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
_IS_WINDOWS = platform.system() == "Windows"

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from content_understand.defaults import SIDECAR_PORT
from engine.config_bridge import settings_to_config
from engine.index.db import list_pages, open_db
from engine.index.rebuild import rebuild_from_vault, upsert_single_file
from engine.paths import app_data_root, ensure_app_dirs, vault_dir


def _inject_bundled_ffmpeg():
    """Add bundled ffmpeg to PATH if available and system ffmpeg is missing."""
    import shutil
    if shutil.which("ffmpeg"):
        return  # System ffmpeg available
    try:
        from engine.runtime.ffmpeg_manager import find_bundled_ffmpeg
        bundled = find_bundled_ffmpeg(app_data_root())
        if bundled:
            ffmpeg_bin_dir = str(Path(bundled).parent)
            os.environ["PATH"] = ffmpeg_bin_dir + os.pathsep + os.environ.get("PATH", "")
            logger.info("Injected bundled ffmpeg: %s", ffmpeg_bin_dir)
    except Exception:
        pass


def _apply_proxy_env(proxy_settings: dict[str, Any]) -> None:
    """Apply HTTP proxy settings to environment variables."""
    proxy = (proxy_settings.get("httpProxy") or "").strip()
    if proxy:
        os.environ["http_proxy"] = proxy
        os.environ["https_proxy"] = proxy
        os.environ["HTTP_PROXY"] = proxy
        os.environ["HTTPS_PROXY"] = proxy
        logger.info("Proxy set: %s", proxy)
    else:
        # Clear any app-set proxy (keep system proxy)
        for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
            # Only clear if it was set by us (not by the system)
            pass  # Don't clear — let system proxy work
from engine.runtime.hardware import probe_hardware
from engine.runtime.manager import get_runtime_manager
from engine.runtime.port_utils import (
    cleanup_stale_port,
    find_process_on_port,
    is_pid_alive,
    kill_process_by_pid,
    read_pid_file,
    write_pid_file,
)
from engine.runtime.presets import list_presets, recommend_preset
from engine.understand.orchestrate import understand_url
from engine.write.markdown import write_result

try:
    import uvicorn
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import PlainTextResponse
    from pydantic import BaseModel
except ImportError:
    print("Install sidecar deps: pip install fastapi uvicorn pydantic requests", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Process lifecycle management
# ---------------------------------------------------------------------------

def _pid_file_path() -> Path:
    return app_data_root() / "runtime" / "sidecar.pid"


def _ensure_pid_dir() -> bool:
    """Create the runtime directory for the PID file. Returns False on failure."""
    try:
        _pid_file_path().parent.mkdir(parents=True, exist_ok=True)
        return True
    except Exception as exc:
        logger.warning("Cannot create PID directory: %s", exc)
        return False


_cleanup_done = False


def _cleanup_runtime() -> None:
    """Primary cleanup: shut down Ollama and remove PID file (idempotent)."""
    global _cleanup_done
    if _cleanup_done:
        return
    _cleanup_done = True
    logger.info("Cleaning up runtime (pid=%d)...", os.getpid())
    try:
        get_runtime_manager().shutdown()
    except Exception as exc:
        logger.debug("RuntimeManager.shutdown() failed: %s", exc)
    try:
        pid_path = _pid_file_path()
        if pid_path.exists():
            pid_path.unlink()
            logger.debug("Removed PID file %s", pid_path)
    except Exception as exc:
        logger.debug("PID file cleanup failed: %s", exc)


def _handle_old_instance(port: int) -> None:
    """Check for a stale sidecar PID file and port conflict, resolve them."""
    pid_path = _pid_file_path()
    old_pid = read_pid_file(str(pid_path))

    if old_pid is not None:
        if is_pid_alive(old_pid):
            # Old process is alive — check if it holds our port
            port_holder = find_process_on_port(port)
            if port_holder == old_pid:
                logger.warning(
                    "Old sidecar PID %d is alive and holds port %d — killing it",
                    old_pid,
                    port,
                )
                kill_process_by_pid(old_pid, timeout=3.0)
            else:
                logger.info("Old sidecar PID %d is alive but does not hold port %d", old_pid, port)
        else:
            logger.info("Removing stale PID file (old PID %d is dead)", old_pid)
        # Clean up the file either way
        try:
            pid_path.unlink()
        except Exception:
            pass

    # Even if PID file was missing, check for port conflict
    if not cleanup_stale_port(port):
        logger.error("Port %d is occupied and cannot be freed — exiting", port)
        sys.exit(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from engine.app_log import init_logging
    from engine.cache import cleanup_stale_cache
    from engine.paths import cache_dir

    ensure_app_dirs()
    init_logging()

    # Evict stale cache files on startup
    try:
        cleanup_stale_cache(cache_dir())
    except Exception:
        pass

    yield
    # Graceful shutdown: stop app Ollama daemon before sidecar exits
    try:
        from engine.runtime.manager import get_runtime_manager
        get_runtime_manager().shutdown()
    except Exception:
        pass


app = FastAPI(title="Content Understand Sidecar", version="0.2.1", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(file://|app://|https?://(localhost|127\.0\.0\.1)(:\d+)?$)",
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_engine_config: dict[str, Any] = {}


def vault_path() -> Path:
    ensure_app_dirs()
    return vault_dir()


class IngestRequest(BaseModel):
    url: str
    output_language: str | None = None  # "zh" | "en" — overrides global setting
    prompt_template: str | None = None  # custom prompt — overrides global setting
    output_format: str = "text"  # "text" | "json" — structured output mode


class ConfigPayload(BaseModel):
    settings: dict[str, Any]


class RuntimeSetupPayload(BaseModel):
    confirm: bool = True


def _map_progress(stage: str, percent: int, message: str) -> dict:
    """UI stages: resolve | download | model | write"""
    ui_stage = stage
    if stage in ("detect", "understand"):
        ui_stage = "model"
    if stage == "done":
        ui_stage = "write"
        percent = 100
    return {"stage": ui_stage, "percent": percent, "message": message or ""}


import time as _time


def _run_ingest(
    job_id: str,
    url: str,
    output_language: str | None = None,
    prompt_template: str | None = None,
    output_format: str = "text",
) -> None:
    from engine.app_log import bind_job_logger, job_log_lines

    log = bind_job_logger(job_id)
    last_stage = "resolve"

    if not _engine_config:
        with _jobs_lock:
            _jobs[job_id].update(
                {
                    "status": "failed",
                    "error": "No engine config. Open Settings → Models, configure an API key, and click Save.",
                    "progress": _map_progress("model", 0, "no config"),
                    "logs": job_log_lines(job_id),
                    "_done_at": _time.time(),
                }
            )
        return

    try:
        cfg = settings_to_config(_engine_config)
    except ValueError as exc:
        log.error("Invalid engine config: %s", exc)
        with _jobs_lock:
            _jobs[job_id].update(
                {
                    "status": "failed",
                    "error": str(exc)[:500],
                    "progress": _map_progress("model", 0, str(exc)[:200]),
                    "logs": job_log_lines(job_id),
                    "_done_at": _time.time(),
                }
            )
        return

    # Apply per-request overrides
    if output_language:
        cfg.output_language = output_language
    if prompt_template:
        cfg.prompt_template = prompt_template

    def on_progress(stage: str, percent: int, message: str) -> None:
        nonlocal last_stage
        last_stage = stage
        if message:
            log.info("[%s] %s%% — %s", stage, percent, message)
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["progress"] = _map_progress(stage, percent, message)

    try:
        log.info("Ingest started: %s (lang=%s, format=%s)", url, cfg.output_language, output_format)
        on_progress("resolve", 10, "")
        if Path(url).expanduser().is_file():
            from engine.understand.orchestrate import understand_path

            result = understand_path(url, config=cfg, on_progress=on_progress,
                                     output_format=output_format)
        else:
            result = understand_url(url, config=cfg, on_progress=on_progress,
                                    output_format=output_format)

        on_progress("write", 90, "")
        vp = vault_path()
        path = write_result(vp, result)
        slug = str(path.relative_to(vp).with_suffix("")).replace("\\", "/")
        upsert_single_file(vp, path)
        log.info("Ingest completed → %s", slug)

        # Evict stale cache files after successful ingest
        try:
            from engine.cache import cleanup_stale_cache
            cleanup_stale_cache(Path(cfg.cache_dir), cfg.cache_max_age_seconds)
        except Exception:
            pass

        with _jobs_lock:
            _jobs[job_id].update(
                {
                    "status": "completed",
                    "progress": _map_progress("write", 100, ""),
                    "result_slug": slug,
                    "logs": job_log_lines(job_id),
                    "_done_at": _time.time(),
                }
            )
    except Exception as exc:
        log.error("Ingest failed at %s: %s", last_stage, exc, exc_info=True)
        fail_stage = last_stage if last_stage in ("resolve", "download", "model", "write") else "model"
        with _jobs_lock:
            _jobs[job_id].update(
                {
                    "status": "failed",
                    "error": str(exc)[:500],
                    "progress": _map_progress(fail_stage, 0, str(exc)[:200]),
                    "logs": job_log_lines(job_id),
                    "_done_at": _time.time(),
                }
            )


_JOB_TTL_SECONDS = 600  # 10 minutes


def _cleanup_stale_jobs() -> None:
    """Remove jobs that have been terminal (completed/failed) for longer than TTL."""
    now = _time.time()
    with _jobs_lock:
        stale = [
            jid
            for jid, job in _jobs.items()
            if job.get("status") in ("completed", "failed")
            and now - job.get("_done_at", now) > _JOB_TTL_SECONDS
        ]
        for jid in stale:
            _jobs.pop(jid, None)

        # Also mark jobs stuck in "processing" for > 15 min as timed out
        stuck = [
            jid
            for jid, job in _jobs.items()
            if job.get("status") == "processing"
            and now - job.get("_created_at", now) > 900
        ]
        for jid in stuck:
            _jobs[jid].update(
                {
                    "status": "failed",
                    "error": "Job timed out after 15 minutes",
                    "progress": _map_progress("model", 0, "timeout"),
                    "_done_at": now,
                }
            )


@app.get("/health")
def health():
    vp = vault_path()
    return {"ok": True, "vault": str(vp)}


@app.get("/v1/paths")
def get_paths():
    return ensure_app_dirs()


@app.post("/v1/config")
def set_config(body: ConfigPayload):
    global _engine_config
    _engine_config = body.settings
    # Apply proxy settings to environment
    _apply_proxy_env(body.settings.get("proxySettings", {}))
    return {"ok": True}


@app.get("/v1/runtime/status")
def runtime_status():
    rt = get_runtime_manager()
    if rt.hardware is None:
        rt.refresh_hardware()
    return rt.status()


@app.get("/v1/runtime/recommend")
def runtime_recommend():
    hw = probe_hardware()
    preset = recommend_preset(hw)
    from engine.runtime.presets import recommendation_summary

    return {
        "hardware": hw.to_dict(),
        "recommended_preset_id": preset.get("id"),
        "preset": preset,
        "summary_zh": recommendation_summary(hw, preset, "zh"),
        "summary_en": recommendation_summary(hw, preset, "en"),
    }


@app.get("/v1/runtime/presets")
def runtime_presets():
    return {"presets": list_presets()}


@app.post("/v1/runtime/setup")
def runtime_setup(body: RuntimeSetupPayload):
    if not body.confirm:
        raise HTTPException(400, "confirm required")
    rt = get_runtime_manager()
    rt.setup_async()
    return {"ok": True, "state": rt.state}


class ProviderModelsRequest(BaseModel):
    provider: str
    base_url: str = ""
    api_key: str = ""


@app.post("/v1/providers/models")
def provider_models(body: ProviderModelsRequest):
    """Fetch available models from a provider's API."""
    provider = body.provider
    base_url = body.base_url
    api_key = body.api_key
    if provider == "mimo":
        if not base_url:
            base_url = "https://api.xiaomimimo.com/v1"
        return {"models": _fetch_openai_models(base_url, api_key)}
    if provider == "gemini":
        return {"models": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]}
    if provider == "claude":
        return {"models": ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-8"]}
    if provider == "openai_compat":
        if not base_url:
            return {"models": []}
        return {"models": _fetch_openai_models(base_url, api_key)}
    if provider == "local_server":
        rt = get_runtime_manager()
        catalog = rt.catalog()
        installed = [p["ollama_model"] for p in catalog.get("installed", [])]
        return {"models": installed}
    return {"models": []}


def _fetch_openai_models(base_url: str, api_key: str) -> list[str]:
    """Fetch model list from an OpenAI-compatible /v1/models endpoint."""
    import requests as req_lib

    from content_understand.resolvers._ssrf import validate_url_not_ssrf

    try:
        validate_url_not_ssrf(base_url)
        base = base_url.rstrip("/")
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        r = req_lib.get(f"{base}/models", headers=headers, timeout=10)
        if r.status_code != 200:
            return []
        data = r.json()
        models = data.get("data", [])
        return sorted([m["id"] for m in models if "id" in m])
    except req_lib.ConnectionError:
        logger.warning("Cannot connect to %s", base_url)
        raise HTTPException(502, f"Cannot connect to {base_url}") from None
    except Exception:
        logger.warning("Failed to fetch models from %s", base_url, exc_info=True)
        return []


@app.post("/v1/runtime/stop")
def runtime_stop():
    get_runtime_manager().stop()
    return {"ok": True}


class AutoDetectPayload(BaseModel):
    use_user_ollama: bool = True
    auto_setup: bool = False


@app.post("/v1/runtime/auto-detect")
def runtime_auto_detect(body: AutoDetectPayload | None = None):
    """Startup auto-detection: user Ollama > app Ollama > idle (optional setup)."""
    payload = body or AutoDetectPayload()
    rt = get_runtime_manager()
    rt.set_prefer_user_ollama(payload.use_user_ollama)
    rt.refresh_hardware()

    if rt.state == "ready" and rt.local_base_url:
        return {
            "backend": "ollama",
            "url": rt.local_base_url,
            "state": "ready",
            "source": rt.ollama_source,
        }

    from engine.paths import app_data_root
    from engine.runtime.ollama_manager import resolve_active_ollama

    base, source = resolve_active_ollama(
        app_data_root() / "runtime",
        prefer_user=payload.use_user_ollama,
    )
    if base and source:
        rt.mark_ollama_ready(base, source)
        return {
            "backend": "ollama",
            "url": base,
            "state": "ready",
            "source": source,
        }

    if payload.auto_setup:
        rt.setup_async(prefer_user=payload.use_user_ollama)
        return {"backend": "ollama", "state": "working", "source": None}

    preset = recommend_preset(rt.hardware) if rt.hardware else {}
    rt.mark_idle()
    return {
        "backend": None,
        "state": "idle",
        "recommendation": preset.get("id"),
        "hardware": rt.hardware.to_dict() if rt.hardware else None,
    }



class CookiesExportPayload(BaseModel):
    browser: str = "chrome"


@app.post("/v1/cookies/export")
def export_cookies(body: CookiesExportPayload):
    """Export cookies from browser (direct jar dump — no Bilibili URL fetch)."""
    from engine.cookies_export import export_browser_cookies
    from engine.paths import app_data_root

    dest = app_data_root() / "bilibili-cookies.txt"
    try:
        size = export_browser_cookies(body.browser, dest)
        return {"ok": True, "path": str(dest), "size": size}
    except ValueError as exc:
        return {"ok": False, "error": str(exc)[:500]}
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)[:500]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:500]}


# ── Ollama management ──


@app.get("/v1/ollama/catalog")
def ollama_catalog():
    """Curated preset catalog merged with install state."""
    rt = get_runtime_manager()
    if rt.hardware is None:
        rt.refresh_hardware()
    return rt.catalog()


@app.get("/v1/ollama/status")
def ollama_status():
    """Check Ollama availability: app binary, running instance, catalog models."""
    from engine.paths import app_data_root, models_dir
    from engine.runtime.ollama_api import get_version
    from engine.runtime.ollama_api import list_models as ollama_list
    from engine.runtime.ollama_catalog import filter_installed_models
    from engine.runtime.ollama_manager import (
        app_binary_path,
        find_user_binary,
        is_app_ollama_installed,
        resolve_active_ollama,
    )

    runtime_dir = app_data_root() / "runtime"
    base, source = resolve_active_ollama(runtime_dir)
    catalog = get_runtime_manager().catalog()

    result = {
        "app_binary_installed": is_app_ollama_installed(runtime_dir),
        "app_binary_path": str(app_binary_path(runtime_dir)),
        "user_binary_path": str(find_user_binary()) if find_user_binary() else None,
        "running": base is not None,
        "base_url": base,
        "source": source,
        "models_dir": str(models_dir()),
        "version": get_version(base) if base else None,
        "catalog": catalog,
        "models": catalog.get("installed", []),
    }
    if base:
        result["models"] = filter_installed_models(ollama_list(base))
    return result


class OllamaDownloadPayload(BaseModel):
    confirm: bool = False


@app.post("/v1/ollama/download")
def ollama_download(body: OllamaDownloadPayload):
    """Download Ollama binary to app data (background thread — does not block other APIs)."""
    if not body.confirm:
        raise HTTPException(400, "confirm required")

    from engine.paths import app_data_root
    from engine.runtime.ollama_manager import start_app_ollama_download

    # Read GitHub mirror from engine config
    mirror = ""
    if _engine_config:
        proxy = _engine_config.get("proxySettings", {})
        mirror = proxy.get("githubMirror", "")

    runtime_dir = app_data_root() / "runtime"
    return start_app_ollama_download(runtime_dir, github_mirror=mirror)


class OllamaStartPayload(BaseModel):
    prefer_user: bool = True


@app.post("/v1/ollama/start")
def ollama_start(body: OllamaStartPayload | None = None):
    """Start or attach to an Ollama instance (non-blocking when startup is needed)."""
    from engine.paths import app_data_root
    from engine.runtime.ollama_manager import resolve_active_ollama

    payload = body or OllamaStartPayload()
    rt = get_runtime_manager()
    rt.set_prefer_user_ollama(payload.prefer_user)

    runtime_dir = app_data_root() / "runtime"
    base, source = resolve_active_ollama(runtime_dir, prefer_user=payload.prefer_user)
    if base:
        rt.mark_ollama_ready(base, source or "user")
        return {
            "ok": True,
            "status": "ready",
            "base_url": base,
            "source": source,
            "reused": True,
        }

    if rt.state == "working":
        return {"ok": True, "status": "in_progress"}

    rt.setup_async(prefer_user=payload.prefer_user, pull_preset=False)
    return {"ok": True, "status": "started"}


@app.post("/v1/ollama/stop")
def ollama_stop():
    """Stop app-managed Ollama only."""
    get_runtime_manager().stop()
    return {"ok": True, "message": "App Ollama stopped"}


@app.post("/v1/ollama/uninstall-app")
def ollama_uninstall_app():
    """Remove app-managed Ollama binary from app storage."""
    get_runtime_manager().uninstall_app_ollama()
    return {"ok": True}


@app.get("/v1/ollama/models")
def ollama_models():
    """List installed catalog models only."""
    catalog = get_runtime_manager().catalog()
    return {"models": catalog.get("installed", [])}


@app.get("/v1/ollama/installed-all")
def ollama_installed_all():
    """List ALL installed Ollama models (preset + non-preset).

    Returns ``{models: [{name, size, is_preset, preset_id, modalities}]}``.
    """
    from engine.paths import app_data_root
    from engine.runtime.ollama_api import list_models as ollama_list
    from engine.runtime.ollama_catalog import (
        filter_installed_models,
        installed_non_preset_models,
    )
    from engine.runtime.ollama_manager import resolve_active_ollama

    runtime_dir = app_data_root() / "runtime"
    base, _source = resolve_active_ollama(runtime_dir)
    if not base:
        return {"models": []}

    raw = ollama_list(base)
    out: list[dict[str, Any]] = []

    # Preset models
    for m in filter_installed_models(raw):
        out.append({
            "name": m.get("installed_name") or m.get("ollama_model", ""),
            "size": m.get("size", 0),
            "is_preset": True,
            "preset_id": m.get("preset_id"),
            "modalities": m.get("modalities", []),
        })

    # Non-preset (user-installed) models
    for m in installed_non_preset_models(raw):
        out.append({
            "name": m["name"],
            "size": m.get("size", 0),
            "is_preset": False,
            "preset_id": None,
            "modalities": m.get("modalities_guess", ["article"]),
        })

    return {"models": out}


class OllamaPullPayload(BaseModel):
    preset_id: str | None = None
    name: str | None = None


@app.post("/v1/ollama/pull")
def ollama_pull(body: OllamaPullPayload):
    """Pull a curated catalog model (by preset_id or catalog model name)."""
    from engine.paths import app_data_root
    from engine.runtime.ollama_api import pull_model as ollama_pull_model
    from engine.runtime.ollama_catalog import validate_catalog_model, validate_preset_pull
    from engine.runtime.ollama_manager import resolve_active_ollama

    rt = get_runtime_manager()
    try:
        if body.preset_id:
            validate_preset_pull(body.preset_id)
            return rt.pull_preset_async(body.preset_id)
        if body.name:
            model_name = validate_catalog_model(body.name)
        else:
            raise HTTPException(400, "preset_id or name required")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    from engine.runtime.ollama_catalog import preset_for_model

    found = preset_for_model(model_name)
    if found:
        return rt.pull_preset_async(found["id"])

    base, _ = resolve_active_ollama(app_data_root() / "runtime")
    if not base:
        rt.setup_async(prefer_user=rt.prefer_user_ollama(), pull_preset=False)
        return {"ok": True, "status": "started", "name": model_name}

    def _bg_pull() -> None:
        try:
            ollama_pull_model(base, model_name)
            logger.info("Pull completed: %s", model_name)
        except Exception:
            logger.exception("Pull failed: %s", model_name)

    threading.Thread(target=_bg_pull, daemon=True, name="ollama-pull-name").start()
    return {"ok": True, "status": "started", "name": model_name}


class OllamaDeletePayload(BaseModel):
    name: str


@app.delete("/v1/ollama/models")
def ollama_delete_model(body: OllamaDeletePayload):
    """Delete a catalog model from the active Ollama instance."""
    from engine.paths import app_data_root
    from engine.runtime.ollama_api import delete_model as ollama_delete
    from engine.runtime.ollama_catalog import validate_catalog_model
    from engine.runtime.ollama_manager import resolve_active_ollama

    try:
        model_name = validate_catalog_model(body.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    base, _ = resolve_active_ollama(app_data_root() / "runtime")
    if not base:
        raise HTTPException(400, "Ollama not running")

    ok = ollama_delete(base, model_name)
    return {"ok": ok, "name": model_name}


class OllamaSelectPresetPayload(BaseModel):
    preset_id: str


@app.post("/v1/ollama/select-preset")
def ollama_select_preset(body: OllamaSelectPresetPayload):
    """Select active preset and apply default modality routing."""
    rt = get_runtime_manager()
    try:
        preset = rt.apply_preset(body.preset_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "ok": True,
        "preset_id": body.preset_id,
        "ollama_model": preset.get("ollama_model"),
        "modality_models": rt.get_all_modality_models(),
    }


class ModalityModelPayload(BaseModel):
    modality: str  # video | image | audio | article
    model: str  # Ollama model name, e.g. "qwen2.5-vl:7b"


@app.get("/v1/ollama/modality-models")
def get_modality_models():
    """Get per-modality model routing config."""
    rt = get_runtime_manager()
    return {"models": rt.get_all_modality_models()}


@app.put("/v1/ollama/modality-models")
def set_modality_model(body: ModalityModelPayload):
    """Set model for a specific modality."""
    if body.modality not in ("video", "image", "audio", "article"):
        raise HTTPException(400, "modality must be video, image, audio, or article")
    rt = get_runtime_manager()
    rt.set_modality_model(body.modality, body.model)
    return {"ok": True, "modality": body.modality, "model": body.model}


@app.get("/v1/library")
def library(include_body: bool = False):
    """List all pages. Pass ?include_body=true to include full markdown body."""
    vp = vault_path()
    conn = open_db(vp)
    rows = list_pages(conn)
    items = []
    for r in rows:
        tags = r.get("tags", "[]")
        try:
            tag_list = json.loads(tags) if isinstance(tags, str) else tags
        except json.JSONDecodeError:
            tag_list = []
        slug = r["slug"]
        item = {
            "slug": slug,
            "path": r["path"],
            "title": r["title"],
            "type": r["type"],
            "platform": r.get("platform", ""),
            "url": r.get("url", ""),
            "summary": r.get("summary", ""),
            "tags": tag_list,
            "created": r.get("created", ""),
            "updated": r.get("updated", ""),
        }
        if include_body:
            md_path = vp / r["path"]
            item["body"] = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
        items.append(item)
    return {"items": items}


def _safe_md_path(slug: str) -> Path:
    """Resolve slug to a markdown file inside vault, blocking directory traversal."""
    vp = vault_path().resolve()
    resolved = (vp / f"{slug}.md").resolve()
    if not resolved.is_relative_to(vp):
        raise HTTPException(400, "invalid path")
    return resolved


@app.get("/v1/pages/{slug:path}")
def get_page(slug: str):
    md_path = _safe_md_path(slug)
    if not md_path.exists():
        raise HTTPException(404, "not found")
    raw = md_path.read_text(encoding="utf-8")
    # Strip frontmatter so save_page doesn't duplicate it
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            body = parts[2].lstrip("\n")
        else:
            body = raw
    else:
        body = raw
    return {
        "slug": slug,
        "path": f"{slug}.md",
        "title": slug.split("/")[-1],
        "type": "article",
        "platform": "",
        "url": "",
        "summary": "",
        "tags": [],
        "created": "",
        "updated": "",
        "body": body,
    }


@app.get("/v1/search")
def search_notes(q: str = "", limit: int = 20):
    import jieba

    from engine.index.db import fts_search, open_db
    from engine.paths import vault_dir

    if not q.strip():
        return {"results": []}

    vp = vault_dir()
    db_path = vp / ".content-app" / "index.db"
    if not db_path.exists():
        return {"results": []}

    conn = open_db(vp)
    # Tokenize query with jieba for better Chinese matching
    tokens = " ".join(jieba.cut(q))
    results = fts_search(conn, tokens, limit=limit)
    return {"results": results}


@app.put("/v1/pages/{slug:path}")
def save_page(slug: str, body: dict):
    import hashlib

    from engine.index.db import fts_rebuild, open_db
    from engine.paths import vault_dir

    vp = vault_dir()
    db_path = vp / ".content-app" / "index.db"
    if not db_path.exists():
        raise HTTPException(404, "Index not found")

    new_body = body.get("body", "")
    if not isinstance(new_body, str):
        raise HTTPException(400, "body must be a string")

    conn = open_db(vp)
    try:
        # Get current page info
        row = conn.execute("SELECT path, title FROM pages WHERE slug=?", (slug,)).fetchone()
        if not row:
            raise HTTPException(404, "Page not found")

        page_path = row[0]

        # Read existing file to preserve frontmatter
        md_path = vp / page_path
        if not md_path.exists():
            raise HTTPException(404, "File not found")

        existing = md_path.read_text(encoding="utf-8")

        # Split frontmatter and body
        if existing.startswith("---"):
            parts = existing.split("---", 2)
            if len(parts) >= 3:
                frontmatter = f"---{parts[1]}---\n"
            else:
                frontmatter = ""
        else:
            frontmatter = ""

        # Write new content
        full_content = frontmatter + new_body
        md_path.write_text(full_content, encoding="utf-8")

        # Update DB metadata (body, body_hash, mtime) WITHOUT touching links
        body_hash = hashlib.sha256(new_body.encode()).hexdigest()[:16]
        file_mtime = md_path.stat().st_mtime
        from datetime import datetime

        conn.execute(
            "UPDATE pages SET body=?, body_hash=?, file_mtime=?, updated=? WHERE slug=?",
            (new_body, body_hash, file_mtime, datetime.now().isoformat(), slug),
        )
        conn.commit()

        # Rebuild FTS
        fts_rebuild(conn)

        return {"ok": True}
    finally:
        pass  # Don't close pooled connection


@app.get("/v1/export/{slug:path}")
def export_page(slug: str):
    md_path = _safe_md_path(slug)
    if not md_path.exists():
        raise HTTPException(404, "not found")
    return PlainTextResponse(md_path.read_text(encoding="utf-8"), media_type="text/markdown")


@app.get("/v1/links/backlinks")
def get_backlinks(slug: str):
    from engine.index.db import get_backlinks, open_db
    from engine.paths import vault_dir
    vp = vault_dir()
    db_path = vp / ".content-app" / "index.db"
    if not db_path.exists():
        return {"backlinks": []}
    conn = open_db(vp)
    rows = get_backlinks(conn, slug)
    return {"backlinks": rows}


class CreateLinkPayload(BaseModel):
    source_slug: str
    target_slug: str


@app.post("/v1/links/create")
def create_link(body: CreateLinkPayload):
    from engine.index.db import open_db, upsert_link
    from engine.paths import vault_dir

    vp = vault_dir()
    db_path = vp / ".content-app" / "index.db"
    if not db_path.exists():
        raise HTTPException(404, "Index not found")

    conn = open_db(vp)
    # Get both titles
    rows = conn.execute(
        "SELECT slug, title FROM pages WHERE slug IN (?, ?)",
        (body.source_slug, body.target_slug),
    ).fetchall()
    title_map = {r[0]: r[1] for r in rows}
    source_title = title_map.get(body.source_slug, body.source_slug)
    target_title = title_map.get(body.target_slug, body.target_slug)

    # A -> B
    upsert_link(conn, body.source_slug, body.target_slug, f"[[{target_title}]]")
    # B -> A (bidirectional)
    upsert_link(conn, body.target_slug, body.source_slug, f"[[{source_title}]]")
    conn.commit()

    # Append wikilinks to both markdown files
    _append_wikilink_to_file(vp, body.source_slug, target_title)
    _append_wikilink_to_file(vp, body.target_slug, source_title)

    return {"ok": True}


def _append_wikilink_to_file(vp: Path, source_slug: str, target_title: str) -> None:
    """Append a wikilink to the source note's markdown file."""
    md_path = (vp / f"{source_slug}.md").resolve()
    if not md_path.is_relative_to(vp.resolve()):
        return  # Safety: block directory traversal
    if not md_path.exists():
        return

    wikilink = f"\n\n[[{target_title}]]\n"
    with md_path.open("a", encoding="utf-8") as f:
        f.write(wikilink)


def _cleanup_wikilinks_for_deleted(vp: Path, deleted_title: str, conn) -> None:
    """Remove wikilinks referencing the deleted page from all .md files in the vault."""
    import re

    wikilink_re = re.compile(r'\[\[' + re.escape(deleted_title) + r'(?:\|[^\]]+)?\]\]')

    for md_file in vp.rglob("*.md"):
        # Skip the file that's being deleted (if it still exists)
        try:
            if not md_file.is_relative_to(vp.resolve()):
                continue
        except (ValueError, OSError):
            continue
        try:
            text = md_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        new_text = wikilink_re.sub(deleted_title, text)
        if new_text != text:
            try:
                md_file.write_text(new_text, encoding="utf-8")
            except OSError:
                pass


@app.delete("/v1/pages/{slug:path}")
def delete_page(slug: str):
    from engine.index.db import delete_links_for_source, open_db
    from engine.paths import vault_dir

    vp = vault_dir()
    db_path = vp / ".content-app" / "index.db"
    if not db_path.exists():
        raise HTTPException(404, "Index not found")

    conn = open_db(vp)
    # Get the page info
    row = conn.execute("SELECT path, title FROM pages WHERE slug=?", (slug,)).fetchone()
    if not row:
        raise HTTPException(404, "Page not found")

    page_path = row[0]
    page_title = row[1]

    # Delete outgoing links
    delete_links_for_source(conn, slug)

    # Delete incoming links (other pages linking to this one)
    conn.execute("DELETE FROM links WHERE target_slug=?", (slug,))
    conn.commit()

    # Delete from pages table
    conn.execute("DELETE FROM pages WHERE slug=?", (slug,))
    conn.commit()

    # Delete the actual file
    file_path = vp / page_path
    try:
        resolved = file_path.resolve()
        if resolved.exists() and resolved.is_relative_to(vp.resolve()):
            resolved.unlink()
    except OSError:
        pass

    # Clean up wikilinks referencing this page from other markdown files
    _cleanup_wikilinks_for_deleted(vp, page_title, conn)

    return {"ok": True, "deleted": slug}


@app.get("/v1/pages/{slug:path}/ink")
def get_note_ink(slug: str):
    vp = vault_dir()
    db_path = vp / ".content-app" / "index.db"
    if not db_path.exists():
        return {"strokes": []}

    conn = open_db(vp)
    row = conn.execute("SELECT path FROM pages WHERE slug=?", (slug,)).fetchone()
    if not row:
        return {"strokes": []}
    page_path = row[0]

    md_path = vp / page_path
    ink_path = md_path.with_suffix('.ink.json')

    if not ink_path.exists():
        return {"strokes": []}

    try:
        data = json.loads(ink_path.read_text(encoding="utf-8"))
        return {"strokes": data.get("strokes", [])}
    except Exception:
        return {"strokes": []}


@app.put("/v1/pages/{slug:path}/ink")
def save_note_ink(slug: str, body: dict):
    vp = vault_dir()
    db_path = vp / ".content-app" / "index.db"
    if not db_path.exists():
        raise HTTPException(404, "Index not found")

    conn = open_db(vp)
    row = conn.execute("SELECT path FROM pages WHERE slug=?", (slug,)).fetchone()
    if not row:
        raise HTTPException(404, "Page not found")
    page_path = row[0]

    md_path = vp / page_path
    ink_path = md_path.with_suffix('.ink.json')

    if not ink_path.is_relative_to(vp.resolve()):
        raise HTTPException(400, "Invalid path")

    strokes = body.get("strokes", [])
    ink_path.write_text(json.dumps({"strokes": strokes}, ensure_ascii=False), encoding="utf-8")

    return {"ok": True}


@app.get("/v1/links/graph")
def get_graph():
    from engine.index.db import get_all_links, open_db
    from engine.paths import vault_dir
    vp = vault_dir()
    db_path = vp / ".content-app" / "index.db"
    if not db_path.exists():
        return {"nodes": [], "edges": []}
    conn = open_db(vp)
    # Get all pages as nodes
    rows = conn.execute(
        "SELECT slug, title, type, summary, tags FROM pages"
    ).fetchall()
    nodes = []
    for r in rows:
        nodes.append({
            "slug": r[0],
            "title": r[1],
            "type": r[2],
            "summary": r[3],
            "tags": json.loads(r[4]) if r[4] else [],
        })
    # Get all links as edges
    edges = get_all_links(conn)
    return {"nodes": nodes, "edges": edges}


@app.post("/v1/ingest")
def ingest(req: IngestRequest):
    _cleanup_stale_jobs()
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {
            "status": "processing",
            "progress": {"stage": "resolve", "percent": 10, "message": ""},
            "url": req.url,
            "_created_at": _time.time(),
        }
    threading.Thread(
        target=_run_ingest,
        args=(job_id, req.url.strip(), req.output_language, req.prompt_template, req.output_format),
        daemon=True,
    ).start()
    return {"job_id": job_id}


@app.get("/v1/jobs/{job_id}")
def job_status(job_id: str):
    _cleanup_stale_jobs()
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return {
        "status": job["status"],
        "progress": job.get("progress"),
        "error": job.get("error"),
        "result_slug": job.get("result_slug"),
        "logs": job.get("logs", []),
    }


@app.get("/v1/logs")
def get_logs(limit: int = 100, level: str | None = None, job_id: str | None = None):
    """Recent sidecar log lines for debugging."""
    from engine.app_log import recent_logs

    return {"entries": recent_logs(limit=limit, level=level, job_id=job_id)}


@app.post("/v1/index/rebuild")
def index_rebuild():
    n = rebuild_from_vault(vault_path())
    return {"rebuilt": n}


class CanvasAssetPayload(BaseModel):
    data: str
    mimeType: str
    name: str = ""


@app.get("/v1/thinking-canvas")
def get_thinking_canvas():
    from engine.thinking_canvas.store import load_document

    return load_document()


@app.put("/v1/thinking-canvas")
def put_thinking_canvas(body: dict[str, Any]):
    from engine.thinking_canvas.store import save_document

    return save_document(body)


@app.post("/v1/thinking-canvas/assets")
def post_thinking_canvas_asset(body: CanvasAssetPayload):
    import base64

    from engine.thinking_canvas.store import save_asset

    try:
        raw = base64.b64decode(body.data)
    except Exception as exc:
        raise HTTPException(400, f"invalid base64: {exc}") from exc
    return save_asset(raw, body.mimeType, name=body.name)


@app.get("/v1/thinking-canvas/assets/{asset_id}")
def get_thinking_canvas_asset(asset_id: str):
    from fastapi.responses import Response

    from engine.thinking_canvas.store import read_asset

    try:
        data, mime = read_asset(asset_id)
    except FileNotFoundError:
        raise HTTPException(404, "asset not found") from None
    return Response(content=data, media_type=mime)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=SIDECAR_PORT)
    args = parser.parse_args()

    # 1. Prepare app directories
    ensure_app_dirs()
    _inject_bundled_ffmpeg()
    if not _ensure_pid_dir():
        logger.warning("PID file directory unavailable — PID management disabled")

    # 2. Handle stale old instance (PID file + port conflict)
    _handle_old_instance(args.port)

    # 3. Register cleanup handler
    # Note: SIGTERM/SIGINT handlers are NOT registered here because uvicorn
    # overrides them with its own handlers. Instead, we rely on:
    #   - FastAPI lifespan (yield-based shutdown) as primary
    #   - atexit as fallback for unexpected exits
    atexit.register(_cleanup_runtime)

    # 4. Write PID file for this instance
    pid_path = _pid_file_path()
    if _ensure_pid_dir():
        write_pid_file(str(pid_path))
        logger.info("Sidecar starting (pid=%d, port=%d)", os.getpid(), args.port)

    # 5. Run server (blocks until shutdown)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
