"""Ollama lifecycle: app-managed binary + optional user/system instance.

Storage policy
--------------
* **App Ollama** — binary under ``{appData}/runtime/ollama/``, models under
  ``{appData}/models/``, listens on ``OLLAMA_APP_PORT`` (11435). Removed with
  "Delete all data" / app uninstall.
* **User Ollama** — whatever the user installed (PATH / system service), default
  port ``OLLAMA_USER_PORT`` (11434). We may list/pull/delete **catalog** models
  only; we never remove the user's binary.
"""

from __future__ import annotations

import contextlib
import logging
import os
import platform
import shutil
import socket
import subprocess
import tarfile
import tempfile
import threading
import zipfile
from collections.abc import Callable
from pathlib import Path
import requests

from content_understand.defaults import OLLAMA_APP_BASE_URL, OLLAMA_APP_PORT, OLLAMA_USER_PORT

logger = logging.getLogger(__name__)

OLLAMA_VERSION = "v0.30.6"
OLLAMA_RELEASE_BASE = f"https://github.com/ollama/ollama/releases/download/{OLLAMA_VERSION}"

# Default GitHub mirror for China users (prefix before the original URL)
_DEFAULT_GITHUB_MIRROR = ""  # e.g. "https://mirror.ghproxy.com/"

ProgressFn = Callable[[str, int, str], None]

_daemon: OllamaDaemon | None = None

_download_lock = threading.Lock()
_daemon_lock = threading.Lock()
_download_state: dict[str, object] = {
    "running": False,
    "error": None,
    "percent": 0,
    "message": "",
    "total_bytes": 0,
    "completed_bytes": 0,
    "speed_bps": 0.0,
}


def app_download_state() -> dict[str, object]:
    with _download_lock:
        return dict(_download_state)


def start_app_ollama_download(runtime_dir: Path, github_mirror: str = "") -> dict[str, object]:
    """Download app Ollama in a background thread so the sidecar stays responsive."""
    with _download_lock:
        if _download_state["running"]:
            return {"ok": True, "status": "in_progress"}
        if is_app_ollama_installed(runtime_dir):
            return {
                "ok": True,
                "status": "already_installed",
                "path": str(app_binary_path(runtime_dir)),
            }
        _download_state.update(
            {
                "running": True,
                "error": None,
                "percent": 0,
                "message": "starting",
                "total_bytes": 0,
                "completed_bytes": 0,
                "speed_bps": 0.0,
            }
        )

    def _progress(stage: str, percent: int, message: str) -> None:
        with _download_lock:
            _download_state.update(
                {
                    "percent": percent,
                    "message": message,
                    "stage": stage,
                }
            )

    def _run() -> None:
        try:
            download_ollama(runtime_dir, on_progress=_progress, github_mirror=github_mirror)
            with _download_lock:
                _download_state.update(
                    {
                        "running": False,
                        "error": None,
                        "percent": 100,
                        "message": "ready",
                    }
                )
        except Exception as exc:
            logger.exception("App Ollama download failed")
            with _download_lock:
                _download_state.update(
                    {
                        "running": False,
                        "error": str(exc)[:500],
                        "message": str(exc)[:200],
                    }
                )

    threading.Thread(target=_run, daemon=True, name="ollama-download").start()
    return {"ok": True, "status": "started"}


def _platform_asset() -> tuple[str, str] | None:
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


def app_ollama_dir(runtime_dir: Path) -> Path:
    return runtime_dir / "ollama"


def app_binary_path(runtime_dir: Path) -> Path:
    system = platform.system().lower()
    name = "ollama.exe" if system == "windows" else "ollama"
    return app_ollama_dir(runtime_dir) / name


def llama_server_path(runtime_dir: Path) -> Path:
    system = platform.system().lower()
    name = "llama-server.exe" if system == "windows" else "llama-server"
    top = app_ollama_dir(runtime_dir) / name
    if top.exists():
        return top
    # Windows zip nests binaries under lib/ollama/
    nested = app_ollama_dir(runtime_dir) / "lib" / "ollama" / name
    if nested.exists():
        return nested
    return top


def is_app_binary(path: Path | None, runtime_dir: Path) -> bool:
    if not path:
        return False
    try:
        return path.resolve() == app_binary_path(runtime_dir).resolve()
    except OSError:
        return False


def find_app_binary(runtime_dir: Path) -> Path | None:
    """Return only the app-downloaded Ollama binary (never PATH)."""
    binary = app_binary_path(runtime_dir)
    return binary if binary.exists() else None


