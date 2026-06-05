"""Download curated GGUF files into app models directory."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

ProgressFn = Callable[[str, int, str], None]


def download_preset_files(
    preset: dict,
    dest_dir: Path,
    on_progress: ProgressFn | None = None,
) -> list[Path]:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as e:
        raise RuntimeError(
            "Install huggingface_hub: pip install huggingface_hub>=0.26.0"
        ) from e

    dest_dir.mkdir(parents=True, exist_ok=True)
    files = preset.get("files", [])
    saved: list[Path] = []

    for i, spec in enumerate(files):
        repo = spec["repo_id"]
        fname = spec["filename"]
        optional = spec.get("optional", False)
        if on_progress:
            pct = int(10 + (80 * i / max(len(files), 1)))
            on_progress("download", pct, f"{repo}/{fname}")

        try:
            path = hf_hub_download(
                repo_id=repo,
                filename=fname,
                local_dir=str(dest_dir),
            )
            saved.append(Path(path))
            logger.info("Downloaded %s", path)
        except Exception as exc:
            if optional:
                logger.warning("Optional file skipped %s/%s: %s", repo, fname, exc)
                continue
            raise RuntimeError(f"Failed to download {repo}/{fname}: {exc}") from exc

    if on_progress:
        on_progress("download", 95, "done")
    return saved


def preset_model_paths(preset: dict, models_dir: Path) -> tuple[Path | None, Path | None]:
    """Return (main_gguf, mmproj) if present on disk."""
    main_path = None
    mmproj_path = None
    for spec in preset.get("files", []):
        p = models_dir / spec["filename"]
        if not p.exists():
            # hf_hub_download may nest under repo structure
            alt = models_dir / spec["repo_id"].split("/")[-1] / spec["filename"]
            if alt.exists():
                p = alt
            else:
                continue
        if "mmproj" in spec["filename"].lower():
            mmproj_path = p
        else:
            main_path = p
    return main_path, mmproj_path
