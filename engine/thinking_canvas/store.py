"""File-backed thinking canvas — JSON document + asset blobs.

Layout under app data:
  thinking/
    canvas.json
    assets/{asset_id}.{ext}
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any

from engine.paths import app_data_root, ensure_app_dirs

logger = logging.getLogger(__name__)

CANVAS_FILE = "canvas.json"
SCHEMA_VERSION = 1
_ASSET_ID_RE = re.compile(r"^[a-f0-9-]{36}$", re.I)
_EXT_BY_MIME: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def canvas_dir() -> Path:
    ensure_app_dirs()
    root = app_data_root() / "thinking"
    root.mkdir(parents=True, exist_ok=True)
    return root


def assets_dir() -> Path:
    d = canvas_dir() / "assets"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _canvas_path() -> Path:
    return canvas_dir() / CANVAS_FILE


def empty_document() -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "revision": 0,
        "elements": [],
    }


def load_document() -> dict[str, Any]:
    path = _canvas_path()
    if not path.exists():
        return empty_document()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("canvas root must be object")
        if "schemaVersion" not in data:
            data["schemaVersion"] = 1
        if "elements" not in data or not isinstance(data["elements"], list):
            data["elements"] = []
        if "revision" not in data:
            data["revision"] = 0
        return data
    except Exception as exc:
        logger.error("Failed to load thinking canvas: %s", exc)
        return empty_document()


def save_document(data: dict[str, Any]) -> dict[str, Any]:
    path = _canvas_path()
    canvas_dir().mkdir(parents=True, exist_ok=True)
    revision = int(data.get("revision") or 0) + 1
    payload = {
        **data,
        "schemaVersion": SCHEMA_VERSION,
        "revision": revision,
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return payload


def _safe_asset_id(asset_id: str) -> str:
    clean = asset_id.strip()
    if not _ASSET_ID_RE.match(clean):
        raise ValueError("invalid asset id")
    return clean


def asset_path(asset_id: str, mime_type: str = "") -> Path:
    aid = _safe_asset_id(asset_id)
    ext = _EXT_BY_MIME.get(mime_type.lower(), "")
    if not ext:
        existing = list(assets_dir().glob(f"{aid}.*"))
        if existing:
            return existing[0]
        ext = ".bin"
    return assets_dir() / f"{aid}{ext}"


def save_asset(data: bytes, mime_type: str, *, name: str = "") -> dict[str, str]:
    if not data:
        raise ValueError("empty asset")
    asset_id = str(uuid.uuid4())
    ext = _EXT_BY_MIME.get(mime_type.lower(), ".bin")
    path = assets_dir() / f"{asset_id}{ext}"
    path.write_bytes(data)
    logger.info("Saved canvas asset %s (%s, %d bytes)", asset_id, mime_type, len(data))
    return {"assetId": asset_id, "mimeType": mime_type, "name": name or path.name}


def read_asset(asset_id: str) -> tuple[bytes, str]:
    aid = _safe_asset_id(asset_id)
    matches = list(assets_dir().glob(f"{aid}.*"))
    if not matches:
        raise FileNotFoundError(asset_id)
    path = matches[0]
    ext = path.suffix.lower()
    mime = next((m for m, e in _EXT_BY_MIME.items() if e == ext), "application/octet-stream")
    return path.read_bytes(), mime


def delete_asset(asset_id: str) -> bool:
    aid = _safe_asset_id(asset_id)
    removed = False
    for path in assets_dir().glob(f"{aid}.*"):
        path.unlink(missing_ok=True)
        removed = True
    return removed
