"""Ollama binary management: download, start, stop, detect."""

from __future__ import annotations

import json
import logging
import os
import platform
import shutil
import socket
import subprocess
import tarfile
import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path
from urllib.request import Request, urlopen, urlretrieve

logger = logging.getLogger(__name__)

OLLAMA_VERSION = "v0.30.5"
OLLAMA_RELEASE_BASE = f"https://github.com/ollama/ollama/releases/download/{OLLAMA_VERSION}"
DEFAULT_PORT = 11434

ProgressFn = Callable[[str, int, str], None]


def _platform_asset() -> tuple[str, str] | None:
    """Return (filename, archive_kind) for the current platform."""
    system = platform.system().lower()
    arch = platform.machine().lower()

    if system == "darwin":
        return "ollama-darwin.tgz", "tgz"
    if system == "windows":
        return "ollama-windows-amd64.zip", "zip"
    if system == "linux":
        if arch in ("arm64", "aarch64"):
            return "ollama-linux-arm64.tar.zst", "zst"
        return "ollama-linux-amd64.tar.zst", "zst"
    return None


def _ollama_binary_path(runtime_dir: Path) -> Path:
    """Path to the ollama binary in our app data."""
    system = platform.system().lower()
    name = "ollama.exe" if system == "windows" else "ollama"
    return runtime_dir / "ollama" / name


def _is_port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        try:
            s.connect((host, port))
            return True
        except (ConnectionRefusedError, TimeoutError, OSError):
            return False


def _check_ollama_api(base_url: str) -> bool:
    """Check if Ollama API responds at the given URL."""
    try:
        req = Request(f"{base_url}/api/version", method="GET")
        with urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def detect_existing_ollama() -> str | None:
    """Detect if Ollama is already running (user's own instance).

    Returns the base URL if found, None otherwise.
    """
    # Check default port
    if _is_port_open(DEFAULT_PORT):
        base = f"http://127.0.0.1:{DEFAULT_PORT}"
        if _check_ollama_api(base):
            return base

    # Check OLLAMA_HOST env var
    host = os.environ.get("OLLAMA_HOST", "").strip()
    if host:
        if not host.startswith("http"):
            host = f"http://{host}"
        if _check_ollama_api(host):
            return host

    return None


def find_ollama_binary(runtime_dir: Path) -> Path | None:
    """Find ollama binary: app data first, then PATH."""
    # Our downloaded copy
    local = _ollama_binary_path(runtime_dir)
    if local.exists():
        return local

    # System PATH
    system_path = shutil.which("ollama")
    if system_path:
        return Path(system_path)

    return None


def is_ollama_installed(runtime_dir: Path) -> bool:
    return find_ollama_binary(runtime_dir) is not None


def download_ollama(
    runtime_dir: Path,
    on_progress: ProgressFn | None = None,
) -> Path:
    """Download Ollama binary to app data."""
    asset = _platform_asset()
    if not asset:
        raise RuntimeError(f"Unsupported platform: {platform.system()} {platform.machine()}")

    filename, kind = asset
    url = f"{OLLAMA_RELEASE_BASE}/{filename}"

    dest_dir = runtime_dir / "ollama"
    dest_dir.mkdir(parents=True, exist_ok=True)
    binary = _ollama_binary_path(runtime_dir)
    marker = dest_dir / ".version"

    # Skip if already downloaded
    if binary.exists() and marker.exists() and marker.read_text().strip() == OLLAMA_VERSION:
        return binary

    if on_progress:
        on_progress("download", 5, f"Ollama {OLLAMA_VERSION}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        archive = tmp_path / filename
        logger.info("Downloading Ollama: %s", url)
        urlretrieve(url, archive)

        if on_progress:
            on_progress("download", 50, "extracting")

        if kind == "tgz":
            with tarfile.open(archive, "r:gz") as tf:
                try:
                    tf.extractall(tmp_path, filter="data")
                except TypeError:
                    tf.extractall(tmp_path)
        elif kind == "zip":
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(tmp_path)
        else:
            raise RuntimeError(f"Unsupported archive format: {kind}")

        # Find the ollama binary in extracted files
        found = False
        for p in tmp_path.rglob("ollama*"):
            if p.is_file() and (p.name == "ollama" or p.name == "ollama.exe"):
                shutil.copy2(p, binary)
                if platform.system().lower() != "windows":
                    binary.chmod(binary.stat().st_mode | 0o755)
                found = True
                break

        if not found:
            raise RuntimeError("ollama binary not found in downloaded archive")

    marker.write_text(OLLAMA_VERSION, encoding="utf-8")

    if on_progress:
        on_progress("download", 100, "ready")

    return binary


class OllamaDaemon:
    """Manage an Ollama daemon process."""

    def __init__(self) -> None:
        self.process: subprocess.Popen | None = None
        self.base_url: str | None = None
        self._is_ours = False  # Did we start it?

    def start(
        self,
        runtime_dir: Path,
        models_dir: Path,
        port: int = DEFAULT_PORT,
    ) -> str:
        """Start Ollama daemon. Returns base URL.

        If Ollama is already running on the port, reuses it.
        """
        # Check if already running
        existing = detect_existing_ollama()
        if existing:
            self.base_url = existing
            self._is_ours = False
            logger.info("Reusing existing Ollama at %s", existing)
            return existing

        binary = find_ollama_binary(runtime_dir)
        if not binary:
            raise RuntimeError("Ollama not installed. Download it first.")

        models_dir.mkdir(parents=True, exist_ok=True)

        env = {
            **os.environ,
            "OLLAMA_HOST": f"127.0.0.1:{port}",
            "OLLAMA_MODELS": str(models_dir),
            "OLLAMA_KEEP_ALIVE": "5m",
        }

        logger.info("Starting Ollama: %s serve (port %d)", binary, port)
        self.process = subprocess.Popen(
            [str(binary), "serve"],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._is_ours = True

        # Wait for API to become available
        base = f"http://127.0.0.1:{port}"
        import time

        deadline = time.time() + 30
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Ollama exited unexpectedly during startup")
            if _check_ollama_api(base):
                self.base_url = base
                logger.info("Ollama ready at %s", base)
                return base
            time.sleep(0.5)

        raise RuntimeError("Ollama startup timeout (30s)")

    def stop(self) -> None:
        """Stop Ollama only if we started it."""
        if self.process and self._is_ours:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process = None
        self.base_url = None
        self._is_ours = False
