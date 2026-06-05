"""Locate llama-server / llama binary."""

from __future__ import annotations

import platform
import shutil
import stat
from pathlib import Path


def find_llama_server(runtime_dir: Path) -> Path | None:
    """Search PATH then bundled runtime directory."""
    names = (
        ["llama-server", "llama"]
        if platform.system().lower() != "windows"
        else ["llama-server.exe", "llama.exe", "llama-server", "llama"]
    )
    for name in names:
        found = shutil.which(name)
        if found:
            return Path(found)

    system = platform.system().lower()
    arch = platform.machine().lower()
    sub = _platform_subdir(system, arch)
    if not sub:
        return None

    bundled_names = (
        ("llama-server", "llama")
        if system != "windows"
        else ("llama-server.exe", "llama.exe", "llama-server", "llama")
    )
    for bn in bundled_names:
        for base in (
            runtime_dir / "llama" / sub,
            runtime_dir,
        ):
            candidate = base / bn
            if candidate.is_file():
                return candidate
    return None


def _platform_subdir(system: str, arch: str) -> str | None:
    if system == "darwin":
        if arch in ("arm64", "aarch64"):
            return "macos-arm64"
        return "macos-x64"
    if system == "linux":
        if arch in ("arm64", "aarch64"):
            return "linux-arm64"
        return "linux-x64"
    if system == "windows":
        if arch in ("arm64", "aarch64"):
            return "win-cpu-arm64"
        return "win-cpu-x64"
    return None


def ensure_executable(path: Path) -> None:
    if platform.system() != "Windows" and path.is_file():
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
