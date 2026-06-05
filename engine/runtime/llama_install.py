"""Download official llama.cpp release binaries (macOS / Windows / Linux)."""

from __future__ import annotations

import logging
import platform
import shutil
import stat
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Callable
from urllib.request import urlretrieve

logger = logging.getLogger(__name__)

# Pin a recent release with Gemma 4 / mtmd support
LLAMA_RELEASE_TAG = "b9484"
LLAMA_RELEASE_BASE = f"https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_RELEASE_TAG}"

ProgressFn = Callable[[str, int, str], None]


def release_asset_for_platform() -> tuple[str, str] | None:
    """Return (download_url, archive_kind) where kind is tar.gz or zip."""
    system = platform.system().lower()
    arch = platform.machine().lower()
    tag = LLAMA_RELEASE_TAG

    if system == "darwin":
        if arch in ("arm64", "aarch64"):
            name = f"llama-{tag}-bin-macos-arm64.tar.gz"
            return f"{LLAMA_RELEASE_BASE}/{name}", "tar.gz"
        name = f"llama-{tag}-bin-macos-x64.tar.gz"
        return f"{LLAMA_RELEASE_BASE}/{name}", "tar.gz"

    if system == "windows":
        if arch in ("arm64", "aarch64"):
            name = f"llama-{tag}-bin-win-cpu-arm64.zip"
            return f"{LLAMA_RELEASE_BASE}/{name}", "zip"
        name = f"llama-{tag}-bin-win-cpu-x64.zip"
        return f"{LLAMA_RELEASE_BASE}/{name}", "zip"

    if system == "linux":
        if arch in ("arm64", "aarch64"):
            name = f"llama-{tag}-bin-ubuntu-arm64.tar.gz"
            return f"{LLAMA_RELEASE_BASE}/{name}", "tar.gz"
        name = f"llama-{tag}-bin-ubuntu-x64.tar.gz"
        return f"{LLAMA_RELEASE_BASE}/{name}", "tar.gz"

    return None


def _server_names() -> list[str]:
    if platform.system().lower() == "windows":
        return ["llama-server.exe", "llama.exe"]
    return ["llama-server", "llama"]


def ensure_llama_server_binary(
    runtime_dir: Path,
    on_progress: ProgressFn | None = None,
) -> Path:
    """Ensure llama-server exists under runtime_dir/llama/<platform>/."""
    from engine.runtime.llama_bin import _platform_subdir, ensure_executable, find_llama_server

    existing = find_llama_server(runtime_dir)
    if existing:
        return existing

    asset = release_asset_for_platform()
    if not asset:
        raise RuntimeError(f"Unsupported platform: {platform.system()} {platform.machine()}")

    url, kind = asset
    system = platform.system().lower()
    arch = platform.machine().lower()
    sub = _platform_subdir(system, arch)
    if not sub:
        raise RuntimeError("Could not resolve platform subdir")

    dest_root = runtime_dir / "llama" / sub
    dest_root.mkdir(parents=True, exist_ok=True)
    marker = dest_root / ".installed"
    if marker.exists():
        found = find_llama_server(runtime_dir)
        if found:
            return found

    if on_progress:
        on_progress("download", 15, "llama.cpp binary")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        archive = tmp_path / url.split("/")[-1]
        logger.info("Downloading %s", url)
        urlretrieve(url, archive)

        extract_dir = tmp_path / "extract"
        extract_dir.mkdir()
        if kind == "tar.gz":
            with tarfile.open(archive, "r:gz") as tf:
                try:
                    tf.extractall(extract_dir, filter="data")
                except TypeError:
                    tf.extractall(extract_dir)
        else:
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(extract_dir)

        copied = _copy_server_binary(extract_dir, dest_root)
        if not copied:
            raise RuntimeError(f"llama-server not found inside {url}")

        if system == "darwin":
            _strip_macos_quarantine(dest_root)

    marker.write_text(LLAMA_RELEASE_TAG, encoding="utf-8")
    found = find_llama_server(runtime_dir)
    if not found:
        raise RuntimeError("llama-server install failed")
    ensure_executable(found)
    if on_progress:
        on_progress("download", 20, "llama.cpp ready")
    return found


def _copy_server_binary(search_root: Path, dest_root: Path) -> bool:
    names = set(_server_names())
    for path in search_root.rglob("*"):
        if path.name in names and path.is_file():
            dest = dest_root / path.name
            shutil.copy2(path, dest)
            ensure_executable_local(dest)
            return True
    return False


def ensure_executable_local(path: Path) -> None:
    if platform.system().lower() == "windows":
        return
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _strip_macos_quarantine(root: Path) -> None:
    if platform.system().lower() != "darwin":
        return
    xattr = shutil.which("xattr")
    if not xattr:
        return
    try:
        import subprocess

        subprocess.run(
            [xattr, "-rd", "com.apple.quarantine", str(root)],
            check=False,
            capture_output=True,
        )
    except Exception:
        pass
