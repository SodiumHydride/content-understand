"""Curated Ollama model catalog — backed by presets.json.

Preset models have curated metadata; non-preset (user-installed) models
are also surfaced so the user can select any locally available model.
"""

from __future__ import annotations

import logging
from typing import Any

from engine.runtime.hardware import HardwareProfile
from engine.runtime.presets import get_preset, list_presets, recommend_preset

logger = logging.getLogger(__name__)

_MODALITIES = ("video", "image", "audio", "article")


def _norm(name: str) -> str:
    """Normalize Ollama model name: strip, lowercase, remove :latest tag."""
    n = name.strip().lower()
    # Ollama appends :latest to names without an explicit tag
    if n.endswith(":latest"):
        n = n[:-7]
    return n


def catalog_entries() -> list[dict[str, Any]]:
    """All preset rows that declare an ``ollama_model``."""
    rows: list[dict[str, Any]] = []
    for preset in list_presets():
        model = (preset.get("ollama_model") or "").strip()
        if not model:
            continue
        rows.append(
            {
                "id": preset["id"],
                "preset_id": preset["id"],
                "ollama_model": model,
                "label_zh": preset.get("label_zh", preset["id"]),
                "label_en": preset.get("label_en", preset["id"]),
                "tier": preset.get("tier", ""),
                "modalities": list(preset.get("modalities", [])),
                "download_size_gb": preset.get("download_size_gb", 0),
                "min_ram_gb": preset.get("min_ram_gb", 0),
                "min_vram_gb": preset.get("min_vram_gb", 0),
                "cpu_recommended": preset.get("cpu_recommended", False),
                "ollama_note_zh": preset.get("ollama_note_zh", ""),
                "ollama_note_en": preset.get("ollama_note_en", ""),
            }
        )
    return rows


def allowed_model_names() -> set[str]:
    return {_norm(e["ollama_model"]) for e in catalog_entries()}


def preset_for_model(model_name: str) -> dict[str, Any] | None:
    target = _norm(model_name)
    for entry in catalog_entries():
        if _norm(entry["ollama_model"]) == target:
            return get_preset(entry["preset_id"])
    # Ollama may report tags with digest suffix — match prefix before @
    base = target.split("@", 1)[0]
    for entry in catalog_entries():
        if _norm(entry["ollama_model"]) == base:
            return get_preset(entry["preset_id"])
    return None


def preset_for_id(preset_id: str) -> dict[str, Any] | None:
    return get_preset(preset_id)


def validate_catalog_model(model_name: str) -> str:
    """Return canonical catalog model name or raise ValueError."""
    name = (model_name or "").strip()
    if not name:
        raise ValueError("model name required")
    preset = preset_for_model(name)
    if preset and preset.get("ollama_model"):
        return str(preset["ollama_model"])
    if _norm(name) in allowed_model_names():
        return name
    raise ValueError(f"Model '{name}' is not in the curated catalog")


def model_is_installed(raw_models: list[dict[str, Any]], model_name: str) -> bool:
    """True if a catalog model is present under any Ollama tag name."""
    want = preset_for_model(model_name)
    if want:
        want_id = want["id"]
        for raw in raw_models:
            installed = preset_for_model(str(raw.get("name", "")))
            if installed and installed["id"] == want_id:
                return True
        return False
    target = _norm(model_name)
    return any(_norm(str(m.get("name", ""))) == target for m in raw_models)


def validate_preset_pull(preset_id: str) -> tuple[str, dict[str, Any]]:
    preset = get_preset(preset_id)
    if not preset:
        raise ValueError(f"Unknown preset '{preset_id}'")
    model = (preset.get("ollama_model") or "").strip()
    if not model:
        raise ValueError(f"Preset '{preset_id}' has no ollama_model")
    return model, preset


def match_installed(installed_name: str) -> dict[str, Any] | None:
    """Map an Ollama-installed model name back to a catalog entry."""
    preset = preset_for_model(installed_name)
    if not preset:
        return None
    for entry in catalog_entries():
        if entry["preset_id"] == preset["id"]:
            return {**entry, "installed_name": installed_name}
    return None


