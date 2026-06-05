#!/usr/bin/env python3
"""Probe hardware + print Gemma 4 preset recommendation (no download)."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.runtime.hardware import probe_hardware
from engine.runtime.ollama import detect_ollama
from engine.runtime.presets import recommend_preset, recommendation_summary
from engine.runtime.llama_bin import find_llama_server
from engine.paths import app_data_root, ensure_app_dirs


def main() -> None:
    ensure_app_dirs()
    hw = probe_hardware()
    preset = recommend_preset(hw)
    ollama = detect_ollama()
    llama = find_llama_server(app_data_root() / "runtime")

    print("=== Hardware ===")
    print(json.dumps(hw.to_dict(), indent=2, ensure_ascii=False))
    print("\n=== Recommended preset ===")
    print(preset.get("id"), "-", preset.get("label_zh"))
    print("Download ~", preset.get("download_size_gb"), "GB")
    print("\n=== Notes (zh) ===")
    print(recommendation_summary(hw, preset, "zh"))
    print("\n=== Ollama ===")
    print(json.dumps(ollama, indent=2, ensure_ascii=False))
    print("\n=== llama-server ===")
    print(llama or "(not found — install: brew install llama.cpp)")


if __name__ == "__main__":
    main()
