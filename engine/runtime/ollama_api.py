"""Ollama API client for model management."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

ProgressFn = Callable[..., None]


def _api_get(base_url: str, path: str, timeout: float = 10) -> dict:
    req = Request(f"{base_url}{path}", method="GET")
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _api_post(base_url: str, path: str, body: dict, timeout: float = 30) -> dict:
    data = json.dumps(body).encode()
    req = Request(
        f"{base_url}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _api_delete(base_url: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body else None
    req = Request(
        f"{base_url}{path}",
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="DELETE",
    )
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def is_running(base_url: str) -> bool:
    """Check if Ollama API is responsive."""
    try:
        _api_get(base_url, "/api/version")
        return True
    except Exception:
        return False


def get_version(base_url: str) -> str | None:
    """Get Ollama version string."""
    try:
        data = _api_get(base_url, "/api/version")
        return data.get("version")
    except Exception:
        return None


def list_models(base_url: str) -> list[dict[str, Any]]:
    """List all locally available models.

    Returns list of dicts with keys: name, size, digest, modified_at, details.
    """
    try:
        data = _api_get(base_url, "/api/tags")
        return data.get("models", [])
    except Exception:
        return []


def list_running(base_url: str) -> list[dict[str, Any]]:
    """List models currently loaded in memory."""
    try:
        data = _api_get(base_url, "/api/ps")
        return data.get("models", [])
    except Exception:
        return []


def _call_progress(
    on_progress: ProgressFn,
    stage: str,
    pct: int,
    message: str,
    total_bytes: int,
    completed_bytes: int,
    speed_bps: float,
) -> None:
    """Call progress callback with backward compatibility.

    Tries the new dict-based signature first. If the callback only
    accepts positional (stage, percent, message), falls back to that.
    """
    try:
        import inspect

        sig = inspect.signature(on_progress)
        # If the callback accepts **kwargs or a single dict param, use new format
        params = list(sig.parameters.values())
        has_var_keyword = any(
            p.kind == inspect.Parameter.VAR_KEYWORD for p in params
        )
        if has_var_keyword or len(params) != 3:
            on_progress({
                "stage": stage,
                "percent": pct,
                "message": message,
                "total_bytes": total_bytes,
                "completed_bytes": completed_bytes,
                "speed_bps": speed_bps,
            })
            return
    except (ValueError, TypeError):
        pass
    # Fallback: old 3-arg signature
    on_progress(stage, pct, message)


def pull_model(base_url: str, name: str, on_progress: ProgressFn | None = None) -> bool:
    """Pull a model from Ollama registry. Streams progress updates.

    The on_progress callback receives a dict with keys:
        stage, percent, message, total_bytes, completed_bytes, speed_bps

    Backward compatible: if the callback only accepts 3 positional args,
    it is called with (stage, percent, message) instead.

    Returns True on success, False on failure.
    """
    import time

    data = json.dumps({"name": name, "stream": True}).encode()
    req = Request(
        f"{base_url}/api/pull",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(req, timeout=3600) as resp:
            total = 0
            completed = 0
            prev_completed = 0
            prev_time = time.monotonic()
            speed_window: list[tuple[float, int]] = []  # (time, completed_bytes)

            for raw_line in resp:
                line = raw_line.decode(errors="replace").strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                status = msg.get("status", "")
                if "total" in msg:
                    total = msg["total"]
                if "completed" in msg:
                    completed = msg["completed"]

                # Compute smoothed speed from rolling window (max 5 samples)
                now = time.monotonic()
                speed_bps = 0.0
                if completed > 0 and "completed" in msg:
                    speed_window.append((now, completed))
                    if len(speed_window) > 5:
                        speed_window = speed_window[-5:]
                    if len(speed_window) >= 2:
                        t0, b0 = speed_window[0]
                        t1, b1 = speed_window[-1]
                        dt = t1 - t0
                        if dt > 0:
                            speed_bps = (b1 - b0) / dt

                if on_progress and total > 0:
                    pct = int(completed / total * 100)
                    _call_progress(
                        on_progress, "download", pct, status,
                        total, completed, speed_bps,
                    )
                elif on_progress:
                    _call_progress(
                        on_progress, "download", 0, status,
                        total, completed, speed_bps,
                    )

                if status == "success":
                    if on_progress:
                        _call_progress(
                            on_progress, "download", 100, "done",
                            total, completed, 0.0,
                        )
                    return True

        return True
    except Exception as exc:
        logger.error("Failed to pull model %s: %s", name, exc)
        return False


def delete_model(base_url: str, name: str) -> bool:
    """Delete a model from local storage."""
    try:
        _api_delete(base_url, "/api/delete", {"name": name})
        return True
    except Exception as exc:
        logger.error("Failed to delete model %s: %s", name, exc)
        return False


def show_model(base_url: str, name: str) -> dict[str, Any] | None:
    """Get model details (template, parameters, modelfile)."""
    try:
        return _api_post(base_url, "/api/show", {"name": name})
    except Exception:
        return None


def generate(
    base_url: str,
    model: str,
    prompt: str,
    images: list[str] | None = None,
    stream: bool = False,
    timeout: float = 300,
) -> dict | None:
    """Run a generation (non-chat). Supports images for multimodal."""
    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": stream,
    }
    if images:
        body["images"] = images
    try:
        return _api_post(base_url, "/api/generate", body, timeout=timeout)
    except Exception as exc:
        logger.error("Generation failed: %s", exc)
        return None
