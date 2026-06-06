"""Load curated Ollama model presets and map hardware → recommendation."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from engine.runtime.hardware import HardwareProfile

_PRESETS_PATH = Path(__file__).with_name("presets.json")

# Tier quality ranking — higher = more capable model
_TIER_RANK = {
    "ultra_lite": 0,
    "cpu_lite": 1,
    "cpu_balanced": 2,
    "balanced": 3,
    "quality": 4,
    "high_quality": 5,
}


@lru_cache
def load_presets() -> dict[str, Any]:
    with open(_PRESETS_PATH, encoding="utf-8") as f:
        return json.load(f)


def list_presets() -> list[dict[str, Any]]:
    return load_presets().get("presets", [])


def get_preset(preset_id: str) -> dict[str, Any] | None:
    if not preset_id:
        return None
    for p in list_presets():
        if p["id"] == preset_id:
            return p
        if preset_id in p.get("legacy_ids", []):
            return p
    return None


def recommend_preset(hw: HardwareProfile) -> dict[str, Any]:
    """Pick the best preset for this machine.

    Strategy:
    1. Filter presets by min_ram_gb / min_vram_gb / min_unified_memory_gb
    2. For discrete GPU: if VRAM is the bottleneck, use VRAM as the primary
       constraint (model runs in GPU memory, not system RAM)
    3. Among eligible presets, score by: tier rank (desc) → modality count (desc)
       → download size (asc, as tiebreaker)
    4. CPU-only machines: only cpu_recommended presets
    """
    presets = list_presets()
    ram = hw.ram_gb
    vram = hw.vram_gb
    unified = hw.apple_unified_memory

    eligible = []
    for p in presets:
        min_ram = p.get("min_ram_gb", 0)
        min_vram = p.get("min_vram_gb", 0)
        min_unified = p.get("min_unified_memory_gb", 0)

        if unified:
            if min_unified and ram < min_unified:
                continue
            if ram < min_ram:
                continue
        else:
            if min_vram and vram >= min_vram:
                pass
            elif ram < min_ram:
                continue

        if hw.cpu_only and not p.get("cpu_recommended", False):
            continue

        eligible.append(p)

    if not eligible:
        return _pick_smallest(presets)

    def _score(p: dict) -> tuple:
        tier = _TIER_RANK.get(p.get("tier", ""), -1)
        modality_count = len(p.get("modalities", []))
        download_gb = p.get("download_size_gb", 999)
        return (-tier, -modality_count, download_gb)

    eligible.sort(key=_score)
    return eligible[0]


def _pick_smallest(presets: list[dict]) -> dict[str, Any]:
    if not presets:
        return {}
    return min(presets, key=lambda p: p.get("download_size_gb", 999))


def recommendation_summary(hw: HardwareProfile, preset: dict[str, Any], lang: str = "zh") -> str:
    data = load_presets()
    notes = data.get("hardware_notes", {})
    lines = [
        f"RAM {hw.ram_gb:.0f} GB",
        f"GPU: {hw.gpu_vendor}" + (f" ({hw.vram_gb:.0f} GB VRAM)" if hw.vram_gb else ""),
    ]
    if hw.cpu_only:
        lines.append(notes.get("cpu_only_zh" if lang == "zh" else "cpu_only_en", ""))
    elif hw.gpu_vendor == "apple":
        lines.append(notes.get("apple_silicon_zh" if lang == "zh" else "apple_silicon_en", ""))
    elif hw.gpu_vendor == "nvidia":
        lines.append(notes.get("nvidia_zh" if lang == "zh" else "nvidia_en", ""))

    label = preset.get("label_zh" if lang == "zh" else "label_en", preset.get("id", ""))
    modalities = ", ".join(preset.get("modalities", []))
    ollama_model = preset.get("ollama_model", "")
    lines.append(f"推荐: {label}")
    lines.append(f"模态: {modalities}")
    if ollama_model:
        lines.append(f"Ollama 模型: {ollama_model}")

    return "\n".join(x for x in lines if x)


def suggest_ollama_pull(preset: dict) -> str | None:
    name = preset.get("ollama_model")
    return f"ollama pull {name}" if name else None
