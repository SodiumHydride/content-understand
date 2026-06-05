#!/usr/bin/env python3
"""Verify llama.cpp release assets for macOS / Windows / Linux (no model download)."""

from __future__ import annotations

import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.runtime.llama_install import LLAMA_RELEASE_BASE, LLAMA_RELEASE_TAG

ASSETS = {
    "darwin-arm64": f"llama-{LLAMA_RELEASE_TAG}-bin-macos-arm64.tar.gz",
    "darwin-x64": f"llama-{LLAMA_RELEASE_TAG}-bin-macos-x64.tar.gz",
    "win-x64": f"llama-{LLAMA_RELEASE_TAG}-bin-win-cpu-x64.zip",
    "win-arm64": f"llama-{LLAMA_RELEASE_TAG}-bin-win-cpu-arm64.zip",
    "linux-x64": f"llama-{LLAMA_RELEASE_TAG}-bin-ubuntu-x64.tar.gz",
}


def check_zip_has_server(archive: Path) -> bool:
    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        return any(n.endswith("llama-server.exe") for n in names)


def main() -> int:
    ok = 0
    for key, name in ASSETS.items():
        url = f"{LLAMA_RELEASE_BASE}/{name}"
        print(f"Checking {key}: {name}")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / name
                urlretrieve(url, path)
                size_mb = path.stat().st_size / (1024 * 1024)
                if name.endswith(".zip"):
                    if not check_zip_has_server(path):
                        print("  FAIL: no llama-server.exe in zip")
                        continue
                print(f"  OK ({size_mb:.1f} MB)")
                ok += 1
        except Exception as exc:
            print(f"  FAIL: {exc}")
    print(f"\n{ok}/{len(ASSETS)} assets reachable")
    return 0 if ok == len(ASSETS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