def filter_installed_models(raw_models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only installed models that belong to the curated catalog."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_models:
        name = str(raw.get("name", "")).strip()
        entry = match_installed(name)
        if not entry:
            continue
        key = entry["preset_id"]
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "preset_id": entry["preset_id"],
                "ollama_model": entry["ollama_model"],
                "installed_name": name,
                "label_zh": entry["label_zh"],
                "label_en": entry["label_en"],
                "modalities": entry["modalities"],
                "size": raw.get("size", 0),
                "modified_at": raw.get("modified_at", ""),
                "details": raw.get("details"),
            }
        )
    return out


def build_catalog_view(
    *,
    installed_raw: list[dict[str, Any]],
    selected_preset_id: str | None,
    recommended_preset_id: str | None,
    source: str | None,
    running: bool,
    app_binary_installed: bool,
    models_dir: str,
    app_download_in_progress: bool = False,
    app_download_error: str | None = None,
    app_download_progress: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Merge presets with install state for the settings UI."""
    installed_by_preset = {
        m["preset_id"]: m for m in filter_installed_models(installed_raw)
    }
    presets_out: list[dict[str, Any]] = []
    for entry in catalog_entries():
        inst = installed_by_preset.get(entry["preset_id"])
        presets_out.append(
            {
                **entry,
                "installed": inst is not None,
                "installed_name": inst["installed_name"] if inst else None,
                "size": inst.get("size", 0) if inst else 0,
                "modified_at": inst.get("modified_at", "") if inst else "",
                "selected": entry["preset_id"] == selected_preset_id,
                "recommended": entry["preset_id"] == recommended_preset_id,
            }
        )
    installed_custom = installed_non_preset_models(installed_raw)
    return {
        "source": source,
        "running": running,
        "app_binary_installed": app_binary_installed,
        "app_download_in_progress": app_download_in_progress,
        "app_download_error": app_download_error,
        "app_download_progress": app_download_progress,
        "models_dir": models_dir,
        "selected_preset_id": selected_preset_id,
        "recommended_preset_id": recommended_preset_id,
        "presets": presets_out,
        "installed": list(installed_by_preset.values()),
        "installed_custom": installed_custom,
    }


def _guess_modalities(model_name: str) -> list[str]:
    """Heuristic modality guess from model name.

    Returns ``["image", "video"]`` for vision-language models,
    ``["article"]`` for text-only models.
    """
    lower = model_name.lower()
    if any(tag in lower for tag in ("vl", "vision", "gemma3", "llava", "minicpm-v", "internvl")):
        return ["image", "video"]
    return ["article"]


def installed_non_preset_models(
    raw_models: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return models installed in Ollama but NOT in the curated preset catalog.

    Each entry: ``{name, size, modified_at, details, modalities_guess}``
    """
    preset_norms = allowed_model_names()
    out: list[dict[str, Any]] = []
    for raw in raw_models:
        name = str(raw.get("name", "")).strip()
        if not name:
            continue
        if _norm(name) in preset_norms:
            continue
        # Also skip if a preset maps to this installed name
        if preset_for_model(name) is not None:
            continue
        out.append({
            "name": name,
            "size": raw.get("size", 0),
            "modified_at": raw.get("modified_at", ""),
            "details": raw.get("details"),
            "modalities_guess": _guess_modalities(name),
        })
    logger.debug("Found %d non-preset installed models", len(out))
    return out


def default_modality_models(preset: dict[str, Any] | None) -> dict[str, str]:
    """Use one catalog model for every modality supported by the preset."""
    if not preset:
        return {}
    model = str(preset.get("ollama_model", "")).strip()
    if not model:
        return {}
    supported = set(preset.get("modalities", []))
    return {m: model for m in _MODALITIES if m in supported}


def models_for_modality(
    modality: str,
    installed: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Installed catalog models that support a modality."""
    return [m for m in installed if modality in m.get("modalities", [])]


def recommend_preset_id(hw: HardwareProfile | None) -> str | None:
    if hw is None:
        return None
    preset = recommend_preset(hw)
    return preset.get("id") or None
