"""FFmpeg-based video preprocessor."""

from __future__ import annotations

import base64
import contextlib
import logging
import os
import shutil
import subprocess

from content_understand.config import FFmpegConfig
from content_understand.preprocessors.base import Preprocessor

logger = logging.getLogger(__name__)

_MIN_COMPRESSION_RATIO = 0.95


class FFmpegPreprocessor(Preprocessor):
    """Video preprocessor using ffmpeg for normalize/compress/trim/base64."""

    def __init__(self, config: FFmpegConfig | None = None) -> None:
        self.config = config or FFmpegConfig()

    def is_available(self) -> bool:
        return shutil.which("ffmpeg") is not None

    def process(self, input_path: str, output_path: str, **kwargs) -> str:
        result = self.normalize(input_path)
        return result if result is not None else input_path

    def normalize(self, input_path: str) -> str | None:
        if not self.is_available():
            return None

        output_path = input_path + ".normalized.mp4"
        cfg = self.config

        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-c:v",
                "libx264",
                "-profile:v",
                "baseline",
                "-level",
                "3.0",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                cfg.audio_bitrate,
                "-movflags",
                "+faststart",
                output_path,
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=cfg.normalize_timeout)
            if (
                result.returncode == 0
                and os.path.exists(output_path)
                and os.path.getsize(output_path) > 0
            ):
                return output_path
            self._safe_unlink(output_path)
            return None
        except Exception as e:
            logger.error("Normalization error: %s", e)
            self._safe_unlink(output_path)
            return None

    def compress(self, input_path: str, crf: int = 28, scale: str | None = None) -> str | None:
        if not self.is_available():
            return None

        output_path = input_path + ".compressed.mp4"
        cfg = self.config

        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-c:v",
                "libx264",
                "-crf",
                str(crf),
                "-preset",
                cfg.preset,
                "-c:a",
                "aac",
                "-b:a",
                cfg.audio_bitrate,
                "-movflags",
                "+faststart",
            ]
            if scale:
                cmd.extend(["-vf", f"scale={scale}"])
            cmd.append(output_path)

            result = subprocess.run(cmd, capture_output=True, timeout=cfg.compress_timeout)
            if (
                result.returncode == 0
                and os.path.exists(output_path)
                and os.path.getsize(output_path) > 0
            ):
                orig_size = os.path.getsize(input_path)
                new_size = os.path.getsize(output_path)
                ratio = new_size / orig_size if orig_size > 0 else 1.0
                if ratio < _MIN_COMPRESSION_RATIO:
                    return output_path
                self._safe_unlink(output_path)
                return None
            self._safe_unlink(output_path)
            return None
        except Exception as e:
            logger.error("Compression error: %s", e)
            self._safe_unlink(output_path)
            return None

    def compress_chain(self, input_path: str) -> str | None:
        cfg = self.config
        for crf in cfg.crf_values:
            result = self.compress(input_path, crf=crf)
            if result is not None:
                return result
        for crf in cfg.crf_values:
            for scale in cfg.scale_resolutions:
                result = self.compress(input_path, crf=crf, scale=scale)
                if result is not None:
                    return result
        return None

    def trim(self, input_path: str, seconds: int) -> str | None:
        if not self.is_available():
            return None

        output_path = input_path + ".trimmed.mp4"
        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-t",
                str(seconds),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                output_path,
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=self.config.trim_timeout)
            if (
                result.returncode == 0
                and os.path.exists(output_path)
                and os.path.getsize(output_path) > 0
            ):
                return output_path
            self._safe_unlink(output_path)
            return None
        except Exception as e:
            logger.error("Trim error: %s", e)
            self._safe_unlink(output_path)
            return None

    def get_duration(self, path: str) -> int | None:
        try:
            cmd = [
                "ffprobe",
                "-v",
                "quiet",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and result.stdout.strip():
                return int(float(result.stdout.strip()))
        except Exception as e:
            logger.warning("ffprobe duration error: %s", e)
        return None

    def encode_to_base64(self, path: str) -> str | None:
        cfg = self.config
        hard_limit = cfg.hard_b64_limit
        soft_limit = cfg.soft_b64_limit

        normalized_path = None
        compressed_path = None
        trimmed_path = None

        try:
            normalized_path = self.normalize(path)
            if normalized_path is None:
                normalized_path = path

            size = os.path.getsize(normalized_path)

            # Pre-check: skip base64 if raw file is obviously too large.
            # base64 adds ~33% overhead, so if raw > hard_limit * 0.75,
            # the encoded form will exceed hard_limit. Compress first.
            raw_limit = int(hard_limit * 0.75)
            if size > raw_limit:
                logger.info(
                    "File %d bytes exceeds raw limit %d, compressing first", size, raw_limit
                )
                compressed_path = self.compress_chain(normalized_path)
                if compressed_path:
                    if normalized_path != path:
                        self._safe_unlink(normalized_path)
                    normalized_path = compressed_path
                    compressed_path = None
                    size = os.path.getsize(normalized_path)
                else:
                    logger.warning(
                        "Compression failed for oversized file (%d bytes), cannot base64 encode",
                        size,
                    )
                    return None

            with open(normalized_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()

            b64_len = len(b64)

            if b64_len <= soft_limit:
                return b64

            if b64_len <= hard_limit:
                return b64

            duration = self.get_duration(normalized_path)
            if duration and duration > 60:
                raw_limit = int(hard_limit * 0.75)
                trim_sec = max(60, int(duration * raw_limit / size))
                trimmed_path = self.trim(normalized_path, trim_sec)
                if trimmed_path:
                    with open(trimmed_path, "rb") as f:
                        trimmed_b64 = base64.b64encode(f.read()).decode()
                    if len(trimmed_b64) <= hard_limit:
                        return trimmed_b64
                    self._safe_unlink(trimmed_path)
                    trimmed_path = None

            compressed_path = self.compress_chain(normalized_path)
            if compressed_path:
                with open(compressed_path, "rb") as f:
                    comp_b64 = base64.b64encode(f.read()).decode()
                if len(comp_b64) <= hard_limit:
                    return comp_b64

            return None

        finally:
            if normalized_path is not None and normalized_path != path:
                self._safe_unlink(normalized_path)
            self._safe_unlink(compressed_path)
            self._safe_unlink(trimmed_path)

    @staticmethod
    def _safe_unlink(path: str | None) -> None:
        if path and os.path.exists(path):
            with contextlib.suppress(OSError):
                os.unlink(path)
