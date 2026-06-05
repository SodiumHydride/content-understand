#!/usr/bin/env python3
"""Local HTTP API for the Electron UI."""

from __future__ import annotations

import argparse
import json
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.index.db import list_pages, open_db
from engine.index.rebuild import rebuild_from_vault, upsert_single_file
from engine.paths import ensure_app_dirs, vault_dir
from engine.config_bridge import settings_to_config
from engine.runtime.manager import get_runtime_manager
from engine.runtime.presets import recommend_preset, list_presets
from engine.runtime.hardware import probe_hardware
from engine.understand.orchestrate import understand_url
from engine.write.markdown import write_result

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import PlainTextResponse
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("Install sidecar deps: pip install fastapi uvicorn pydantic requests", file=sys.stderr)
    sys.exit(1)

@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_app_dirs()
    yield


app = FastAPI(title="Content Understand Sidecar", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


class ConfigPayload(BaseModel):
    settings: dict[str, Any]


class RuntimeSetupPayload(BaseModel):
    preset_id: str | None = None
    prefer_ollama: bool = False
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


def _run_ingest(job_id: str, url: str) -> None:
    if not _engine_config:
        with _jobs_lock:
            _jobs[job_id].update(
                {
                    "status": "failed",
                    "error": "No engine config. Open Settings → Models, configure an API key, and click Save.",
                    "progress": _map_progress("model", 0, "no config"),
                    "_done_at": _time.time(),
                }
            )
        return
    cfg = settings_to_config(_engine_config)

    def on_progress(stage: str, percent: int, message: str) -> None:
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id]["progress"] = _map_progress(stage, percent, message)

    try:
        on_progress("resolve", 10, "")
        if Path(url).expanduser().is_file():
            from engine.understand.orchestrate import understand_path

            result = understand_path(url, config=cfg, on_progress=on_progress)
        else:
            result = understand_url(url, config=cfg, on_progress=on_progress)

        on_progress("write", 90, "")
        vp = vault_path()
        path = write_result(vp, result)
        slug = str(path.relative_to(vp).with_suffix("")).replace("\\", "/")
        upsert_single_file(vp, path)

        with _jobs_lock:
            _jobs[job_id].update(
                {
                    "status": "completed",
                    "progress": _map_progress("write", 100, ""),
                    "result_slug": slug,
                    "_done_at": _time.time(),
                }
            )
    except Exception as exc:
        with _jobs_lock:
            _jobs[job_id].update(
                {
                    "status": "failed",
                    "error": str(exc)[:500],
                    "progress": _map_progress("model", 0, str(exc)[:200]),
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
    rt.setup_async(body.preset_id, prefer_ollama=body.prefer_ollama)
    return {"ok": True, "state": rt.state}


@app.post("/v1/runtime/stop")
def runtime_stop():
    get_runtime_manager().stop()
    return {"ok": True}


@app.post("/v1/runtime/auto-detect")
def runtime_auto_detect():
    """Startup auto-detection: Ollama > existing GGUF > idle."""
    rt = get_runtime_manager()
    if rt.state == "ready":
        return {"backend": rt.backend, "url": rt.local_base_url, "state": "ready"}

    rt.refresh_hardware()

    # Fast path: Ollama already running — just mark ready, no async needed
    from engine.runtime.ollama import detect_ollama

    ollama = detect_ollama(timeout=1.0)
    if ollama.get("available"):
        rt.mark_ollama_ready(ollama["base_url"])
        return {"backend": "ollama", "url": ollama["base_url"], "state": "ready"}

    # Check if GGUF already downloaded
    from engine.runtime.download import preset_model_paths
    from engine.runtime.presets import recommend_preset
    from engine.paths import models_dir

    preset = recommend_preset(rt.hardware)
    main_gguf, mmproj = preset_model_paths(preset, models_dir())
    if main_gguf and main_gguf.exists():
        # Model exists, start server in background
        rt.setup_async(preset["id"], prefer_ollama=False)
        return {"backend": "llama_server", "state": "starting", "preset": preset["id"]}

    # Nothing available
    rt.mark_idle()
    return {
        "backend": None,
        "state": "idle",
        "recommendation": preset.get("id"),
        "hardware": rt.hardware.to_dict() if rt.hardware else None,
    }


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
    body = md_path.read_text(encoding="utf-8")
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


@app.get("/v1/export/{slug:path}")
def export_page(slug: str):
    md_path = _safe_md_path(slug)
    if not md_path.exists():
        raise HTTPException(404, "not found")
    return PlainTextResponse(md_path.read_text(encoding="utf-8"), media_type="text/markdown")


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
    threading.Thread(target=_run_ingest, args=(job_id, req.url.strip()), daemon=True).start()
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
    }


@app.post("/v1/index/rebuild")
def index_rebuild():
    n = rebuild_from_vault(vault_path())
    return {"rebuilt": n}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=17890)
    args = parser.parse_args()
    ensure_app_dirs()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
