"""Download official llama.cpp release binaries (macOS / Windows / Linux).

Auto-update: checks GitHub releases for a newer version when the binary
already exists.  Uses a marker file to avoid checking too frequently.
"""

from __future__ import annotations

import json
import logging
import platform
import shutil
import stat
import tarfile
import tempfile
import time
import zipfile
from collections.abc import Callable
from pathlib import Path
from urllib.request import Request, urlopen, urlretrieve

logger = logging.getLogger(__name__)

# Minimum tag that supports Gemma 4 / mtmd
_MIN_TAG = "b9484"
_RELEASES_API = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
_CHECK_INTERVAL = 86400  # seconds between update checks (1 day)

ProgressFn = Callable[[str, int, str], None]


def _fetch_latest_tag() -> str | None:
    """Query GitHub for the latest llama.cpp release tag."""
    try:
        req = Request(_RELEASES_API, headers={"Accept": "application/vnd.github+json"})
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        tag = data.get("tag_name", "")
        return tag if tag else None
    except Exception:
        logger.debug("Failed to fetch latest llama.cpp release", exc_info=True)
        return None


def _installed_version(runtime_dir: Path) -> str | None:
    """Read the version from the .installed marker file."""
    from engine.runtime.llama_bin import _platform_subdir

    system = platform.system().lower()
    arch = platform.machine().lower()
    sub = _platform_subdir(system, arch)
    if not sub:
        return None
    marker = runtime_dir / "llama" / sub / ".installed"
    if marker.exists():
        return marker.read_text(encoding="utf-8").strip()
    return None


def _last_check_time(runtime_dir: Path) -> float:
    """Read the timestamp of the last update check."""
    ts_file = runtime_dir / "llama" / ".update_check"
    if ts_file.exists():
        try:
            return float(ts_file.read_text(encoding="utf-8").strip())
        except ValueError:
            pass
    return 0


def _record_check_time(runtime_dir: Path) -> None:
    ts_file = runtime_dir / "llama" / ".update_check"
    ts_file.parent.mkdir(parents=True, exist_ok=True)
    ts_file.write_text(str(time.time()), encoding="utf-8")


def release_asset_for_platform(tag: str) -> tuple[str, str] | None:
    """Return (download_url, archive_kind) for the given tag."""
    system = platform.system().lower()
    arch = platform.machine().lower()
    base = f"https://github.com/ggml-org/llama.cpp/releases/download/{tag}"

    if system == "darwin":
        if arch in ("arm64", "aarch64"):
            name = f"llama-{tag}-bin-macos-arm64.tar.gz"
            return f"{base}/{name}", "tar.gz"
        name = f"llama-{tag}-bin-macos-x64.tar.gz"
        return f"{base}/{name}", "tar.gz"

    if system == "windows":
        if arch in ("arm64", "aarch64"):
            name = f"llama-{tag}-bin-win-cpu-arm64.zip"
            return f"{base}/{name}", "zip"
        name = f"llama-{tag}-bin-win-cpu-x64.zip"
        return f"{base}/{name}", "zip"

    if system == "linux":
        if arch in ("arm64", "aarch64"):
            name = f"llama-{tag}-bin-ubuntu-arm64.tar.gz"
            return f"{base}/{name}", "tar.gz"
        name = f"llama-{tag}-bin-ubuntu-x64.tar.gz"
        return f"{base}/{name}", "tar.gz"

    return None


def _server_names() -> list[str]:
    if platform.system().lower() == "windows":
        return ["llama-server.exe", "llama.exe"]
    return ["llama-server", "llama"]


def ensure_llama_server_binary(
    runtime_dir: Path,
    on_progress: ProgressFn | None = None,
) -> Path:
    """Ensure llama-server exists and is up-to-date.

    1. If not installed → download latest.
    2. If installed but update check is stale → check GitHub, update if newer.
    3. Otherwise → return existing binary.
    """
    from engine.runtime.llama_bin import find_llama_server

    existing = find_llama_server(runtime_dir)
    installed = _installed_version(runtime_dir)

    if existing and installed:
        # Check if we should look for an update
        now = time.time()
        if now - _last_check_time(runtime_dir) > _CHECK_INTERVAL:
            _record_check_time(runtime_dir)
            latest = _fetch_latest_tag()
            if latest and latest != installed:
                logger.info("llama.cpp update available: %s → %s", installed, latest)
                return _download_and_install(runtime_dir, latest, on_progress)
        return existing

    # Not installed — download latest (or fallback to minimum)
    tag = _fetch_latest_tag() or _MIN_TAG
    return _download_and_install(runtime_dir, tag, on_progress)


def _download_and_install(
    runtime_dir: Path,
    tag: str,
    on_progress: ProgressFn | None = None,
) -> Path:
    """Download and install a specific llama.cpp release."""
    from engine.runtime.llama_bin import _platform_subdir, ensure_executable, find_llama_server

    asset = release_asset_for_platform(tag)
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

    if on_progress:
        on_progress("download", 15, f"llama.cpp {tag}")

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

    marker = dest_root / ".installed"
    marker.write_text(tag, encoding="utf-8")
    _record_check_time(runtime_dir)

    found = find_llama_server(runtime_dir)
    if not found:
        raise RuntimeError("llama-server install failed")
    ensure_executable(found)
    if on_progress:
        on_progress("download", 20, f"llama.cpp {tag} ready")
    return found


def _copy_server_binary(search_root: Path, dest_root: Path) -> bool:
    names = set(_server_names())
    for path in search_root.rglob("*"):
        if path.name in names and path.is_file():
            dest = dest_root / path.name
            shutil.copy2(path, dest)
            _ensure_executable_local(dest)
            return True
    return False


def _ensure_executable_local(path: Path) -> None:
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
