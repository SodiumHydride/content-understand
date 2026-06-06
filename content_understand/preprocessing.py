"""Content preprocessor — decomposes inputs based on model capabilities.

Design:
- FrameConfig: configurable frame extraction parameters (replaces hardcoded fps/max_frames)
- AudioConfig: audio separation parameters
- ContentPreprocessor: the single entry point that builds ContentBundle from raw input

The preprocessor is capability-aware: it only does work the model needs.
No frame extraction if the model eats video natively.
No audio separation if the model ignores audio.
"""

from __future__ import annotations

import base64
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from content_understand.capabilities import (
    ContentBundle,
    InputStrategy,
    ModelCapabilities,
)

logger = logging.getLogger(__name__)


@dataclass
class FrameConfig:
    """Frame extraction configuration — user-adjustable, replaces hardcoded values.

    Default values are chosen for general-purpose video understanding:
    - 1 FPS matches Gemini's default and works well for most content
    - 30 frames covers ~30 seconds at 1fps, or ~15 seconds at 2fps
    - Uniform sampling for consistent temporal coverage
    """

    fps: float = 1.0  # Frames per second (0.1 ~ 5.0)
    max_frames: int = 30  # Maximum number of frames to extract
    scale: str = ""  # FFmpeg scale filter (e.g. "512:-2", "720:-2", "" = original)
    strategy: str = "uniform"  # "uniform" | "keyframe" | "scene_change"
    quality: int = 5  # JPEG quality (1-31, lower = better, FFmpeg -q:v)
    visual_token_budget: int = 70  # Per-frame token budget (Gemma 4 concept)

    def effective_fps(self, duration_seconds: float | None) -> float:
        """Calculate effective FPS considering max_frames constraint.

        If the video is long and max_frames would be exceeded, reduce fps.
        """
        if duration_seconds is None or duration_seconds <= 0:
            return self.fps
        max_by_duration = self.max_frames / duration_seconds
        return min(self.fps, max_by_duration)

    @property
    def ffmpeg_vf(self) -> str:
        """Build FFmpeg -vf filter string."""
        parts = [f"fps={self.fps}"]
        if self.scale:
            parts.append(self.scale)
        return ",".join(parts)


@dataclass
class AudioConfig:
    """Audio separation configuration."""

    sample_rate: int = 16000  # Output sample rate
    channels: int = 1  # Mono output
    format: str = "wav"  # Output format
    max_duration_seconds: int = 3600  # 1 hour cap
    bitrate: str = "128k"  # Audio bitrate for encoding


