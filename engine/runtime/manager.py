"""Local inference runtime: hardware → preset → download → llama-server / Ollama."""

from __future__ import annotations

import logging
import threading
import time as _time_mod
from pathlib import Path
from typing import Any, Callable

from engine.paths import app_data_root, models_dir, ensure_app_dirs
from engine.runtime.download import download_preset_files, preset_model_paths
from engine.runtime.hardware import HardwareProfile, probe_hardware
from engine.runtime.llama_bin import ensure_executable, find_llama_server
from engine.runtime.llama_install import ensure_llama_server_binary
from engine.runtime.ollama import detect_ollama, suggest_ollama_pull
from engine.runtime.presets import get_preset, recommend_preset, recommendation_summary
from engine.runtime.server import LlamaServerProcess

logger = logging.getLogger(__name__)

ProgressFn = Callable[[str, int, str], None]


class _Sentinel:
    """Distinguish 'not passed' from None."""


_UNSET = _Sentinel()

_manager: "RuntimeManager | None" = None


class RuntimeManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: str = "idle"  # idle | working | ready | error
        self._message: str = ""
        self._progress: dict[str, Any] = {"stage": "", "percent": 0, "message": ""}
        self._active_preset_id: str | None = None
        self._local_base_url: str | None = None
        self._backend: str | None = None  # llama_server | ollama
        self.hardware: HardwareProfile | None = None
        self.recommended_preset_id: str | None = None
        self._server = LlamaServerProcess()
        self._thread: threading.Thread | None = None
        self._status_cache: dict[str, Any] | None = None
        self._status_cache_ts: float = 0
        self._status_cache_ttl: float = 30.0

    def _set_state(
        self,
        *,
        state: str | None = None,
        message: str | None = None,
        progress: dict[str, Any] | None = None,
        active_preset_id: str | _SENTINEL = _UNSET,
        local_base_url: str | None | _SENTINEL = _UNSET,
        backend: str | None | _SENTINEL = _UNSET,
    ) -> None:
        with self._lock:
            if state is not None:
                self._state = state
            if message is not None:
                self._message = message
            if progress is not None:
                self._progress = progress
            if active_preset_id is not _UNSET:
                self._active_preset_id = active_preset_id
            if local_base_url is not _UNSET:
                self._local_base_url = local_base_url
            if backend is not _UNSET:
                self._backend = backend

    def _get_state(self) -> dict[str, Any]:
        """Atomic snapshot of all mutable state fields."""
        with self._lock:
            return {
                "state": self._state,
                "message": self._message,
                "progress": self._progress,
                "active_preset_id": self._active_preset_id,
                "local_base_url": self._local_base_url,
                "backend": self._backend,
            }

    def _invalidate_status_cache(self) -> None:
        self._status_cache = None
        self._status_cache_ts = 0

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    @property
    def message(self) -> str:
        with self._lock:
            return self._message

    @property
    def backend(self) -> str | None:
        with self._lock:
            return self._backend

    @property
    def local_base_url(self) -> str | None:
        with self._lock:
            return self._local_base_url

    @property
    def active_preset_id(self) -> str | None:
        with self._lock:
            return self._active_preset_id

    def mark_ollama_ready(self, base_url: str) -> None:
        """Fast-path: Ollama already running, skip setup worker."""
        self._set_state(
            backend="ollama",
            local_base_url=base_url,
            active_preset_id=None,
            state="ready",
            message="using Ollama",
        )
        self._invalidate_status_cache()

    def mark_idle(self) -> None:
        self._set_state(state="idle")
        self._invalidate_status_cache()

    def status(self) -> dict[str, Any]:
        now = _time_mod.monotonic()
        if self._status_cache and (now - self._status_cache_ts) < self._status_cache_ttl:
            return self._status_cache

        snap = self._get_state()
        hw = self.hardware or probe_hardware()
        preset = get_preset(snap["active_preset_id"] or self.recommended_preset_id or "")
        ollama = detect_ollama()
        llama_bin = find_llama_server(app_data_root() / "runtime")
        result: dict[str, Any] = {
            "state": snap["state"],
            "message": snap["message"],
            "progress": snap["progress"],
            "hardware": hw.to_dict(),
            "recommended_preset_id": self.recommended_preset_id,
            "active_preset_id": snap["active_preset_id"],
            "local_base_url": snap["local_base_url"],
            "backend": snap["backend"],
            "ollama": ollama,
            "llama_server_found": llama_bin is not None,
            "llama_server_path": str(llama_bin) if llama_bin else None,
            "preset": preset,
            "recommendation_text_zh": recommendation_summary(hw, preset or {}, "zh")
            if preset
            else "",
            "ollama_pull_hint": suggest_ollama_pull(preset or {}) if preset else None,
        }
        self._status_cache = result
        self._status_cache_ts = _time_mod.monotonic()
        return result

    def refresh_hardware(self) -> HardwareProfile:
        self.hardware = probe_hardware()
        rec = recommend_preset(self.hardware)
        self.recommended_preset_id = rec.get("id")
        return self.hardware

    def setup_async(
        self,
        preset_id: str | None = None,
        *,
        prefer_ollama: bool = False,
        on_progress: ProgressFn | None = None,
    ) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._state = "working"
            self._message = "starting"
            self._thread = threading.Thread(
                target=self._setup_worker,
                args=(preset_id, prefer_ollama, on_progress),
                daemon=True,
            )
            self._thread.start()

    def _setup_worker(
        self,
        preset_id: str | None,
        prefer_ollama: bool,
        on_progress: ProgressFn | None,
    ) -> None:
        def prog(stage: str, percent: int, message: str) -> None:
            self._set_state(progress={"stage": stage, "percent": percent, "message": message})
            if on_progress:
                on_progress(stage, percent, message)

        try:
            ensure_app_dirs()
            hw = self.refresh_hardware()
            pid = preset_id or self.recommended_preset_id
            preset = get_preset(pid or "")
            if not preset:
                raise RuntimeError(f"Unknown preset: {pid}")

            self._set_state(active_preset_id=preset["id"])
            prog("resolve", 5, preset["id"])

            ollama = detect_ollama()
            if prefer_ollama and ollama.get("available"):
                self._set_state(
                    backend="ollama",
                    local_base_url=ollama["base_url"],
                    state="ready",
                    message="using Ollama",
                )
                self._invalidate_status_cache()
                prog("done", 100, "ollama")
                return

            models_path = models_dir()
            main, mmproj = preset_model_paths(preset, models_path)
            if not main:
                prog("download", 10, "huggingface")
                download_preset_files(preset, models_path, on_progress=prog)
                main, mmproj = preset_model_paths(preset, models_path)

            if not main or not main.exists():
                raise RuntimeError(
                    f"Model files missing after download. Check HF repo filenames for {preset['id']}"
                )

            runtime_root = app_data_root() / "runtime"
            binary = find_llama_server(runtime_root)
            if not binary:
                prog("download", 12, "llama.cpp")
                binary = ensure_llama_server_binary(runtime_root, on_progress=prog)
            ensure_executable(binary)

            prog("model", 90, "llama-server")
            base = self._server.start(
                binary,
                main,
                mmproj_path=mmproj,
                llama_opts=preset.get("llama"),
            )
            self._set_state(
                backend="llama_server",
                local_base_url=base,
                state="ready",
                message="ready",
            )
            self._invalidate_status_cache()
            prog("done", 100, "ready")
            logger.info("Local runtime ready at %s preset=%s hw=%s", base, preset["id"], hw.to_dict())

        except Exception as exc:
            logger.exception("Runtime setup failed")
            self._set_state(state="error", message=str(exc))
            self._invalidate_status_cache()
            prog("model", 0, str(exc))

    def stop(self) -> None:
        self._server.stop()
        self._set_state(
            state="idle",
            local_base_url=None,
            backend=None,
            message="stopped",
        )
        self._invalidate_status_cache()

    def resolve_local_base_url(self, inference_mode: str) -> str | None:
        """Return injected OpenAI-compatible base URL if local should be used."""
        if inference_mode in ("api_only",):
            return None
        snap = self._get_state()
        if snap["state"] == "ready" and snap["local_base_url"]:
            if inference_mode in ("prefer_local", "local_only"):
                return snap["local_base_url"]
            if inference_mode == "prefer_api":
                return None  # caller checks API first
        return None


def get_runtime_manager() -> RuntimeManager:
    global _manager
    if _manager is None:
        _manager = RuntimeManager()
    return _manager