def find_user_binary() -> Path | None:
    """Return a system-installed Ollama binary from PATH, if any."""
    found = shutil.which("ollama")
    return Path(found) if found else None


def is_app_ollama_installed(runtime_dir: Path) -> bool:
    """True when the app bundle includes ollama + llama-server (required for vision)."""
    return find_app_binary(runtime_dir) is not None and llama_server_path(runtime_dir).exists()


def is_app_ollama_partial(runtime_dir: Path) -> bool:
    """Binary present but llama-server missing — broken multimodal install."""
    return find_app_binary(runtime_dir) is not None and not llama_server_path(runtime_dir).exists()


def is_any_ollama_installed(runtime_dir: Path) -> bool:
    return is_app_ollama_installed(runtime_dir) or find_user_binary() is not None


def remove_app_ollama(runtime_dir: Path) -> None:
    """Delete app-managed Ollama binary. Does not touch user/system installs."""
    target = app_ollama_dir(runtime_dir)
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)


def _is_port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        try:
            s.connect((host, port))
            return True
        except (ConnectionRefusedError, TimeoutError, OSError):
            return False


def _check_ollama_api(base_url: str) -> bool:
    """Check if Ollama API is responding. Uses urllib to bypass SSRF protection for localhost."""
    try:
        from urllib.request import Request, urlopen
        req = Request(f"{base_url}/api/version")
        resp = urlopen(req, timeout=2)
        return resp.status == 200
    except Exception:
        return False


