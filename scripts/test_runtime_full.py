#!/usr/bin/env python3
"""Integration test: llama binary + optional GGUF preset + server health.

Usage:
  python3 scripts/test_runtime_full.py --bin-only
  python3 scripts/test_runtime_full.py --preset gemma4-e2b-lite
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.paths import app_data_root, ensure_app_dirs
from engine.runtime.llama_install import ensure_llama_server_binary
from engine.runtime.manager import get_runtime_manager


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bin-only", action="store_true", help="Only fetch llama-server binary")
    parser.add_argument("--preset", default="", help="Preset id for full setup")
    args = parser.parse_args()

    ensure_app_dirs()
    runtime_root = app_data_root() / "runtime"

    print("Platform:", sys.platform)
    print("Runtime dir:", runtime_root)

    def prog(stage: str, pct: int, msg: str) -> None:
        print(f"  [{stage}] {pct}% {msg}")

    if args.bin_only:
        path = ensure_llama_server_binary(runtime_root, on_progress=prog)
        print("OK llama-server:", path)
        return 0

    preset = args.preset or "gemma4-e2b-lite"
    rt = get_runtime_manager()
    rt.setup_async(preset, prefer_ollama=False, on_progress=prog)

    for _ in range(600):
        st = rt.status()
        print(json.dumps({"state": st["state"], "message": st["message"], "progress": st["progress"]}, ensure_ascii=False))
        if st["state"] in ("ready", "error"):
            break
        time.sleep(2)

    st = rt.status()
    if st["state"] == "ready":
        print("OK local_base_url:", st["local_base_url"])
        return 0
    print("FAIL:", st["message"])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
