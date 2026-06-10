"""FFmpeg auto-download manager.

Downloads static ffmpeg binary on first run if not found in PATH.
Stores in {appData}/runtime/ffmpeg/ and adds to PATH for subprocess use.
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
import stat
import tarfile
import zipfile
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_FFMPEG_SOURCES = {
    ("Darwin", "arm64"): {
        "url": "https://www.osxexperts.net/ffmpeg7arm.zip",
        "binary": "ffmpeg",
    },
    ("Darwin", "x86_64"): {
        "url": "https://evermeet.cx/ffmpeg/ffmpeg-7.1.1.zip",
        "binary": "ffmpeg",
    },
    ("Windows", "AMD64"): {
        "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
        "binary": "ffmpeg.exe",
    },
    ("Linux", "x86_64"): {
        "url": "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
        "binary": "ffmpeg",
    },
    ("Linux", "aarch64"): {
        "url": "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz",
        "binary": "ffmpeg",
    },
}


def ffmpeg_dir(app_data_root: Path) -> Path:
    return app_data_root / "runtime" / "ffmpeg"


def find_bundled_ffmpeg(app_data_root: Path) -> str | None:
    """Find ffmpeg in app data directory."""
    d = ffmpeg_dir(app_data_root)
    binary = "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg"
    path = d / binary
    if path.exists() and os.access(path, os.X_OK):
        return str(path)
    return None


def find_system_ffmpeg() -> str | None:
    """Find ffmpeg in system PATH."""
    return shutil.which("ffmpeg")


def ensure_ffmpeg(app_data_root: Path, on_progress=None, mirror: str | None = None) -> str | None:
    """Ensure ffmpeg is available. Returns path to ffmpeg binary.

    Priority: system PATH > bundled > download.

    Args:
        mirror: Optional mirror URL prefix. If provided, the mirror URL
            (mirror + original_path) is tried first; falls back to the
            original source URL on failure.
    """
    # 1. Check system PATH
    system = find_system_ffmpeg()
    if system:
        return system

    # 2. Check bundled
    bundled = find_bundled_ffmpeg(app_data_root)
    if bundled:
        return bundled

    # 3. Download
    return download_ffmpeg(app_data_root, on_progress, mirror=mirror)


def download_ffmpeg(app_data_root: Path, on_progress=None, mirror: str | None = None) -> str | None:
    """Download static ffmpeg binary for current platform.

    Args:
        mirror: Optional mirror URL prefix. If provided, the mirror URL
            (mirror + original_path) is tried first; falls back to the
            original source URL on failure.
    """
    system = platform.system()
    arch = platform.machine()
    key = (system, arch)

    source = _FFMPEG_SOURCES.get(key)
    if not source:
        logger.warning("No ffmpeg download available for %s/%s", system, arch)
        return None

    original_url = source["url"]
    binary_name = source["binary"]
    dest_dir = ffmpeg_dir(app_data_root)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / binary_name

    if dest_path.exists():
        return str(dest_path)

    # Build URL list: mirror first (if provided), then original
    urls: list[str] = []
    if mirror:
        from urllib.parse import urlparse
        parsed = urlparse(original_url)
        mirror_url = mirror.rstrip("/") + parsed.path
        urls.append(mirror_url)
    urls.append(original_url)

    if on_progress:
        on_progress("download", 10, "Downloading ffmpeg...")

    for url in urls:
        logger.info("Downloading ffmpeg from %s", url)
        try:
            resp = requests.get(url, stream=True, timeout=120)
            resp.raise_for_status()

            # Download to temp file
            tmp_path = dest_dir / "ffmpeg_download.tmp"
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0

            with open(tmp_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0 and on_progress:
                        pct = 10 + int(80 * downloaded / total)
                        on_progress(
                            "download", pct, f"Downloading ffmpeg... {downloaded // (1024 * 1024)}MB"
                        )

            # Extract based on file type
            if url.endswith(".zip"):
                _extract_zip(tmp_path, dest_dir, binary_name)
            elif url.endswith(".tar.xz") or url.endswith(".tar.gz"):
                _extract_tar(tmp_path, dest_dir, binary_name)
            else:
                # Assume it's a direct binary
                tmp_path.rename(dest_path)

            # Cleanup temp
            if tmp_path.exists():
                tmp_path.unlink()

            # Make executable
            if dest_path.exists():
                dest_path.chmod(dest_path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
                logger.info("ffmpeg installed: %s", dest_path)
                if on_progress:
                    on_progress("download", 100, "ffmpeg installed")
                return str(dest_path)

        except Exception as e:
            logger.warning("Failed to download ffmpeg from %s: %s", url, e)
            if dest_dir.exists():
                shutil.rmtree(dest_dir, ignore_errors=True)

    return None


def _extract_zip(zip_path: Path, dest_dir: Path, binary_name: str) -> None:
    """Extract ffmpeg binary from zip archive."""
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.endswith(binary_name) and "/" not in name:
                # Top-level binary
                with zf.open(name) as src, open(dest_dir / binary_name, "wb") as dst:
                    dst.write(src.read())
                return
            if name.endswith(f"/{binary_name}") or name.endswith(f"\\{binary_name}"):
                # Nested binary
                with zf.open(name) as src, open(dest_dir / binary_name, "wb") as dst:
                    dst.write(src.read())
                return


def _extract_tar(tar_path: Path, dest_dir: Path, binary_name: str) -> None:
    """Extract ffmpeg binary from tar archive."""
    with tarfile.open(tar_path) as tf:
        for member in tf.getmembers():
            if member.name.endswith(binary_name) and member.isfile():
                # Extract just the binary
                src = tf.extractfile(member)
                if src:
                    with open(dest_dir / binary_name, "wb") as dst:
                        dst.write(src.read())
                    return