def _base_for_port(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def detect_user_ollama() -> str | None:
    """User/system Ollama — explicit OLLAMA_HOST override takes priority."""
    host = os.environ.get("OLLAMA_HOST", "").strip()
    if host:
        if not host.startswith("http"):
            host = f"http://{host}"
        if _check_ollama_api(host):
            return host
    base = _base_for_port(OLLAMA_USER_PORT)
    if _is_port_open(OLLAMA_USER_PORT) and _check_ollama_api(base):
        return base
    return None


def _get_process_cmdline(pid: int) -> str | None:
    """Return the full command line of a process, or None on failure."""
    try:
        if platform.system() == "Windows":
            result = subprocess.run(
                ["wmic", "process", "where", f"ProcessId={pid}", "get", "CommandLine", "/value"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            for line in result.stdout.splitlines():
                if line.startswith("CommandLine="):
                    return line.split("=", 1)[1].strip()
            return None
        if platform.system() == "Linux":
            return (
                Path(f"/proc/{pid}/cmdline")
                .read_bytes()
                .replace(b"\x00", b" ")
                .decode(errors="replace")
                .strip()
            )
        # macOS / BSD
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip() or None
    except Exception:
        return None


def detect_app_ollama() -> str | None:
    """App-managed Ollama on the dedicated app port."""
    base = OLLAMA_APP_BASE_URL
    if not (_is_port_open(OLLAMA_APP_PORT) and _check_ollama_api(base)):
        return None
    # Verify the process on the app port is actually our binary
    from engine.paths import app_data_root

    from . import port_utils

    pid = port_utils.find_process_on_port(OLLAMA_APP_PORT)
    if pid is not None:
        cmdline = _get_process_cmdline(pid)
        if cmdline is not None:
            expected_binary = find_app_binary(app_data_root() / "runtime")
            if expected_binary is not None:
                expected = str(expected_binary)
                if expected not in cmdline:
                    logger.info(
                        "Port %d is occupied by a different Ollama (PID %d), not treating as app Ollama",
                        OLLAMA_APP_PORT,
                        pid,
                    )
                    return None
    return base


def detect_existing_ollama(*, prefer_user: bool = True) -> str | None:
    """Return a running Ollama base URL.

    When ``prefer_user`` is true, user/system (11434) wins over app (11435).
    """
    user = detect_user_ollama()
    app = detect_app_ollama()
    if prefer_user:
        return user or app
    return app or user


def detect_ollama_source(runtime_dir: Path, *, prefer_user: bool = True) -> str | None:
    """Identify which Ollama instance is active: ``app`` | ``user`` | ``None``."""
    user = detect_user_ollama()
    app = detect_app_ollama()
    if prefer_user and user:
        return "user"
    if app:
        return "app"
    if user:
        return "user"
    return None


def resolve_active_ollama(
    runtime_dir: Path,
    *,
    prefer_user: bool = True,
) -> tuple[str | None, str | None]:
    """Return ``(base_url, source)`` for the active instance."""
    source = detect_ollama_source(runtime_dir, prefer_user=prefer_user)
    if source == "user":
        return detect_user_ollama(), "user"
    if source == "app":
        return detect_app_ollama(), "app"
    return None, None


def _download_with_progress(url: str, dest: Path, on_progress: ProgressFn | None = None) -> None:
    import time

    chunk_size = 256 * 1024
    resp = requests.get(url, stream=True, timeout=30)
    resp.raise_for_status()
    total = int(resp.headers.get("Content-Length", 0))
    downloaded = 0
    speed_window: list[tuple[float, int]] = []
    last_speed = 0.0
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=chunk_size):
            if not chunk:
                continue
            f.write(chunk)
            downloaded += len(chunk)
            now = time.monotonic()
            speed_window.append((now, downloaded))
            speed_window = [(t, b) for t, b in speed_window if now - t < 10]
            if len(speed_window) > 5:
                speed_window = speed_window[-5:]
            if len(speed_window) >= 2:
                t0, b0 = speed_window[0]
                t1, b1 = speed_window[-1]
                dt = t1 - t0
                if dt > 0:
                    last_speed = (b1 - b0) / dt
            if on_progress and total > 0:
                pct = int(5 + (downloaded / total) * 40)
                msg = f"{downloaded // (1024 * 1024)}/{total // (1024 * 1024)} MB"
                on_progress("download", pct, msg)
            with _download_lock:
                _download_state.update(
                    {
                        "percent": int(5 + (downloaded / total) * 40) if total > 0 else 0,
                        "message": (
                            f"{downloaded // (1024 * 1024)}/{total // (1024 * 1024)} MB"
                            if total > 0
                            else "downloading"
                        ),
                        "total_bytes": total,
                        "completed_bytes": downloaded,
                        "speed_bps": last_speed,
                    }
                )


def _extract_zip_with_retry(zf: zipfile.ZipFile, dest_dir: Path) -> None:
    """Extract zip one file at a time, handling Windows DLL locks.

    On Windows, loaded DLLs (e.g. vulkan-1.dll) cannot be deleted but CAN be
    renamed.  When a file is locked, rename it aside and re-extract the fresh
    copy.  The stale rename is cleaned up on next reboot or manual deletion.
    """
    import uuid

    for info in zf.infolist():
        target = dest_dir / info.filename
        try:
            zf.extract(info, dest_dir)
        except PermissionError:
            # Rename the locked file aside, then re-extract
            stump = target.with_suffix(target.suffix + f".old.{uuid.uuid4().hex[:8]}")
            logger.warning("File locked, renaming %s → %s", target.name, stump.name)
            try:
                target.rename(stump)
            except OSError:
                logger.error("Cannot rename locked file %s — skipping", target)
                continue
            try:
                zf.extract(info, dest_dir)
            except Exception as exc:
                logger.error("Re-extract after rename failed for %s: %s", target, exc)


def download_ollama(
    runtime_dir: Path,
    on_progress: ProgressFn | None = None,
    github_mirror: str = "",
) -> Path:
    """Download Ollama binary into app storage."""
    asset = _platform_asset()
    if not asset:
        raise RuntimeError(f"Unsupported platform: {platform.system()} {platform.machine()}")

    filename, kind = asset
    base_url = f"{OLLAMA_RELEASE_BASE}/{filename}"
    mirror = github_mirror or _DEFAULT_GITHUB_MIRROR
    url = f"{mirror}{base_url}" if mirror else base_url
    dest_dir = app_ollama_dir(runtime_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    binary = app_binary_path(runtime_dir)
    marker = dest_dir / ".version"

    server = llama_server_path(runtime_dir)
    if (
        binary.exists()
        and server.exists()
        and marker.exists()
        and marker.read_text().strip() == OLLAMA_VERSION
    ):
        return binary

    if is_app_ollama_partial(runtime_dir):
        logger.warning("App Ollama install incomplete (missing llama-server); re-extracting")

    # Stop daemon before re-extraction so DLLs (vulkan-1.dll etc.) are not locked
    if binary.exists():
        stop_shared_daemon()

    if on_progress:
        on_progress("download", 5, f"Ollama {OLLAMA_VERSION}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        archive = tmp_path / filename
        logger.info("Downloading app Ollama: %s", url)
        try:
            _download_with_progress(url, archive, on_progress)
        except Exception as exc:
            raise RuntimeError(f"Download failed: {exc}. Check your network.") from exc

        if on_progress:
            on_progress("download", 50, "extracting")

        try:
            if kind == "tgz":
                with tarfile.open(archive, "r:gz") as tf:
                    try:
                        tf.extractall(dest_dir, filter="data")
                    except TypeError:
                        tf.extractall(dest_dir)
            elif kind == "zip":
                with zipfile.ZipFile(archive) as zf:
                    _extract_zip_with_retry(zf, dest_dir)
            elif kind == "zst":
                _extract_zst(archive, dest_dir)
            else:
                raise RuntimeError(f"Unsupported archive format: {kind}")
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"Extraction failed: {exc}") from exc

        if not binary.exists():
            raise RuntimeError("ollama binary not found after extraction")
        # Re-resolve after extraction — Windows zip nests llama-server under lib/ollama/
        server = llama_server_path(runtime_dir)
        if not server.exists():
            raise RuntimeError(
                "llama-server not found after extraction — vision models will not work"
            )

        if platform.system().lower() != "windows":
            for name in ("ollama", "llama-server", "llama-quantize"):
                p = dest_dir / name
                if not p.exists():
                    p = dest_dir / "lib" / "ollama" / name
                if p.exists():
                    p.chmod(p.stat().st_mode | 0o755)

        _post_install_macos(dest_dir)

    marker.write_text(OLLAMA_VERSION, encoding="utf-8")
    if on_progress:
        on_progress("download", 100, "ready")
    return binary


def _post_install_macos(dest_dir: Path) -> None:
    """Clear quarantine and ad-hoc sign so Gatekeeper allows serve + llama-server."""
    if platform.system().lower() != "darwin":
        return
    try:
        subprocess.run(
            ["xattr", "-cr", str(dest_dir)],
            check=False,
            capture_output=True,
            timeout=30,
        )
        for name in ("ollama", "llama-server", "llama-quantize"):
            p = dest_dir / name
            if not p.exists():
                p = dest_dir / "lib" / "ollama" / name
            if p.exists():
                subprocess.run(
                    ["codesign", "--force", "--sign", "-", str(p)],
                    check=False,
                    capture_output=True,
                    timeout=30,
                )
    except Exception as exc:
        logger.warning("macOS post-install signing skipped: %s", exc)


def _extract_zst(archive: Path, dest: Path) -> None:
    try:
        import zstandard
    except ImportError:
        raise RuntimeError(
            "zstandard package required for Linux Ollama download. "
            "Install with: pip install zstandard"
        ) from None

    dctx = zstandard.ZstdDecompressor()
    with (
        open(archive, "rb") as fh,
        dctx.stream_reader(fh) as reader,
        tarfile.open(fileobj=reader, mode="r|") as tf,
    ):
        try:
            tf.extractall(dest, filter="data")
        except TypeError:
            tf.extractall(dest)


class OllamaDaemon:
    """Manage the app-owned Ollama daemon (port 11435)."""

    def __init__(self) -> None:
        self.process: subprocess.Popen | None = None
        self.base_url: str | None = None
        self._is_ours = False
        self._start_lock = threading.Lock()

    def start(
        self,
        runtime_dir: Path,
        models_dir: Path,
        port: int = OLLAMA_APP_PORT,
        ollama_mirror: str = "",
    ) -> str:
        """Start app Ollama. Reuses an existing app instance when already up."""
        with self._start_lock:
            return self._start_impl(runtime_dir, models_dir, port, ollama_mirror)

    def _start_impl(
        self,
        runtime_dir: Path,
        models_dir: Path,
        port: int,
        ollama_mirror: str = "",
    ) -> str:
        # Clean up stale process reference before attempting restart
        if self.process is not None:
            retcode = self.process.poll()
            if retcode is not None:
                logger.info("Previous Ollama process exited with code %d, cleaning up", retcode)
                # Drain PIPE buffers to prevent fd leak
                with contextlib.suppress(Exception):
                    self.process.stdout.close()
                with contextlib.suppress(Exception):
                    self.process.stderr.close()
                self.process = None

        existing = detect_app_ollama()
        if existing:
            self.base_url = existing
            self._is_ours = False
            logger.info("Reusing app Ollama at %s", existing)
            return existing

        # Kill orphaned Ollama on our port (from force-quit or crash)
        from . import port_utils
        pid = port_utils.find_process_on_port(port)
        if pid is not None:
            cmdline = _get_process_cmdline(pid)
            expected_binary = find_app_binary(runtime_dir)
            if cmdline and expected_binary and str(expected_binary) in cmdline:
                logger.warning("Killing orphaned app Ollama (PID %d) on port %d", pid, port)
                kill_process_by_pid(pid)
                _clear_pid()
                import time as _t
                _t.sleep(1)

        if is_app_ollama_partial(runtime_dir):
            logger.info("Repairing incomplete app Ollama (missing llama-server)...")
            download_ollama(runtime_dir)

        binary = find_app_binary(runtime_dir)
        if not binary or not llama_server_path(runtime_dir).exists():
            raise RuntimeError(
                "App Ollama not installed or incomplete. Re-download from Settings → Ollama."
            )

        models_dir.mkdir(parents=True, exist_ok=True)
        env = {
            **os.environ,
            "OLLAMA_HOST": f"127.0.0.1:{port}",
            "OLLAMA_MODELS": str(models_dir),
            "OLLAMA_KEEP_ALIVE": "5m",
        }
        if ollama_mirror:
            env["OLLAMA_REGISTRY"] = ollama_mirror

        logger.info("Starting app Ollama: %s serve (port %d)", binary, port)
        self.process = subprocess.Popen(
            [str(binary), "serve"],
            env=env,
            cwd=str(binary.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._is_ours = True
        _write_pid(self.process.pid)

        import time

        base = _base_for_port(port)
        deadline = time.time() + 30
        while time.time() < deadline:
            if self.process is None:
                raise RuntimeError("App Ollama startup aborted (stopped externally)")
            if self.process.poll() is not None:
                err = ""
                if self.process.stderr:
                    err = self.process.stderr.read(4096).decode(errors="replace")[:500]
                raise RuntimeError(
                    f"App Ollama exited unexpectedly during startup{f': {err}' if err else ''}"
                )
            if _check_ollama_api(base):
                self.base_url = base
                logger.info("App Ollama ready at %s", base)
                return base
            time.sleep(0.5)

        raise RuntimeError("App Ollama startup timeout (30s)")

    def stop(self) -> None:
        if self.process and self._is_ours:
            self.process.terminate()
            try:
                self.process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                try:
                    self.process.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    pass
            self.process = None
        self.base_url = None
        self._is_ours = False
        _clear_pid()

    def stop_and_wait_port(self, port: int, timeout: float = 10.0) -> bool:
        """Stop daemon and wait until the port is fully released.

        Returns True if port is free, False if still occupied after timeout.
        """
        self.stop()
        import time as _time

        deadline = _time.monotonic() + timeout
        while _time.monotonic() < deadline:
            if not _is_port_open(port):
                return True
            _time.sleep(0.5)
        # Port still occupied — try force cleanup via port_utils
        from . import port_utils

        if port_utils.cleanup_stale_port(port):
            return True
        return not _is_port_open(port)


def get_shared_daemon() -> OllamaDaemon:
    global _daemon
    if _daemon is None:
        with _daemon_lock:
            if _daemon is None:
                _daemon = OllamaDaemon()
    return _daemon


def _pid_file() -> Path:
    """PID file for the app-managed Ollama daemon."""
    from engine.paths import app_data_root

    return app_data_root() / "runtime" / "ollama.pid"


def _write_pid(pid: int) -> None:
    with contextlib.suppress(OSError):
        _pid_file().write_text(str(pid))


def _read_pid() -> int | None:
    try:
        text = _pid_file().read_text().strip()
        return int(text) if text else None
    except (OSError, ValueError):
        return None


def _clear_pid() -> None:
    with contextlib.suppress(OSError):
        _pid_file().unlink(missing_ok=True)


def stop_shared_daemon() -> None:
    from .port_utils import is_pid_alive, kill_process_by_pid

    global _daemon
    if _daemon is not None:
        _daemon.stop()
        _daemon = None
        _clear_pid()
    else:
        # _daemon is None (sidecar restarted) — use PID file to find orphan.
        pid = _read_pid()
        if pid is not None and is_pid_alive(pid):
            # Verify it's actually our app Ollama binary
            from engine.paths import app_data_root

            cmdline = _get_process_cmdline(pid)
            expected_binary = find_app_binary(app_data_root() / "runtime")
            if cmdline and expected_binary and str(expected_binary) in cmdline:
                logger.info("Stopping orphaned app Ollama (PID %d)", pid)
                kill_process_by_pid(pid)
        _clear_pid()


# Back-compat helpers used by older call sites
def find_ollama_binary(runtime_dir: Path) -> Path | None:
    return find_app_binary(runtime_dir) or find_user_binary()


def is_ollama_installed(runtime_dir: Path) -> bool:
    return is_any_ollama_installed(runtime_dir)