class ContentPreprocessor:
    """Capability-aware content preprocessor.

    Given a raw input (file path or URL) and a model's capabilities,
    produces a ContentBundle with exactly the materials the model needs.

    Usage:
        preprocessor = ContentPreprocessor()
        bundle = preprocessor.prepare(
            input_path="/path/to/video.mp4",
            capabilities=model.capabilities(),
            frame_config=FrameConfig(fps=2.0, max_frames=50),
        )
        # bundle.frames filled if model needs frames
        # bundle.audio_path filled if model needs audio
        # bundle.video_path always filled (raw video)
    """

    def __init__(
        self,
        frame_config: FrameConfig | None = None,
        audio_config: AudioConfig | None = None,
    ) -> None:
        self.frame_config = frame_config or FrameConfig()
        self.audio_config = audio_config or AudioConfig()

    def prepare(
        self,
        input_path: str,
        capabilities: ModelCapabilities,
        content_type: str | None = None,
        frame_config: FrameConfig | None = None,
        audio_config: AudioConfig | None = None,
    ) -> ContentBundle:
        """Build a ContentBundle from raw input, based on model capabilities.

        This is the main entry point. It:
        1. Detects content type if not provided
        2. Determines the input strategy
        3. Preprocesses only what the model needs
        4. Returns a ContentBundle ready for model consumption
        """
        fc = frame_config or self.frame_config
        ac = audio_config or self.audio_config

        # Resolve absolute path
        abs_path = str(Path(input_path).expanduser().resolve())
        detected_type = content_type or self._detect_content_type(abs_path)

        bundle = ContentBundle(
            video_path=abs_path if detected_type == "video" else None,
            audio_path=abs_path if detected_type == "audio" else None,
            images=[Path(abs_path)] if detected_type == "image" else [],
            text=None,
            content_type=detected_type,
            local_path=abs_path,
        )

        # Get video duration if applicable
        if detected_type == "video":
            bundle.duration_seconds = self._get_duration(abs_path)

        # Determine strategy and preprocess accordingly
        strategy = capabilities.best_input_strategy(bundle)
        logger.info("Input strategy: %s (model accepts: %s)", strategy, capabilities.accepts)

        self._apply_strategy(bundle, strategy, capabilities, fc, ac)

        return bundle

    def _apply_strategy(
        self,
        bundle: ContentBundle,
        strategy: InputStrategy,
        capabilities: ModelCapabilities,
        fc: FrameConfig,
        ac: AudioConfig,
    ) -> None:
        """Apply the chosen input strategy — fill bundle fields accordingly."""

        if strategy == InputStrategy.NATIVE_VIDEO_AUDIO:
            # Model handles everything natively. Just pass the file path.
            # Optionally encode to base64 if model needs it.
            if not capabilities.supports_url_input and capabilities.supports_base64_input:
                bundle.video_base64 = self._encode_base64(bundle.video_path)
            return

        if strategy == InputStrategy.VIDEO_NATIVE_PLUS_AUDIO_SEPARATE:
            # Model handles video natively but needs audio separately
            if not capabilities.supports_url_input:
                bundle.video_base64 = self._encode_base64(bundle.video_path)
            bundle.audio_path = self._extract_audio(bundle.video_path, ac)
            return

        if strategy == InputStrategy.VIDEO_NATIVE_ONLY:
            # Model handles video natively, ignore audio
            if not capabilities.supports_url_input:
                bundle.video_base64 = self._encode_base64(bundle.video_path)
            return

        if strategy == InputStrategy.FRAMES_PLUS_AUDIO:
            # Extract frames and audio separately
            bundle.frames = self._extract_frames(bundle.video_path, capabilities, fc)
            bundle.audio_path = self._extract_audio(bundle.video_path, ac)
            return

        if strategy == InputStrategy.FRAMES_ONLY:
            # Extract frames only
            bundle.frames = self._extract_frames(bundle.video_path, capabilities, fc)
            return

        if strategy == InputStrategy.AUDIO_ONLY:
            # Already set in bundle
            return

        if strategy == InputStrategy.TRANSCRIBE_THEN_TEXT:
            # Will be handled by the model (transcribe → text analysis)
            return

        if strategy == InputStrategy.TEXT_ONLY:
            # Text-only, nothing to preprocess
            return

    def _extract_frames(
        self,
        video_path: str,
        capabilities: ModelCapabilities,
        fc: FrameConfig,
    ) -> list[Path]:
        """Extract frames from video using FFmpeg.

        Respects:
        - fps: frame rate
        - max_frames: cap on number of frames
        - scale: resolution scaling
        - quality: JPEG quality
        - duration-aware fps adjustment
        """
        if not shutil.which("ffmpeg"):
            logger.warning("ffmpeg not available, cannot extract frames")
            return []

        tmpdir = Path(tempfile.mkdtemp(prefix="cu_frames_"))
        effective_fps = fc.effective_fps(self._get_duration(video_path))

        vf = f"fps={effective_fps}"
        if fc.scale:
            vf = f"{vf},{fc.scale}"

        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", vf,
            "-frames:v", str(fc.max_frames),
            "-q:v", str(fc.quality),
            str(tmpdir / "frame_%06d.jpg"),
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode != 0:
                logger.warning("Frame extraction failed: %s",
                               result.stderr.decode(errors="replace")[:300])
                return []

            frames = sorted(tmpdir.glob("frame_*.jpg"))
            logger.info("Extracted %d frames at %.1f fps from %s",
                        len(frames), effective_fps, video_path)
            return frames

        except subprocess.TimeoutExpired:
            logger.error("Frame extraction timed out for %s", video_path)
            return []
        except Exception as e:
            logger.error("Frame extraction error: %s", e)
            return []

    def _extract_audio(
        self,
        video_path: str,
        ac: AudioConfig,
    ) -> str | None:
        """Extract audio track from video using FFmpeg.

        Returns path to the extracted audio file, or None on failure.
        """
        if not shutil.which("ffmpeg"):
            logger.warning("ffmpeg not available, cannot extract audio")
            return None

        output_path = video_path + f".audio.{ac.format}"

        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",  # No video
            "-acodec", "pcm_s16le" if ac.format == "wav" else "aac",
            "-ar", str(ac.sample_rate),
            "-ac", str(ac.channels),
            "-b:a", ac.bitrate,
            output_path,
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode == 0 and os.path.exists(output_path):
                size = os.path.getsize(output_path)
                logger.info("Extracted audio: %s (%d bytes)", output_path, size)
                return output_path
            logger.warning("Audio extraction failed: %s",
                           result.stderr.decode(errors="replace")[:200])
            return None

        except subprocess.TimeoutExpired:
            logger.error("Audio extraction timed out for %s", video_path)
            return None
        except Exception as e:
            logger.error("Audio extraction error: %s", e)
            return None

    def _get_duration(self, path: str) -> float | None:
        """Get media duration in seconds using ffprobe."""
        try:
            cmd = [
                "ffprobe", "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0 and result.stdout.strip():
                return float(result.stdout.strip())
        except Exception as e:
            logger.debug("ffprobe duration error: %s", e)
        return None

    def _detect_content_type(self, path: str) -> str:
        """Detect content type from file extension/MIME."""
        import mimetypes

        mime, _ = mimetypes.guess_type(path)
        if not mime:
            ext = Path(path).suffix.lower()
            _EXTRA = {
                ".webp": "image/webp", ".avif": "image/avif",
                ".heic": "image/heic", ".opus": "audio/opus",
                ".m4b": "audio/mp4", ".mkv": "video/x-matroska",
                ".webm": "video/webm",
            }
            mime = _EXTRA.get(ext)

        if mime:
            if mime.startswith("video/"):
                return "video"
            if mime.startswith("image/"):
                return "image"
            if mime.startswith("audio/"):
                return "audio"
            if mime in ("text/html", "application/pdf", "text/plain"):
                return "article"
        return "article"

    @staticmethod
    def _encode_base64(path: str | None) -> str | None:
        """Encode a file to base64 string."""
        if not path or not os.path.exists(path):
            return None
        try:
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode()
        except Exception as e:
            logger.error("Base64 encoding failed for %s: %s", path, e)
            return None

    @staticmethod
    def cleanup_bundle(bundle: ContentBundle) -> None:
        """Clean up temporary files created during preprocessing.

        Call this after the model has consumed the bundle.
        """
        # Clean extracted frames
        for frame in bundle.frames:
            try:
                if frame.exists():
                    frame.unlink()
            except OSError:
                pass
        # Clean frame directory if empty
        if bundle.frames:
            try:
                parent = bundle.frames[0].parent
                if parent.exists() and not any(parent.iterdir()):
                    parent.rmdir()
            except OSError:
                pass

        # Clean extracted audio (only if it's a temp file, not the original)
        if bundle.audio_path and bundle.audio_path != bundle.video_path:
            try:
                if Path(bundle.audio_path).exists():
                    os.unlink(bundle.audio_path)
            except OSError:
                pass
