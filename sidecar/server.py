#!/usr/bin/env python3
"""Local HTTP API for the Electron UI."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Repo root on path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.index.db import open_db, list_pages
from engine.index.rebuild import rebuild_from_vault
from engine.write.markdown import write_result

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("Install sidecar deps: pip install fastapi uvicorn pydantic", file=sys.stderr)
    sys.exit(1)

app = FastAPI(title="Content Understand Sidecar", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, dict] = {}


def vault_path() -> Path:
    raw = os.environ.get("CONTENT_VAULT", str(Path.home() / "ContentVault"))
    p = Path(raw).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    for sub in ("video", "image", "audio", "article"):
        (p / sub).mkdir(exist_ok=True)
    return p


class IngestRequest(BaseModel):
    url: str


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/v1/library")
def library():
    vp = vault_path()
    conn = open_db(vp)
    rows = list_pages(conn)
    conn.close()
    items = []
    for r in rows:
        tags = r.get("tags", "[]")
        try:
            tag_list = json.loads(tags) if isinstance(tags, str) else tags
        except json.JSONDecodeError:
            tag_list = []
        slug = r["slug"]
        md_path = vp / r["path"]
        body = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
        items.append(
            {
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
                "body": body,
            }
        )
    return {"items": items}


@app.get("/v1/pages/{slug:path}")
def get_page(slug: str):
    vp = vault_path()
    md_path = vp / f"{slug}.md"
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


@app.post("/v1/ingest")
def ingest(req: IngestRequest):
    job_id = uuid.uuid4().hex
    _jobs[job_id] = {
        "status": "processing",
        "progress": {"stage": "resolve", "percent": 10, "message": ""},
        "url": req.url,
    }

    # Placeholder pipeline — wire engine.ingest.understand here
    _jobs[job_id]["progress"] = {"stage": "model", "percent": 60, "message": ""}
    result = {
        "type": "video",
        "title": "Sidecar placeholder",
        "url": req.url,
        "platform": "web",
        "author": "",
        "summary": "## 摘要\n\n引擎占位：将接入 sodium `video_understand` 理解链。\n\n## 要点\n\n- 配置 CONTENT_VAULT\n- 设置 API Key\n",
        "tags": ["placeholder"],
    }
    path = write_result(vault_path(), result)
    slug = str(path.relative_to(vault_path()).with_suffix(""))
    rebuild_from_vault(vault_path())

    _jobs[job_id].update(
        {
            "status": "completed",
            "progress": {"stage": "write", "percent": 100, "message": ""},
            "result_slug": slug.replace("\\", "/"),
        }
    )
    return {"job_id": job_id}


@app.get("/v1/jobs/{job_id}")
def job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return {
        "status": job["status"],
        "progress": job.get("progress"),
        "error": job.get("error"),
    }


@app.post("/v1/index/rebuild")
def index_rebuild():
    n = rebuild_from_vault(vault_path())
    return {"rebuilt": n}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=17890)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
