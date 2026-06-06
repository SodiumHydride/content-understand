"""Application logging — file + in-memory ring buffer for the UI."""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from engine.paths import app_data_root, ensure_app_dirs

_lock = threading.Lock()
_ring: deque[dict[str, Any]] = deque(maxlen=500)
_job_logs: dict[str, deque[dict[str, Any]]] = {}
_initialized = False


class _RingHandler(logging.Handler):
    """Capture log records into the in-memory ring buffer."""

    def __init__(self) -> None:
        super().__init__()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = {
                "ts": record.created,
                "level": record.levelname.lower(),
                "logger": record.name,
                "message": self.format(record),
            }
            with _lock:
                _ring.append(entry)
                job_id = getattr(record, "job_id", None)
                if job_id:
                    buf = _job_logs.setdefault(job_id, deque(maxlen=100))
                    buf.append(entry)
        except Exception:
            pass


def init_logging() -> Path:
    """Configure root logging once. Returns the log file path."""
    global _initialized
    ensure_app_dirs()
    log_dir = app_data_root() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "sidecar.log"

    if _initialized:
        return log_file

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    ring = _RingHandler()
    ring.setLevel(logging.INFO)
    ring.setFormatter(fmt)

    # Avoid duplicate handlers on reload
    root.handlers.clear()
    root.addHandler(fh)
    root.addHandler(ring)

    # Console for Electron sidecar subprocess
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    root.addHandler(ch)

    _initialized = True
    logging.getLogger(__name__).info("Logging initialized → %s", log_file)
    return log_file


class _JobLoggerAdapter(logging.LoggerAdapter):
    def process(self, msg, kwargs):
        extra = kwargs.setdefault("extra", {})
        extra["job_id"] = self.extra.get("job_id")
        return msg, kwargs


def bind_job_logger(job_id: str) -> _JobLoggerAdapter:
    """Return a logger that tags records with *job_id* for per-job buffers."""
    base = logging.getLogger("content.job")
    return _JobLoggerAdapter(base, {"job_id": job_id})


def recent_logs(
    *,
    limit: int = 100,
    level: str | None = None,
    job_id: str | None = None,
) -> list[dict[str, Any]]:
    """Return recent log entries newest-first."""
    with _lock:
        if job_id and job_id in _job_logs:
            items = list(_job_logs[job_id])
        else:
            items = list(_ring)

    if level:
        lvl = level.lower()
        items = [e for e in items if e.get("level") == lvl]

    items = sorted(items, key=lambda e: e.get("ts", 0), reverse=True)
    return items[: max(1, min(limit, 500))]


def job_log_lines(job_id: str, limit: int = 50) -> list[str]:
    """Plain-text lines for job API responses."""
    entries = recent_logs(limit=limit, job_id=job_id)
    return [
        f"{time.strftime('%H:%M:%S', time.localtime(e.get('ts', 0)))} "
        f"{e.get('level', 'info').upper()} {e.get('message', '')}"
        for e in reversed(entries)
    ]


def clear_job_logs(job_id: str) -> None:
    with _lock:
        _job_logs.pop(job_id, None)
