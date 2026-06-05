"""Manage llama-server subprocess."""

from __future__ import annotations

import logging
import platform
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any
from urllib.request import urlopen

logger = logging.getLogger(__name__)


def _drain_stream(stream, log_func):  # type: ignore[no-untyped-def]
    """Continuously read from *stream* until EOF, forwarding each line via *log_func*."""
    try:
        for line in iter(stream.readline, b""):
            if line:
                log_func(line.decode(errors="replace").rstrip())
    except (ValueError, OSError):
        pass


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LlamaServerProcess:
    def __init__(self) -> None:
        self.process: subprocess.Popen | None = None
        self.port: int | None = None
        self.base_url: str | None = None
        self._drain_threads: list[threading.Thread] = []

    def start(
        self,
        binary: Path,
        model_path: Path,
        *,
        mmproj_path: Path | None = None,
        llama_opts: dict[str, Any] | None = None,
    ) -> str:
        self.stop()
        port = _free_port()
        opts = llama_opts or {}
        ctx = str(opts.get("ctx_size", 8192))
        chat = opts.get("chat_template", "gemma")
        ngl = str(opts.get("n_gpu_layers", 99))

        cmd = [
            str(binary),
            "-m",
            str(model_path),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "-c",
            ctx,
            "--chat-template",
            chat,
            "-ngl",
            ngl,
        ]
        if mmproj_path and mmproj_path.exists():
            cmd.extend(["--mmproj", str(mmproj_path)])

        logger.info("Starting llama-server: %s", " ".join(cmd[:6]))
        popen_kw: dict = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
        }
        if platform.system().lower() == "windows":
            popen_kw["creationflags"] = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]

        self.process = subprocess.Popen(cmd, **popen_kw)
        self.port = port
        self.base_url = f"http://127.0.0.1:{port}/v1"

        # Drain stdout/stderr in background to prevent pipe buffer deadlock.
        for stream, label, log_fn in [
            (self.process.stdout, "stdout", logger.info),
            (self.process.stderr, "stderr", logger.warning),
        ]:
            t = threading.Thread(
                target=_drain_stream,
                args=(stream, log_fn),
                name=f"llama-{label}",
                daemon=True,
            )
            t.start()
            self._drain_threads.append(t)
        self._wait_healthy(timeout=120)
        return self.base_url

    def _wait_healthy(self, timeout: float) -> None:
        assert self.base_url
        deadline = time.time() + timeout
        urls = (
            f"http://127.0.0.1:{self.port}/health",
            f"http://127.0.0.1:{self.port}/v1/models",
            f"http://127.0.0.1:{self.port}/",
        )
        while time.time() < deadline:
            if self.process and self.process.poll() is not None:
                raise RuntimeError("llama-server exited early (check logs above for details)")
            for url in urls:
                try:
                    with urlopen(url, timeout=2) as resp:
                        if resp.status in (200, 404):
                            return
                except Exception:
                    continue
            time.sleep(0.5)
        raise RuntimeError("llama-server health check timeout")

    def stop(self) -> None:
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                try:
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    logger.warning("llama-server did not exit after kill")
            self.process = None
        self._drain_threads.clear()
        self.port = None
        self.base_url = None
