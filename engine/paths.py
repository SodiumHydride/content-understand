"""Application data directories — always under the host app userData, never a random drive letter."""

from __future__ import annotations

import os
import platform
from pathlib import Path


def app_data_root() -> Path:
    raw = os.environ.get("CONTENT_APP_DATA", "").strip()
    if raw:
        return Path(raw).expanduser()
    # Match appPaths.ts: macOS → ~/Library/Application Support/<appName>/ContentUnderstand/
    #   Electron's app.getPath('userData') = ~/Library/Application Support/content-understand/
    #   appPaths.ts appends /ContentUnderstand/
    system = platform.system()
    if system == "Darwin":
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "content-understand"
            / "ContentUnderstand"
        )
    if system == "Windows":
        return Path.home() / ".content-understand"
    # Linux
    return Path.home() / ".content-understand"


def vault_dir() -> Path:
    override = os.environ.get("CONTENT_VAULT", "").strip()
    if override:
        return Path(override).expanduser()
    return app_data_root() / "vault"


def cache_dir() -> Path:
    override = os.environ.get("CONTENT_CACHE", "").strip()
    if override:
        return Path(override).expanduser()
    return app_data_root() / "cache"


def models_dir() -> Path:
    override = os.environ.get("CONTENT_MODELS", "").strip()
    if override:
        return Path(override).expanduser()
    return app_data_root() / "models"


def exports_dir() -> Path:
    return app_data_root() / "exports"


def ensure_app_dirs() -> dict[str, str]:
    """Create standard layout; return string paths for APIs."""
    root = app_data_root()
    vault = vault_dir()
    cache = cache_dir()
    models = models_dir()
    exports = exports_dir()

    for p in (root, vault, cache, models, exports):
        p.mkdir(parents=True, exist_ok=True)

    (root / "thinking" / "assets").mkdir(parents=True, exist_ok=True)

    for sub in ("video", "image", "audio", "article", "notes"):
        (vault / sub).mkdir(exist_ok=True)

    meta = vault / ".content-app"
    meta.mkdir(exist_ok=True)

    return {
        "appData": str(root),
        "vault": str(vault),
        "cache": str(cache),
        "models": str(models),
        "exports": str(exports),
    }
