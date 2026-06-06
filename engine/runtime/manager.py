"""Local inference runtime — Ollama-only with curated preset catalog."""

from __future__ import annotations

import logging
import threading
import time as _time_mod
from collections.abc import Callable
from typing import Any

from engine.paths import app_data_root, ensure_app_dirs, models_dir
from engine.runtime.hardware import HardwareProfile, probe_hardware
from engine.runtime.ollama_api import is_running as ollama_is_running
from engine.runtime.ollama_api import list_models as ollama_list_models
from engine.runtime.ollama_api import pull_model as ollama_pull_model
from engine.runtime.ollama_catalog import (
    build_catalog_view,
    default_modality_models,
    model_is_installed,
    preset_for_id,
    validate_preset_pull,
)
from engine.runtime.ollama_manager import (
    detect_app_ollama,
    detect_user_ollama,
    download_ollama,
    find_app_binary,
    get_shared_daemon,
    app_download_state,
    is_app_ollama_installed,
    remove_app_ollama,
    resolve_active_ollama,
    stop_shared_daemon,
)
from engine.runtime.presets import get_preset, recommend_preset, recommendation_summary
from engine.runtime.state import (
    get_modality_models,
    get_selected_preset_id,
    set_modality_model,
    set_modality_models,
    set_selected_preset_id,
)

logger = logging.getLogger(__name__)

ProgressFn = Callable[[str, int, str], None]

_manager: RuntimeManager | None = None
_manager_lock = threading.Lock()


class RuntimeManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: str = "idle"
        self._message: str = ""
        self._progress: dict[str, Any] = {"stage": "", "percent": 0, "message": ""}
        self._local_base_url: str | None = None
        self._ollama_source: str | None = None
        self.hardware: HardwareProfile | None = None
        self.recommended_preset_id: str | None = None
        self._thread: threading.Thread | None = None
        self._pull_thread: threading.Thread | None = None
        self._pulling_preset_id: str | None = None
        self._pull_start_ts: float = 0.0
        self._status_cache: dict[str, Any] | None = None
        self._status_cache_ts: float = 0
        self._status_cache_ttl: float = 15.0
        self._prefer_user_ollama: bool = True

        # Health monitoring
        self._health_thread: threading.Thread | None = None
        self._health_stop_event = threading.Event()
        self._restart_lock = threading.Lock()  # prevents concurrent restart attempts
        self._ollama_health: str = "unknown"  # "healthy" | "unhealthy" | "unknown" | "restarting"
        self._ollama_last_health_check: float = 0.0
        self._ollama_restart_count: int = 0

        saved = get_modality_models()
        if saved:
            self._modality_models = saved
        else:
            self._modality_models = {}

    def _set_state(
        self,
        *,
        state: str | None = None,
        message: str | None = None,
        progress: dict[str, Any] | None = None,
        local_base_url: str | None = None,
        ollama_source: str | None = None,
    ) -> None:
        with self._lock:
            if state is not None:
                self._state = state
                self._status_cache = None
            if message is not None:
                self._message = message
            if progress is not None:
                self._progress = progress
                self._status_cache = None
            if local_base_url is not None:
                self._local_base_url = local_base_url
                self._status_cache = None
            if ollama_source is not None:
                self._ollama_source = ollama_source
                self._status_cache = None

    def _get_state(self) -> dict[str, Any]:
        with self._lock:
            return {
                "state": self._state,
                "message": self._message,
                "progress": self._progress,
                "local_base_url": self._local_base_url,
                "ollama_source": self._ollama_source,
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
    def local_base_url(self) -> str | None:
        with self._lock:
            return self._local_base_url

    @property
    def ollama_source(self) -> str | None:
        with self._lock:
            return self._ollama_source

    def set_prefer_user_ollama(self, prefer: bool) -> None:
        self._prefer_user_ollama = prefer

    def prefer_user_ollama(self) -> bool:
        return self._prefer_user_ollama

    def operation_snapshot(self) -> dict[str, Any]:
        snap = self._get_state()
        with self._lock:
            pulling = (
                self._pulling_preset_id
                if self._pull_thread and self._pull_thread.is_alive()
                else None
            )
            setup_running = self._thread is not None and self._thread.is_alive()
        return {
            "state": snap["state"],
            "message": snap["message"],
            "progress": snap["progress"],
            "pulling_preset_id": pulling,
            "setup_running": setup_running,
            "ollama_health": self._ollama_health,
            "ollama_last_health_check": self._ollama_last_health_check,
            "ollama_restart_count": self._ollama_restart_count,
        }

    # ── Per-modality routing ────────────────────────────────────────────────

    def set_modality_model(self, modality: str, model: str) -> None:
        from engine.runtime.ollama_catalog import preset_for_model

        if not preset_for_model(model):
            logger.info("Setting modality '%s' to non-preset model '%s'", modality, model)
        with self._lock:
            self._modality_models[modality] = model
            set_modality_model(modality, model)
            self._invalidate_status_cache()

    def get_modality_model(self, modality: str) -> str | None:
        with self._lock:
            return self._modality_models.get(modality)

    def get_all_modality_models(self) -> dict[str, str]:
        with self._lock:
            return dict(self._modality_models)

    def apply_preset(self, preset_id: str) -> dict[str, Any]:
        preset = preset_for_id(preset_id)
        if not preset:
            raise ValueError(f"Unknown preset '{preset_id}'")
        set_selected_preset_id(preset_id)
        routing = default_modality_models(preset)
        with self._lock:
            self._modality_models = routing
        set_modality_models(routing)
        self._invalidate_status_cache()
        return preset

    def selected_preset_id(self) -> str | None:
        return get_selected_preset_id() or self.recommended_preset_id

    # ── Catalog / status ────────────────────────────────────────────────────

    def catalog(self) -> dict[str, Any]:
        ensure_app_dirs()
        runtime_dir = app_data_root() / "runtime"
        if self.hardware is None:
            self.refresh_hardware()
        base, source = resolve_active_ollama(runtime_dir, prefer_user=self._prefer_user_ollama)
        running = base is not None
        installed_raw = ollama_list_models(base) if base else []
        dl = app_download_state()
        view = build_catalog_view(
            installed_raw=installed_raw,
            selected_preset_id=self.selected_preset_id(),
            recommended_preset_id=self.recommended_preset_id,
            source=source,
            running=running,
            app_binary_installed=is_app_ollama_installed(runtime_dir),
            models_dir=str(models_dir()),
            app_download_in_progress=bool(dl.get("running")),
            app_download_error=dl.get("error") if isinstance(dl.get("error"), str) else None,
        )
        view["operation"] = self.operation_snapshot()
        return view

    def mark_ollama_ready(self, base_url: str, source: str) -> None:
        self._set_state(
            local_base_url=base_url,
            ollama_source=source,
            state="ready",
            message=f"using {source} Ollama",
        )
        self._invalidate_status_cache()
        if source == "app":
            self._start_health_thread()

    def mark_idle(self) -> None:
        self._set_state(state="idle", message="", local_base_url=None, ollama_source=None)
        self._invalidate_status_cache()

    # ── Health monitoring ──────────────────────────────────────────────────

    def _start_health_thread(self) -> None:
        """Start the background health check thread (only if not already running)."""
        with self._lock:
            if self._health_thread and self._health_thread.is_alive():
                return
            self._health_stop_event.clear()
            self._ollama_restart_count = 0
            self._ollama_health = "unknown"
            self._health_thread = threading.Thread(
                target=self._health_check_loop,
                name="ollama-health",
                daemon=True,
            )
            self._health_thread.start()
            logger.info("Ollama health monitor started")

    def _stop_health_thread(self) -> None:
        """Signal the health check thread to stop and wait for it."""
        self._health_stop_event.set()
        with self._lock:
            thread = self._health_thread
        if thread and thread.is_alive():
            thread.join(timeout=10)
        with self._lock:
            self._health_thread = None

    def _health_check_loop(self) -> None:
        """Background loop: check Ollama health every 30 seconds."""
        while not self._health_stop_event.wait(timeout=30.0):
            try:
                self._perform_health_check()
            except Exception:
                logger.exception("Health check iteration failed")

    def _perform_health_check(self) -> None:
        """Run one health check cycle."""
        # Skip health check if a model pull is in progress — Ollama may be
        # slow to respond during large downloads, causing false positives.
        with self._lock:
            pull_in_progress = self._pull_thread is not None and self._pull_thread.is_alive()
        if pull_in_progress:
            logger.debug("Health check skipped — model pull in progress")
            return

        snap = self._get_state()
        source = snap.get("ollama_source")
        base_url = snap.get("local_base_url")

        if not base_url or snap.get("state") != "ready":
            with self._lock:
                self._ollama_health = "unknown"
                self._ollama_last_health_check = _time_mod.monotonic()
            return

        # Step 1: If we own the process, check if it's still alive
        process_alive = True
        if source == "app":
            daemon = get_shared_daemon()
            if daemon.process is not None:
                retcode = daemon.process.poll()
                if retcode is not None:
                    logger.warning("Ollama process exited with code %d", retcode)
                    process_alive = False

        # Step 2: Check API responsiveness
        api_ok = False
        if process_alive:
            api_ok = ollama_is_running(base_url)

        now = _time_mod.monotonic()
        with self._lock:
            self._ollama_last_health_check = now

        if process_alive and api_ok:
            with self._lock:
                self._ollama_health = "healthy"
                self._ollama_restart_count = 0
            return

        # Unhealthy
        logger.warning(
            "Ollama unhealthy: process_alive=%s api_ok=%s source=%s",
            process_alive, api_ok, source,
        )

        # Only attempt restart if we own the process
        if source != "app":
            with self._lock:
                self._ollama_health = "unhealthy"
            return

        if self._health_stop_event.is_set():
            return

        self._attempt_restart()

    def _attempt_restart(self) -> None:
        """Try to restart Ollama up to 3 times with 5s backoff."""
        # Prevent concurrent restart attempts from overlapping health check cycles
        if not self._restart_lock.acquire(blocking=False):
            logger.debug("Restart already in progress — skipping")
            return
        try:
            self._do_restart()
        finally:
            self._restart_lock.release()

    def _do_restart(self) -> None:
        """Actual restart logic (must be called with _restart_lock held)."""
        max_retries = 3
        backoff = 5.0

        with self._lock:
            if self._ollama_restart_count >= max_retries:
                self._ollama_health = "error"
                logger.error(
                    "Ollama health: gave up after %d restart attempts", max_retries,
                )
                return
            self._ollama_health = "restarting"

        for attempt in range(max_retries):
            if self._health_stop_event.is_set():
                return

            with self._lock:
                self._ollama_restart_count += 1
                current_count = self._ollama_restart_count

            logger.warning(
                "Ollama restart attempt %d/%d", current_count, max_retries,
            )

            try:
                daemon = get_shared_daemon()
                runtime_dir = app_data_root() / "runtime"
                base = daemon.start(runtime_dir, models_dir())

                # Verify it actually came up
                if ollama_is_running(base):
                    with self._lock:
                        self._ollama_health = "healthy"
                        self._ollama_restart_count = 0
                    self._set_state(
                        local_base_url=base,
                        ollama_source="app",
                        state="ready",
                        message="Ollama restarted successfully",
                    )
                    self._invalidate_status_cache()
                    logger.info("Ollama restarted successfully at %s", base)
                    return
            except Exception as exc:
                logger.warning("Ollama restart attempt %d failed: %s", current_count, exc)

            if self._health_stop_event.is_set():
                return

            if current_count >= max_retries:
                break

            self._health_stop_event.wait(timeout=backoff)

        # All retries exhausted
        with self._lock:
            self._ollama_health = "error"
        self._set_state(
            state="error",
            message="Ollama died and restart failed after 3 attempts",
        )
        self._invalidate_status_cache()
        logger.error("Ollama health: gave up after %d restart attempts", max_retries)

    def status(self) -> dict[str, Any]:
        now = _time_mod.monotonic()
        if self._status_cache and (now - self._status_cache_ts) < self._status_cache_ttl:
            return self._status_cache

        snap = self._get_state()
        hw = self.hardware or probe_hardware()
        preset = get_preset(self.selected_preset_id() or "")
        catalog = self.catalog()

        result: dict[str, Any] = {
            **snap,
            "hardware": hw.to_dict(),
            "recommended_preset_id": self.recommended_preset_id,
            "selected_preset_id": self.selected_preset_id(),
            "preset": preset,
            "catalog": catalog,
            "recommendation_text_zh": recommendation_summary(hw, preset or {}, "zh") if preset else "",
            "recommendation_text_en": recommendation_summary(hw, preset or {}, "en") if preset else "",
            "modality_models": self.get_all_modality_models(),
            "ollama_health": self._ollama_health,
            "ollama_last_health_check": self._ollama_last_health_check,
            "ollama_restart_count": self._ollama_restart_count,
        }
        self._status_cache = result
        self._status_cache_ts = _time_mod.monotonic()
        return result

    def refresh_hardware(self) -> HardwareProfile:
        self.hardware = probe_hardware()
        rec = recommend_preset(self.hardware)
        self.recommended_preset_id = rec.get("id")
        if not get_selected_preset_id() and self.recommended_preset_id:
            self.apply_preset(self.recommended_preset_id)
        return self.hardware

    def sync_running(self) -> tuple[str | None, str | None]:
        runtime_dir = app_data_root() / "runtime"
        base, source = resolve_active_ollama(runtime_dir, prefer_user=self._prefer_user_ollama)
        if base:
            self.mark_ollama_ready(base, source or "user")
        return base, source

    def setup_async(
        self,
        on_progress: ProgressFn | None = None,
        *,
        prefer_user: bool | None = None,
        pull_preset: bool = True,
    ) -> None:
        if prefer_user is not None:
            self._prefer_user_ollama = prefer_user

        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._state = "working"
            self._message = "starting"
            self._thread = threading.Thread(
                target=self._setup_worker,
                args=(on_progress, pull_preset),
                daemon=True,
            )
            self._thread.start()

    def ensure_running_sync(
        self,
        on_progress: ProgressFn | None = None,
        *,
        prefer_user: bool | None = None,
        pull_preset: bool = False,
    ) -> str:
        """Blocking setup — returns Ollama base URL or raises."""
        if prefer_user is not None:
            self._prefer_user_ollama = prefer_user
        with self._lock:
            if self._thread and self._thread.is_alive():
                self._thread.join(timeout=600)

        snap = self._get_state()
        if snap["state"] == "ready" and snap["local_base_url"]:
            return snap["local_base_url"]

        runtime_dir = app_data_root() / "runtime"
        base, source = resolve_active_ollama(runtime_dir, prefer_user=self._prefer_user_ollama)
        if base:
            self.mark_ollama_ready(base, source or "user")
            if pull_preset:
                self._pull_selected_if_needed(base, on_progress)
            return base

        self._setup_worker(on_progress, pull_preset)
        snap = self._get_state()
        if snap["state"] != "ready" or not snap["local_base_url"]:
            raise RuntimeError(snap["message"] or "Ollama setup failed")
        return snap["local_base_url"]

    def _pull_selected_if_needed(self, base: str, on_progress: ProgressFn | None) -> None:
        preset_id = self.selected_preset_id()
        if not preset_id:
            return
        model_name, _ = validate_preset_pull(preset_id)
        raw = ollama_list_models(base)
        if model_is_installed(raw, model_name):
            return
        if on_progress:
            on_progress("download", 60, f"pulling {model_name}")
        if not ollama_pull_model(base, model_name, on_progress=on_progress):
            raise RuntimeError(f"Failed to pull catalog model '{model_name}'")

    def _setup_worker(self, on_progress: ProgressFn | None, pull_preset: bool) -> None:
        def prog(stage: str, percent: int, message: str) -> None:
            self._set_state(progress={"stage": stage, "percent": percent, "message": message})
            if on_progress:
                on_progress(stage, percent, message)

        try:
            ensure_app_dirs()
            self.refresh_hardware()
            runtime_dir = app_data_root() / "runtime"
            prog("resolve", 5, "checking Ollama")

            if self._prefer_user_ollama and detect_user_ollama():
                base = detect_user_ollama()
                self.mark_ollama_ready(base or "", "user")
                prog("done", 100, "user-ollama")
                return

            if detect_app_ollama():
                base = detect_app_ollama()
                self.mark_ollama_ready(base or "", "app")
                prog("done", 100, "app-ollama")
                return

            if not find_app_binary(runtime_dir):
                prog("download", 10, "downloading app Ollama")
                download_ollama(runtime_dir, on_progress=prog)

            prog("model", 30, "starting app Ollama")
            daemon = get_shared_daemon()
            base = daemon.start(runtime_dir, models_dir())
            self.mark_ollama_ready(base, "app")

            if pull_preset:
                self._pull_selected_if_needed(base, on_progress)

            self._invalidate_status_cache()
            prog("done", 100, "ready")
            logger.info("Local runtime ready at %s (app)", base)

        except Exception as exc:
            logger.exception("Runtime setup failed")
            self._set_state(state="error", message=str(exc))
            self._invalidate_status_cache()
            prog("model", 0, str(exc))

    def pull_preset(self, preset_id: str, on_progress: ProgressFn | None = None) -> bool:
        model_name, _preset = validate_preset_pull(preset_id)
        self.apply_preset(preset_id)
        base = self.ensure_running_sync(
            on_progress,
            prefer_user=self._prefer_user_ollama,
            pull_preset=False,
        )
        raw = ollama_list_models(base)
        if model_is_installed(raw, model_name):
            return True
        ok = ollama_pull_model(base, model_name, on_progress=on_progress)
        if not ok:
            raise RuntimeError(f"Failed to pull catalog model '{model_name}'")
        return True

    def pull_preset_async(self, preset_id: str) -> dict[str, Any]:
        """Pull a catalog model in the background (does not block the sidecar)."""
        model_name, _ = validate_preset_pull(preset_id)

        with self._lock:
            if self._pull_thread and self._pull_thread.is_alive():
                return {
                    "ok": True,
                    "status": "in_progress",
                    "preset_id": self._pulling_preset_id,
                    "name": model_name,
                }

        runtime_dir = app_data_root() / "runtime"
        base, _ = resolve_active_ollama(runtime_dir, prefer_user=self._prefer_user_ollama)
        if base:
            raw = ollama_list_models(base)
            if model_is_installed(raw, model_name):
                self.apply_preset(preset_id)
                return {
                    "ok": True,
                    "status": "already_installed",
                    "preset_id": preset_id,
                    "name": model_name,
                }

        with self._lock:
            self._pulling_preset_id = preset_id
            self._pull_start_ts = _time_mod.monotonic()
            self._set_state(
                state="working",
                message=f"pulling {model_name}",
                progress={"stage": "pull", "percent": 0, "message": "preparing"},
            )
            self._pull_thread = threading.Thread(
                target=self._pull_worker,
                args=(preset_id,),
                daemon=True,
                name="ollama-pull",
            )
            self._pull_thread.start()

        return {
            "ok": True,
            "status": "started",
            "preset_id": preset_id,
            "name": model_name,
        }

    def _pull_worker(self, preset_id: str) -> None:
        def prog(info: dict[str, Any] | str, percent: int = 0, message: str = "") -> None:
            if isinstance(info, dict):
                stage = info.get("stage", "pull")
                pct = info.get("percent", 0)
                msg = info.get("message", "")
                logger.info("Pull %s: [%s] %s%% %s", preset_id, stage, pct, msg)
                self._set_state(
                    progress={
                        "stage": stage,
                        "percent": pct,
                        "message": msg,
                        "total_bytes": info.get("total_bytes", 0),
                        "completed_bytes": info.get("completed_bytes", 0),
                        "speed_bps": info.get("speed_bps", 0.0),
                        "elapsed_sec": _time_mod.monotonic() - self._pull_start_ts
                        if hasattr(self, "_pull_start_ts")
                        else 0.0,
                    },
                )
            else:
                logger.info("Pull %s: [%s] %s%% %s", preset_id, info, percent, message)
                self._set_state(
                    progress={"stage": info, "percent": percent, "message": message},
                )

        try:
            logger.info("Pull started: preset=%s", preset_id)
            self.pull_preset(preset_id, on_progress=prog)
            base = self.local_base_url
            source = self.ollama_source
            self._set_state(
                state="ready",
                message="pull complete",
                progress={"stage": "done", "percent": 100, "message": "done"},
                local_base_url=base,
                ollama_source=source,
            )
        except Exception as exc:
            logger.exception("Preset pull failed")
            self._set_state(state="error", message=str(exc)[:500])
        finally:
            self._invalidate_status_cache()

    def stop(self) -> None:
        self._stop_health_thread()
        stop_shared_daemon()
        with self._lock:
            self._ollama_health = "unknown"
            self._ollama_restart_count = 0
        self._set_state(state="idle", local_base_url=None, ollama_source=None, message="stopped")
        self._invalidate_status_cache()

    def shutdown(self) -> None:
        self.stop()

    def uninstall_app_ollama(self) -> None:
        """Remove app binary only — never touches user/system Ollama."""
        self.stop()
        remove_app_ollama(app_data_root() / "runtime")
        self._invalidate_status_cache()

    def resolve_local_base_url(self, inference_mode: str) -> str | None:
        if inference_mode in ("api_only",):
            return None
        snap = self._get_state()
        if snap["state"] == "ready" and snap["local_base_url"]:
            if inference_mode in ("prefer_local", "local_only"):
                return snap["local_base_url"]
        base, _ = self.sync_running()
        if base:
            return base
        if inference_mode == "local_only":
            try:
                return self.ensure_running_sync(pull_preset=False)
            except Exception:
                return None
        if inference_mode == "prefer_local":
            try:
                return self.ensure_running_sync(pull_preset=False)
            except Exception:
                return None
        return None

    def resolve_model_for_modality(self, modality: str) -> str | None:
        explicit = self.get_modality_model(modality)
        if explicit:
            return explicit
        preset = get_preset(self.selected_preset_id() or "")
        if not preset:
            return None
        model = str(preset.get("ollama_model", "")).strip()
        if modality in preset.get("modalities", []):
            return model or None
        return None


def get_runtime_manager() -> RuntimeManager:
    global _manager
    if _manager is None:
        with _manager_lock:
            if _manager is None:
                _manager = RuntimeManager()
    return _manager
