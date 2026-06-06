"""Persisted runtime preferences (preset + per-modality routing)."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from engine.paths import app_data_root, ensure_app_dirs

_lock = threading.RLock()
_CACHE: dict[str, Any] | None = None


def _state_path() -> Path:
    ensure_app_dirs()
    return app_data_root() / "runtime" / "state.json"


def load_state() -> dict[str, Any]:
    global _CACHE
    with _lock:
        if _CACHE is not None:
            return dict(_CACHE)
        path = _state_path()
        if not path.exists():
            _CACHE = {}
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {}
        except (json.JSONDecodeError, OSError):
            data = {}
        _CACHE = data
        return dict(data)


def save_state(patch: dict[str, Any]) -> dict[str, Any]:
    global _CACHE
    with _lock:
        current = load_state()
        current.update(patch)
        path = _state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        _CACHE = current
        return dict(current)


def get_selected_preset_id() -> str | None:
    value = load_state().get("selected_preset_id")
    return str(value) if value else None


def set_selected_preset_id(preset_id: str) -> None:
    save_state({"selected_preset_id": preset_id})


def get_modality_models() -> dict[str, str]:
    raw = load_state().get("modality_models", {})
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v}


def set_modality_models(models: dict[str, str]) -> None:
    save_state({"modality_models": models})


def set_modality_model(modality: str, model: str) -> None:
    current = get_modality_models()
    current[modality] = model
    set_modality_models(current)
